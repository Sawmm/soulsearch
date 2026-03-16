import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
// @ts-ignore
import slsk from 'slsk-client';
import { SearchResult, SearchResultFile, AppConfig, DiscogsResult } from './types.js';

let client: any = null;
let connectionPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const activeDownloads = new Map<string, { stream?: any, writeStream?: fs.WriteStream, rejectPromise?: (err: Error) => void }>();

const CONFIG_PATH = path.join(os.homedir(), '.config', 'soulseekbrowser', 'config.json');

function encodeCredential(value: string): string {
    if (!value) return value;
    if (value.startsWith('b64:')) return value;
    return 'b64:' + Buffer.from(value).toString('base64');
}

function decodeCredential(value: string): string {
    if (!value) return value;
    if (value.startsWith('b64:')) {
        return Buffer.from(value.slice(4), 'base64').toString('utf-8');
    }
    return value;
}

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

function validateConfig(config: any): string[] {
    const errors: string[] = [];

    if (config.username !== undefined && typeof config.username !== 'string') {
        errors.push('username must be a string');
    }
    if (config.password !== undefined && typeof config.password !== 'string') {
        errors.push('password must be a string');
    }
    if (config.downloadPath !== undefined && typeof config.downloadPath !== 'string') {
        errors.push('downloadPath must be a string');
    }
    if (config.sharePath !== undefined && typeof config.sharePath !== 'string') {
        errors.push('sharePath must be a string');
    }
    if (config.portForwarded !== undefined && typeof config.portForwarded !== 'boolean') {
        errors.push('portForwarded must be a boolean');
    }
    if (config.discogsToken !== undefined && typeof config.discogsToken !== 'string') {
        errors.push('discogsToken must be a string');
    }

    if (config.autoConvert) {
        const ac = config.autoConvert;
        if (ac.enabled !== undefined && typeof ac.enabled !== 'boolean') errors.push('autoConvert.enabled must be a boolean');
        if (ac.smartMode !== undefined && typeof ac.smartMode !== 'boolean') errors.push('autoConvert.smartMode must be a boolean');
        if (ac.targetFormat !== undefined && !['mp3', 'aiff'].includes(ac.targetFormat)) errors.push('autoConvert.targetFormat must be "mp3" or "aiff"');
        if (ac.mp3Bitrate !== undefined && typeof ac.mp3Bitrate !== 'string') errors.push('autoConvert.mp3Bitrate must be a string');
        if (ac.detectFakeBitrate !== undefined && typeof ac.detectFakeBitrate !== 'boolean') errors.push('autoConvert.detectFakeBitrate must be a boolean');
        if (ac.deleteOriginal !== undefined && typeof ac.deleteOriginal !== 'boolean') errors.push('autoConvert.deleteOriginal must be a boolean');
        if (ac.normalizeVolume !== undefined && typeof ac.normalizeVolume !== 'boolean') errors.push('autoConvert.normalizeVolume must be a boolean');
        if (ac.targetLufs !== undefined && typeof ac.targetLufs !== 'number') errors.push('autoConvert.targetLufs must be a number');
        if (ac.smartFolders !== undefined && typeof ac.smartFolders !== 'boolean') errors.push('autoConvert.smartFolders must be a boolean');
    }

    if (config.search) {
        const s = config.search;
        if (s.audioExtensions !== undefined && (!Array.isArray(s.audioExtensions) || !s.audioExtensions.every((e: any) => typeof e === 'string'))) {
            errors.push('search.audioExtensions must be an array of strings');
        }
        if (s.minBitrate !== undefined && typeof s.minBitrate !== 'number') errors.push('search.minBitrate must be a number');
        if (s.sortBy !== undefined && !['size', 'bitrate', 'speed'].includes(s.sortBy)) errors.push('search.sortBy must be "size", "bitrate", or "speed"');
        if (s.sortOrder !== undefined && !['asc', 'desc'].includes(s.sortOrder)) errors.push('search.sortOrder must be "asc" or "desc"');
        if (s.wishlist !== undefined && !Array.isArray(s.wishlist)) errors.push('search.wishlist must be an array');
    }

    if (config.ui) {
        const ui = config.ui;
        if (ui.viewportSize !== undefined && typeof ui.viewportSize !== 'number') errors.push('ui.viewportSize must be a number');
        if (ui.showBitrate !== undefined && typeof ui.showBitrate !== 'boolean') errors.push('ui.showBitrate must be a boolean');
        if (ui.showSlots !== undefined && typeof ui.showSlots !== 'boolean') errors.push('ui.showSlots must be a boolean');
    }

    return errors;
}

function loadConfig(): AppConfig {
    let config = { ...DEFAULT_CONFIG };
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

            const validationErrors = validateConfig(userConfig);
            if (validationErrors.length > 0) {
                console.error('Config validation errors:');
                validationErrors.forEach(err => console.error(`  - ${err}`));
                console.error('Using default configuration for invalid values.');
            }

            config = {
                ...config,
                ...userConfig,
                autoConvert: { ...config.autoConvert, ...userConfig.autoConvert },
                search: { ...config.search, ...userConfig.search },
                ui: { ...config.ui, ...userConfig.ui }
            };
            if (config.username) config.username = decodeCredential(config.username.trim());
            if (config.password) config.password = decodeCredential(config.password.trim());
            if (config.discogsToken) config.discogsToken = decodeCredential(config.discogsToken.trim());
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
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error(`Warning: Failed to parse config file at ${CONFIG_PATH}: ${e.message}`);
        }
    }
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
            reconnectAttempts = 0;
            
            // Connection Heartbeat / Reconnection Logic
            const handleDisconnect = () => {
                if (client) {
                    try { client.destroy(); } catch (e) {}
                    client = null;
                }
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
                reconnectAttempts++;
                const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 300000);
                setTimeout(() => {
                    ensureConnected().catch(() => {});
                }, delay);
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

    if (!client) {
        onResults(Object.values(resultsByUser));
        return;
    }

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
        if (!client) return reject(new Error('Soulseek client not connected'));
        
        let called = false;
        
        const slskStream = new Readable();
        slskStream._read = () => {};
        
        // Use download directly instead of downloadStream to avoid slsk-client bug where cb is null
        client.download({ file: file.raw }, (err: any) => {
            if (err) slskStream.emit('error', err);
        }, slskStream);
        
        const writeStream = fs.createWriteStream(localPath);
        activeDownloads.set(id, { stream: slskStream, writeStream, rejectPromise: reject });

        let downloadedBytes = 0;
        slskStream.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            const percent = Math.min(Math.round((downloadedBytes / file.size) * 100), 100);
            onProgress(percent);
        });

        slskStream.on('error', (streamErr: Error) => {
            if (!called) {
                called = true;
                cleanupDownload(id, localPath);
                reject(new Error(streamErr.message || 'Download failed to start'));
            }
        });

        slskStream.pipe(writeStream);

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
}

function cleanupDownload(id: string, localPath?: string) {
    const active = activeDownloads.get(id);
    if (active) {
        if (active.stream) active.stream.destroy();
        if (active.writeStream) active.writeStream.destroy();
        activeDownloads.delete(id);
    }
    if (localPath && fs.existsSync(localPath)) {
        try { fs.unlinkSync(localPath); } catch (e) {}
    }
}

export function cancelDownload(id: string, localPath?: string) {
    const active = activeDownloads.get(id);
    if (!active) return;
    
    if (active.rejectPromise) {
        active.rejectPromise(new Error('Cancelled by user'));
    }
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
