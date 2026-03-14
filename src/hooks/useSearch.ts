import { useState, useEffect } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { performSearch } from '../api.js';
import type { SearchResult, SearchResultFile, AppConfig } from '../types.js';

export function useSearch(
    submittedQuery: string,
    isConnected: boolean,
    onStatus: (msg: string) => void,
    onError: (err: string | null) => void
) {
    const [results, setResults] = useState<SearchResult[]>([]);
    const [fileStats, setFileStats] = useState({ mp3: 0, wav: 0, flac: 0, aiff: 0, other: 0 });

    useEffect(() => {
        if (!submittedQuery || !isConnected) return;
        let isMounted = true;
        const startSearch = async () => {
            try {
                onStatus(`Searching: ${submittedQuery}...`);
                onError(null);
                setResults([]);
                setFileStats({ mp3: 0, wav: 0, flac: 0, aiff: 0, other: 0 });

                await performSearch(submittedQuery, (newResults) => {
                    if (!isMounted) return;
                    setResults(newResults);
                    
                    const stats = { mp3: 0, wav: 0, flac: 0, aiff: 0, other: 0 };
                    newResults.forEach(res => {
                        res.files.forEach(f => {
                            const ext = f.filename.split('.').pop()?.toLowerCase();
                            if (ext === 'mp3') stats.mp3++;
                            else if (ext === 'wav') stats.wav++;
                            else if (ext === 'flac') stats.flac++;
                            else if (ext === 'aiff' || ext === 'aif') stats.aiff++;
                            else stats.other++;
                        });
                    });
                    setFileStats(stats);
                    onStatus(`Results for "${submittedQuery}" (${newResults.length} users)`);
                });
            } catch (err) {
                if (!isMounted) return;
                onError(err instanceof Error ? err.message : 'Search error');
            }
        };
        startSearch();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submittedQuery, isConnected]);

    return { results, fileStats, setResults };
}

export function useWishlistDaemon(
    isConnected: boolean,
    config: AppConfig,
    onStatus: (msg: string) => void,
    onDownloadFound: (user: string, file: SearchResultFile) => void
) {
    // Wishlist Background Daemon
    useEffect(() => {
        if (!isConnected || !config.search.wishlist || config.search.wishlist.length === 0) return;

        const historyPath = path.join(os.homedir(), '.config', 'soulseekbrowser', 'wishlist-history.json');
        
        const checkWishlist = async () => {
            let history: string[] = [];
            try {
                if (fs.existsSync(historyPath)) {
                    history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
                }
            } catch (e) {}
            
            for (const item of config.search.wishlist) {
                if (history.includes(item)) continue;
                
                await performSearch(item, (newResults) => {
                    let bestMatch: { user: string; file: SearchResultFile } | null = null;
                    
                    for (const u of newResults) {
                        for (const f of u.files) {
                            // Require 320kbps minimum and larger than 5MB to ensure it's not a snippet.
                            if (f.bitRate && f.bitRate >= 320 && f.size > 5 * 1024 * 1024) {
                                bestMatch = { user: u.username, file: f };
                                break;
                            }
                        }
                        if (bestMatch) break;
                    }

                    if (bestMatch) {
                        try {
                            const currentHistory = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
                            if (!currentHistory.includes(item)) {
                                currentHistory.push(item);
                                fs.writeFileSync(historyPath, JSON.stringify(currentHistory));
                                onDownloadFound(bestMatch.user, bestMatch.file);
                                onStatus(`Wishlist Found! Snatched: ${bestMatch.file.filename}`);
                            }
                        } catch(e) {}
                    }
                });
                
                // Throttle background searches so we don't bombard the daemon thread
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        };

        const intervalId = setInterval(checkWishlist, 10 * 60 * 1000); // Trigger every 10 minutes
        checkWishlist(); // Initial boot check

        return () => clearInterval(intervalId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, isConnected]);
}
