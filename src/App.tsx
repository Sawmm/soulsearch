import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import open from 'open';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { SearchInput } from './components/SearchInput.js';
import { ResultTable } from './components/ResultTable.js';
import { DownloadView } from './components/DownloadView.js';
import { DiscogsView } from './components/DiscogsView.js';
import { performSearch, ensureConnected, downloadFile, getAppConfig, searchDiscogs, cancelDownload } from './api.js';
import { convertAudio, detectActualBitrate, applySmartFolders } from './converter.js';
import type { SearchResult, SearchResultFile, DownloadTask, DiscogsResult } from './types.js';
import { THEME } from './theme.js';

export const App = () => {
    const [query, setQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [status, setStatus] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [fileStats, setFileStats] = useState({ mp3: 0, wav: 0, flac: 0, aiff: 0, other: 0 });
    const [focus, setFocus] = useState<'search' | 'results' | 'downloads' | 'discogs'>('search');
    const [downloads, setDownloads] = useState<DownloadTask[]>([]);
    const [audioPlayer, setAudioPlayer] = useState<ChildProcess | null>(null);
    
    // Discogs state
    const [discogsResult, setDiscogsResult] = useState<DiscogsResult | null>(null);
    const [discogsLoading, setDiscogsLoading] = useState(false);
    const [discogsError, setDiscogsError] = useState<string | null>(null);

    const config = useMemo(() => getAppConfig(), []);
    const downloadedIds = useMemo(() => {
        const ids = new Set<string>();
        downloads.forEach(d => {
            if (d.status !== 'error') {
                ids.add(d.id.split('|')[0]);
            }
        });
        return ids;
    }, [downloads]);

    useEffect(() => {
        const connect = async () => {
            try {
                setStatus('Connecting...');
                await ensureConnected();
                setIsConnected(true);
                setStatus(config.portForwarded ? 'Connected (Full Mode)' : 'Connected (Restricted Mode)');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Connection failed');
            }
        };
        connect();
    }, [config]);

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
                                handleDownload(bestMatch.user, bestMatch.file);
                                setStatus(`Wishlist Found! Snatched: ${bestMatch.file.filename}`);
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

    const handleSubmit = (value: string) => {
        if (!value.trim() || !isConnected) return;
        setSubmittedQuery(value);
        setFocus('results');
    };

    useInput((_input, key) => {
        if (key.escape) {
            if (focus === 'discogs') {
                setFocus('results');
            } else if (focus === 'search') {
                if (results.length > 0) setFocus('results');
            } else {
                setFocus('search');
            }
        }
        if (key.tab && focus !== 'discogs') {
            setFocus(prev => prev === 'downloads' ? 'results' : 'downloads');
        }
    });

    useEffect(() => {
        if (!submittedQuery) return;
        let isMounted = true;
        const startSearch = async () => {
            try {
                setStatus(`Searching: ${submittedQuery}...`);
                setError(null);
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
                    setStatus(`Results for "${submittedQuery}" (${newResults.length} users)`);
                });
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err.message : 'Search error');
            }
        };
        startSearch();
        return () => { isMounted = false; };
    }, [submittedQuery]);

    const handleDownload = (username: string, file: SearchResultFile) => {
        const parts = file.filename.split(/[\\/]/);
        const filename = parts[parts.length - 1] || 'file';
        const baseId = `${username}:${file.filename}`;
        const taskId = `${baseId}|${Date.now()}`;

        if (downloadedIds.has(baseId)) return;

        const newTask: DownloadTask = { 
            id: taskId, 
            filename, 
            username, 
            size: file.size, 
            progress: 0, 
            status: 'downloading' 
        };

        setDownloads(prev => [newTask, ...prev]);
        setStatus(`Queued: ${filename}`);

        downloadFile(taskId, username, file, (percent) => {
            setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, progress: percent } : t));
        })
        .then(async (path) => {
            if (config.autoConvert.enabled) {
                setDownloads(prev => prev.map(t => 
                    t.id === taskId ? { ...t, status: 'converting', progress: 100 } : t
                ));
                setStatus(`Processing: ${filename}...`);

                try {
                    let analysis = undefined;
                    let info = '';
                    
                    // Always analyze if smartMode is on, or if specifically requested
                    if (config.autoConvert.smartMode || config.autoConvert.detectFakeBitrate) {
                        analysis = await detectActualBitrate(path);
                        info = ` [Actual: ${analysis.estimatedBitrate}]`;
                    }

                    const result = await convertAudio(path, config, analysis);
                    let finalPath = result.outputPath;

                    if (config.autoConvert.smartFolders) {
                        finalPath = await applySmartFolders(finalPath, config);
                    }

                    setDownloads(prev => prev.map(t => 
                        t.id === taskId ? { ...t, status: 'completed', localPath: finalPath, conversionInfo: `${result.format.toUpperCase()}${info ? " " + info : ""}` } : t
                    ));
                    setStatus(`Finished: ${filename}${info} (${result.format.toUpperCase()})`);
                } catch (convErr) {
                    setDownloads(prev => prev.map(t => 
                        t.id === taskId ? { ...t, status: 'error', errorMessage: 'Processing failed' } : t
                    ));
                    setStatus(`Processing Error: ${filename}`);
                }
            } else {
                let finalPath = path;
                if (config.autoConvert.smartFolders) {
                    finalPath = await applySmartFolders(finalPath, config);
                }

                setDownloads(prev => prev.map(t => 
                    t.id === taskId ? { ...t, status: 'completed', localPath: finalPath, progress: 100, conversionInfo: 'Original' } : t
                ));
                setStatus(`Finished: ${filename}`);
            }
        })
        .catch((err) => {
            setDownloads(prev => prev.map(t => 
                t.id === taskId ? { ...t, status: 'error', errorMessage: err.message } : t
            ));
            setStatus(`Error: ${err.message}`);
        });
    };

    const handleCancelDownload = (id: string) => {
        const task = downloads.find(t => t.id === id);
        if (task && (task.status === 'downloading' || task.status === 'converting')) {
            cancelDownload(id, task.localPath);
            setDownloads(prev => prev.map(t => 
                t.id === id ? { ...t, status: 'error', errorMessage: 'Cancelled by user' } : t
            ));
            setStatus(`Cancelled: ${task.filename}`);
        }
    };

    const handleClearFinished = () => {
        setDownloads(prev => prev.filter(t => t.status === 'downloading' || t.status === 'converting'));
        setStatus('Cleared finished downloads');
    };

    const handleYoutube = (filename: string) => {
        open(`https://www.youtube.com/results?search_query=${encodeURIComponent(filename)}`);
        setStatus(`YouTube: ${filename}`);
    };

    const handlePlay = (localPath: string, filename: string) => {
        if (audioPlayer) {
            audioPlayer.kill();
            setAudioPlayer(null);
            setStatus(`Stopped playback`);
            return;
        }

        const cmd = os.platform() === 'darwin' ? 'afplay' : 'ffplay';
        const args = os.platform() === 'darwin' ? [localPath] : ['-nodisp', '-autoexit', localPath];
        
        try {
            const proc = spawn(cmd, args);
            proc.on('close', () => {
                setAudioPlayer(null);
            });
            proc.on('error', () => {
                setStatus(`Cannot play audio. ${cmd} not found.`);
                setAudioPlayer(null);
            });
            setAudioPlayer(proc);
            setStatus(`Playing: ${filename}`);
        } catch (e) {
            setStatus(`Cannot play audio. ${cmd} not found.`);
        }
    };

    const handleDiscogs = async (filename: string) => {
        setFocus('discogs');
        setDiscogsLoading(true);
        setDiscogsError(null);
        setDiscogsResult(null);

        try {
            const result = await searchDiscogs(filename);
            setDiscogsResult(result);
        } catch (err) {
            setDiscogsError(err instanceof Error ? err.message : 'Failed to fetch Discogs info');
        } finally {
            setDiscogsLoading(false);
        }
    };

    return (
        <Box flexDirection="column" padding={1} minHeight={20}>
            <Box marginBottom={1} borderStyle="round" borderColor={THEME.ACCENT} paddingX={1} justifyContent="space-between">
                <Box flexDirection="column">
                    <Text bold color={THEME.ACCENT}> ♫ SOULSEEK BROWSER </Text>
                    <Text color={THEME.DIM}>
                        {config.portForwarded ? 'Mode: FULL' : 'Mode: RESTRICTED'} • {config.downloadPath}
                    </Text>
                </Box>
                {submittedQuery && (
                    <Box>
                        <Text color={THEME.WARNING} bold> MP3:{fileStats.mp3} </Text>
                        <Text color={THEME.INFO} bold> FLAC:{fileStats.flac} </Text>
                        <Text color={THEME.SUCCESS} bold> WAV:{fileStats.wav} </Text>
                        <Text color={THEME.ACCENT} bold> AIFF:{fileStats.aiff} </Text>
                    </Box>
                )}
            </Box>
            
            <SearchInput 
                value={query} 
                onChange={setQuery} 
                onSubmit={handleSubmit} 
                isFocused={focus === 'search'}
            />
            
            <Box paddingY={1} height={3} flexDirection="column">
                {!isConnected && !error && <Text color={THEME.INFO}>Connecting to Soulseek network...</Text>}
                {status && !error && <Text color={THEME.SUCCESS} bold>● {status}</Text>}
                {error && (
                    <Box flexDirection="column">
                        <Text color={THEME.ERROR} bold>✖ {error}</Text>
                    </Box>
                )}
            </Box>

            <Box display={focus === 'downloads' ? 'flex' : 'none'} flexDirection="column">
                <DownloadView 
                    downloads={downloads} 
                    isFocused={focus === 'downloads'} 
                    onCancel={handleCancelDownload}
                    onClear={handleClearFinished}
                    onPlay={handlePlay}
                />
            </Box>

            <Box display={focus === 'discogs' ? 'flex' : 'none'} flexDirection="column">
                <DiscogsView 
                    result={discogsResult} 
                    loading={discogsLoading} 
                    error={discogsError} 
                />
            </Box>

            <Box display={focus === 'results' ? 'flex' : 'none'} flexDirection="column">
                <ResultTable 
                    results={results} 
                    isFocused={focus === 'results'} 
                    onDownload={handleDownload}
                    onYoutube={handleYoutube}
                    onDiscogs={handleDiscogs}
                    config={config}
                    downloadedIds={downloadedIds}
                />
            </Box>
            
            <Box marginTop={1}>
                <Text color={THEME.DIM}> 
                    {focus === 'search' ? ' [Type] Search  [Enter] Submit  [Tab] Downloads' : 
                     focus === 'results' ? ' [j/k] Scroll  [Enter] DL  [y] YouTube  [d] Discogs  [Esc] Toggle Focus  [Tab] Downloads' :
                     focus === 'downloads' ? ' [j/k] Scroll  [x] Cancel  [c] Clear  [Tab] Results' :
                     ' [Esc] Back to results'}
                </Text>
            </Box>
        </Box>
    );
};
