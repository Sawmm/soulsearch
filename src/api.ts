import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// @ts-ignore
import slsk from 'slsk-client';
import { SearchResult, SearchResultFile, AppConfig, DiscogsResult } from './types.js';

let client: any = null;
let connectionPromise: Promise<void> | null = null;
const activeDownloads = new Map<string, { stream?: any, writeStream?: fs.WriteStream }>();

const CONFIG_PATH = path.join(os.homedir(), '.config', 'soulseekbrowser', 'config.json');

const DEFAULT_CONFIG: AppConfig = {
    username: process.env.SLSK_USER || '',
    password: process.env.SLSK_PASS || '',
    downloadPath: path.join(os.homedir(), 'Downloads', 'soulsearch'),
    sharePath: '',
    portForwarded: false,
    discogsToken: process.env.DISCOGS_TOKEN || '',
    autoConvert: {
        enabled: false,
        smartMode: true,
        targetFormat: 'mp3',
        mp3Bitrate: '320k',
        detectFakeBitrate: true,
        deleteOriginal: false,
        normalizeVolume: false,
        targetLufs: -14.0,
        smartFolders: false
    },
    search: {
        audioExtensions: ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aiff', '.m4p', '.wma', '.ape'],
        minBitrate: 0,
        sortBy: 'size',
        sortOrder: 'desc',
        wishlist: []
    },
    ui: {
        viewportSize: 15,
        showBitrate: true,
        showSlots: true
    }
};

function loadConfig(): AppConfig {
    let config = { ...DEFAULT_CONFIG };
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            config = {
                ...config,
                ...userConfig,
                autoConvert: { ...config.autoConvert, ...userConfig.autoConvert },
                search: { ...config.search, ...userConfig.search },
                ui: { ...config.ui, ...userConfig.ui }
            };
            if (config.username) config.username = config.username.trim();
            if (config.password) config.password = config.password.trim();
            if (config.discogsToken) config.discogsToken = config.discogsToken.trim();
            if (config.downloadPath) {
                config.downloadPath = path.resolve(
                    config.downloadPath.startsWith('~/') 
                        ? path.join(os.homedir(), config.downloadPath.slice(2))
                        : config.downloadPath
                );
            }
            if (config.sharePath) {
                config.sharePath = path.resolve(
                    config.sharePath.startsWith('~/') 
                        ? path.join(os.homedir(), config.sharePath.slice(2))
                        : config.sharePath
                );
            }
        }
    } catch (e) {}
    return config;
}

const CONFIG = loadConfig();

export async function ensureConnected(): Promise<void> {
    if (client) return;
    if (connectionPromise) return connectionPromise;

    if (!CONFIG.username || !CONFIG.password) {
        throw new Error('Username and password must be set in config.json or environment variables');
    }

    connectionPromise = new Promise((resolve, reject) => {
        const connectOptions: any = { user: CONFIG.username, pass: CONFIG.password };
        if (CONFIG.sharePath && fs.existsSync(CONFIG.sharePath)) {
            connectOptions.sharedFolders = [CONFIG.sharePath];
        }

        slsk.connect(connectOptions, (err: any, res: any) => {
            if (err) {
                connectionPromise = null;
                return reject(err);
            }
            client = res;
            
            // Connection Heartbeat / Reconnection Logic
            const handleDisconnect = () => {
                if (client) {
                    try { client.destroy(); } catch (e) {}
                    client = null;
                }
                // Silently attempt to reconnect in the background after 5s
                setTimeout(() => {
                    ensureConnected().catch(() => {});
                }, 5000);
            };

            client.on('error', handleDisconnect);
            client.on('disconnect', handleDisconnect);

            connectionPromise = null;
            resolve();
        });
    });

    return connectionPromise;
}

export function getAppConfig(): AppConfig {
    return CONFIG;
}

