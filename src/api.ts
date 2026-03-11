import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// @ts-ignore
import slsk from 'slsk-client';
import { SearchResult, SearchResultFile, AppConfig, DiscogsResult } from './types.js';

let client: any = null;
const activeProgressIntervals = new Map<string, NodeJS.Timeout>();

const CONFIG_PATH = path.join(os.homedir(), '.config', 'soulseekbrowser', 'config.json');

const DEFAULT_CONFIG: AppConfig = {
    username: process.env.SLSK_USER || '',
    password: process.env.SLSK_PASS || '',
    downloadPath: path.join(os.homedir(), 'Downloads', 'soulsearch'),
    sharePath: '',
    portForwarded: false,
    discogsToken: process.env.DISCOGS_TOKEN || '',
    search: {
        audioExtensions: ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aiff', '.m4p', '.wma', '.ape'],
        minBitrate: 0,
        sortBy: 'size',
        sortOrder: 'desc'
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
                search: { ...config.search, ...userConfig.search },
                ui: { ...config.ui, ...userConfig.ui }
            };
            if (config.discogsToken) config.discogsToken = config.discogsToken.trim();
            if (config.downloadPath) {
                config.downloadPath = config.downloadPath.replace(/^~($|\/|\\)/, `${os.homedir()}$1`);
            }
            if (config.sharePath) {
                config.sharePath = config.sharePath.replace(/^~($|\/|\\)/, `${os.homedir()}$1`);
            }
        }
    } catch (e) {}
    return config;
}

const CONFIG = loadConfig();

/**
 * Ensures the Soulseek client is connected.
 */
export async function ensureConnected(): Promise<void> {
    if (client) return;

    if (!CONFIG.username || !CONFIG.password) {
        throw new Error('Username and password must be set in config.json or environment variables');
    }

    return new Promise((resolve, reject) => {
        const connectOptions: any = {
            user: CONFIG.username,
            pass: CONFIG.password
        };

        if (CONFIG.sharePath && fs.existsSync(CONFIG.sharePath)) {
            connectOptions.sharedFolders = [CONFIG.sharePath];
        }

        slsk.connect(connectOptions, (err: any, res: any) => {
            if (err) return reject(err);
            client = res;
            resolve();
        });
    });
}

/**
 * Get current config
 */
export function getAppConfig(): AppConfig {
    return CONFIG;
}

/**
 * Searches the Soulseek network directly and streams results.
 */
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

    client.on('found', processFiles);
    const queryEvent = `found:${query}`;
    client.on(queryEvent, processFiles);

    client.search({
        req: query,
        timeout: 15000 
    }, (err: any, finalResults: any[]) => {
        client.removeListener('found', processFiles);
        client.removeListener(queryEvent, processFiles);
        if (!err && finalResults) processFiles(finalResults);
        onResults(Object.values(resultsByUser));
    });
}

/**
 * Downloads a file from a Soulseek peer.
 */
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
        let lastSize = 0;
        let stuckCount = 0;

        const progressInterval = setInterval(() => {
            try {
                if (fs.existsSync(localPath)) {
                    const stats = fs.statSync(localPath);
                    const percent = Math.min(Math.round((stats.size / file.size) * 100), 100);
                    onProgress(percent);
                    
                    if (stats.size === lastSize && percent < 100) {
                        stuckCount++;
                    } else {
                        stuckCount = 0;
                    }
                    lastSize = stats.size;

                    if (stuckCount > 40) {
                        cancelDownload(id, localPath);
                        reject(new Error('Download stuck. Cancelled.'));
                    }
                }
            } catch (e) {}
        }, 500);

        activeProgressIntervals.set(id, progressInterval);

        client.download({
            file: file.raw,
            path: localPath
        }, (err: any) => {
            stopProgressInterval(id);
            if (err) return reject(new Error(err.message || 'Download failed'));
            onProgress(100);
            resolve(localPath);
        });
    });
}

function stopProgressInterval(id: string) {
    const interval = activeProgressIntervals.get(id);
    if (interval) {
        clearInterval(interval);
        activeProgressIntervals.delete(id);
    }
}

/**
 * Cancels an active download.
 */
export function cancelDownload(id: string, localPath?: string) {
    stopProgressInterval(id);
    if (localPath && fs.existsSync(localPath)) {
        try {
            // Wait a bit for slsk-client to release the file handle
            setTimeout(() => {
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            }, 1000);
        } catch (e) {}
    }
}

/**
 * Searches Discogs API for a release.
 */
export async function searchDiscogs(query: string): Promise<DiscogsResult | null> {
    if (!CONFIG.discogsToken) {
        throw new Error('Discogs token is missing. Add "discogsToken" to your config.json');
    }

    const cleanQuery = query
        .replace(/\.[^/.]+$/, "") 
        .replace(/[_\-]/g, " ")   
        .trim();

    const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(cleanQuery)}&type=release&per_page=1&token=${CONFIG.discogsToken}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'SoulseekBrowserTUI/1.1 (Music Discovery Tool)'
            }
        });

        if (response.status === 401) {
            throw new Error('Unauthorized: Your Discogs token is invalid.');
        }

        if (!response.ok) {
            throw new Error(`Discogs API error: ${response.status}`);
        }

        const data = await response.json() as any;
        if (data.results && data.results.length > 0) {
            return data.results[0] as DiscogsResult;
        }
        return null;
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error('Unknown Discogs error');
    }
}
