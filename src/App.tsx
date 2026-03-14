import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import open from 'open';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { SearchInput } from './components/SearchInput.js';
import { ResultTable } from './components/ResultTable.js';
import { DownloadView } from './components/DownloadView.js';
import { DiscogsView } from './components/DiscogsView.js';
import { ensureConnected, getAppConfig, searchDiscogs } from './api.js';
import type { DiscogsResult } from './types.js';
import { THEME } from './theme.js';
import { useSearch, useWishlistDaemon } from './hooks/useSearch.js';
import { useDownloads } from './hooks/useDownloads.js';

export const App = () => {
    const [query, setQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [status, setStatus] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [focus, setFocus] = useState<'search' | 'results' | 'downloads' | 'discogs'>('search');
    const [audioPlayer, setAudioPlayer] = useState<ChildProcess | null>(null);
    
    // Discogs state
    const [discogsResult, setDiscogsResult] = useState<DiscogsResult | null>(null);
    const [discogsLoading, setDiscogsLoading] = useState(false);
    const [discogsError, setDiscogsError] = useState<string | null>(null);

    const config = useMemo(() => getAppConfig(), []);

    // Custom Hooks
    const { results, fileStats } = useSearch(submittedQuery, isConnected, setStatus, setError);
    const { 
        downloads, 
        downloadedIds, 
        handleDownload, 
        handleCancelDownload, 
        handleClearFinished 
    } = useDownloads(config, setStatus);

    useWishlistDaemon(isConnected, config, setStatus, handleDownload);

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