export async function performSearch(
    query: string, 
    onResults: (results: SearchResult[]) => void
): Promise<void> {
    await ensureConnected();
    const resultsByUser: Record<string, SearchResult> = {};
    const audioExts = CONFIG.search.audioExtensions.map(e => e.toLowerCase());
    let lastUpdate = Date.now();
    const THROTTLE_MS = 200;

    const processFiles = (input: any) => {
        const files = Array.isArray(input) ? input : [input];
        let hasNew = false;
        files.forEach((file: any) => {
            if (!file || !file.file || !file.user) return;
            if (file.req && file.req.toLowerCase() !== query.toLowerCase()) return;
            const lowerFilename = file.file.toLowerCase();
            const isAudio = audioExts.some(ext => lowerFilename.endsWith(ext));
            if (!isAudio) return;
            if (CONFIG.search.minBitrate > 0 && file.bitrate && file.bitrate < CONFIG.search.minBitrate) return;
            const hasSlots = !!file.slots;
            if (!CONFIG.portForwarded && !hasSlots) return;
            if (!resultsByUser[file.user]) {
                resultsByUser[file.user] = {
                    username: file.user,
                    files: [],
                    hasFreeUploadSlot: hasSlots,
                    uploadSpeed: file.speed || 0,
                    queueLength: 0
                };
            }
            const alreadyExists = resultsByUser[file.user].files.some(f => f.filename === file.file);
            if (!alreadyExists) {
                resultsByUser[file.user].files.push({
                    filename: file.file,
                    size: file.size,
                    bitRate: file.bitrate,
                    length: file.length,
                    raw: file 
                });
                hasNew = true;
            }
        });
        if (hasNew) {
            const now = Date.now();
            if (now - lastUpdate > THROTTLE_MS) {
                onResults(Object.values(resultsByUser));
                lastUpdate = now;
            }
        }
    };

    const queryEvent = `found:${query}`;
    client.on(queryEvent, processFiles);
    client.search({ req: query, timeout: 15000 }, (err: any, finalResults: any[]) => {
        client.removeListener(queryEvent, processFiles);
        if (!err && finalResults) processFiles(finalResults);
        onResults(Object.values(resultsByUser));
    });
}

export async function downloadFile(
    id: string,
    username: string,
    file: SearchResultFile,
    onProgress: (percent: number) => void
): Promise<string> {
    await ensureConnected();
    if (!fs.existsSync(CONFIG.downloadPath)) {
        fs.mkdirSync(CONFIG.downloadPath, { recursive: true });
    }
    const parts = file.filename.split(/[\\/]/);
    const filename = parts[parts.length - 1] || 'unknown_file';
    const localPath = path.join(CONFIG.downloadPath, filename);

    return new Promise((resolve, reject) => {
        client.downloadStream({ file: file.raw }, (err: any, stream: any) => {
            if (err) return reject(new Error(err.message || 'Download failed to start'));

            const writeStream = fs.createWriteStream(localPath);
            activeDownloads.set(id, { stream, writeStream });

            let downloadedBytes = 0;
            stream.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length;
                const percent = Math.min(Math.round((downloadedBytes / file.size) * 100), 100);
                onProgress(percent);
            });

            stream.on('error', (streamErr: Error) => {
                cleanupDownload(id, localPath);
                reject(streamErr);
            });

            stream.pipe(writeStream);

            writeStream.on('finish', () => {
                activeDownloads.delete(id);
                onProgress(100);
                resolve(localPath);
            });

            writeStream.on('error', (writeErr: Error) => {
                cleanupDownload(id, localPath);
                reject(writeErr);
            });
        });
    });
}

function cleanupDownload(id: string, localPath?: string) {
    const active = activeDownloads.get(id);
    if (active) {
        if (active.stream) active.stream.destroy();
        if (active.writeStream) active.writeStream.close();
        activeDownloads.delete(id);
    }
    if (localPath && fs.existsSync(localPath)) {
        try { fs.unlinkSync(localPath); } catch (e) {}
    }
}

export function cancelDownload(id: string, localPath?: string) {
    cleanupDownload(id, localPath);
}

export async function searchDiscogs(query: string, useToken: boolean = true): Promise<DiscogsResult | null> {
    const cleanQuery = query.replace(/\.[^/.]+$/, "").replace(/[_\-]/g, " ").trim();
    let url = `https://api.discogs.com/database/search?q=${encodeURIComponent(cleanQuery)}&type=release&per_page=1`;
    
    if (CONFIG.discogsToken && useToken) {
        url += `&token=${CONFIG.discogsToken}`;
    }
    
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } });
        
        // If the user's token is invalid, Discogs blocks the entire request with 401. 
        // Fallback to a tokenless request so the UI still works.
        if (response.status === 401 && CONFIG.discogsToken && useToken) {
            return searchDiscogs(query, false);
        }
        
        if (!response.ok) return null;
        const data = await response.json() as any;
        return (data.results && data.results.length > 0) ? data.results[0] : null;
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error('Discogs error');
    }
}
