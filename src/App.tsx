import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import open from 'open';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import { SearchInput } from './components/SearchInput.js';
import { ResultTable } from './components/ResultTable.js';
import { DownloadView } from './components/DownloadView.js';
import { MusicBrainzView } from './components/DiscogsView.js';
import { ensureConnected, getAppConfig, searchMusicBrainz } from './api.js';
import type { MusicBrainzResult } from './types.js';
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
    const audioPlayerRef = useRef<ChildProcess | null>(null);
    const isResultsFilteringRef = useRef(false);
    const isResultsDrillingRef = useRef(false);

    useEffect(() => {
        audioPlayerRef.current = audioPlayer;
    }, [audioPlayer]);

    const [mbResult, setMbResult] = useState<MusicBrainzResult | null>(null);
    const [mbLoading, setMbLoading] = useState(false);
    const [mbError, setMbError] = useState<string | null>(null);

    const config = useMemo(() => getAppConfig(), []);

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
                setStatus(config.portForwarded ? 'Connected · Full Mode' : 'Connected · Restricted Mode');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Connection failed');
            }
        };
        connect();

        const handleExit = () => {
            if (audioPlayerRef.current) {
                audioPlayerRef.current.kill();
            }
            process.exit(0);
        };

        process.on('SIGINT', handleExit);
        process.on('SIGTERM', handleExit);

        return () => {
            if (audioPlayerRef.current) {
                audioPlayerRef.current.kill();
            }
            process.removeListener('SIGINT', handleExit);
            process.removeListener('SIGTERM', handleExit);
        };
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
            } else if (!isResultsFilteringRef.current && !isResultsDrillingRef.current) {
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

        // Fix 2: ensure the file to be played lives inside the configured download
        // directory so a crafted path from a peer cannot reach arbitrary files.
        const resolvedPlay = path.resolve(localPath);
        const resolvedDownloadDir = path.resolve(config.downloadPath);
        if (!resolvedPlay.startsWith(resolvedDownloadDir + path.sep)) {
            setStatus(`Cannot play: file is outside download directory`);
            return;
        }

        const cmd = os.platform() === 'darwin' ? 'afplay' : 'ffplay';
        const args = os.platform() === 'darwin' ? [localPath] : ['-nodisp', '-autoexit', localPath];

        try {
            const proc = spawn(cmd, args);
            proc.on('close', () => setAudioPlayer(null));
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
        setMbLoading(true);
        setMbError(null);
        setMbResult(null);

        try {
            const result = await searchMusicBrainz(filename);
            setMbResult(result);
        } catch (err) {
            setMbError(err instanceof Error ? err.message : 'Failed to fetch MusicBrainz info');
        } finally {
            setMbLoading(false);
        }
    };

    const modeLabel = config.portForwarded ? 'FULL' : 'RESTRICTED';
    const modeColor = config.portForwarded ? THEME.SUCCESS : THEME.WARNING;

    const keyhint = focus === 'search'
        ? 'enter:search  tab:downloads'
        : focus === 'results'
        ? 'j/k:scroll  enter:open/dl  a:dl all  v:toggle view  y:youtube  d:info  /:filter  esc:back  tab:downloads'
        : focus === 'downloads'
        ? 'j/k:scroll  space:play  x:cancel  c:clear  tab:results'
        : 'esc:back';

    return (
        <Box flexDirection="column" paddingX={1} paddingY={0} minHeight={20}>
            {/* Header */}
            <Box marginBottom={0} borderStyle="single" borderColor={THEME.ACCENT} paddingX={1} justifyContent="space-between" alignItems="center">
                <Box gap={2} alignItems="center">
                    <Text bold color={THEME.ACCENT}>soulsearch</Text>
                    <Text color={modeColor}>{modeLabel}</Text>
                    <Text color={THEME.DIM}>{config.downloadPath}</Text>
                </Box>
                {submittedQuery && (
                    <Box gap={2}>
                        <Text color={THEME.WARNING}>mp3 <Text bold>{fileStats.mp3}</Text></Text>
                        <Text color={THEME.INFO}>flac <Text bold>{fileStats.flac}</Text></Text>
                        <Text color={THEME.SUCCESS}>wav <Text bold>{fileStats.wav}</Text></Text>
                        <Text color={THEME.ACCENT}>aiff <Text bold>{fileStats.aiff}</Text></Text>
                    </Box>
                )}
            </Box>

            <Box marginTop={1}>
                <SearchInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    isFocused={focus === 'search'}
                />
            </Box>

            <Box height={1} marginTop={1}>
                {!isConnected && !error && <Text color={THEME.DIM}>connecting...</Text>}
                {status && !error && <Text color={THEME.SUCCESS}>  {status}</Text>}
                {error && <Text color={THEME.ERROR}>✗ {error}</Text>}
            </Box>

            <Box display={focus === 'downloads' ? 'flex' : 'none'} flexDirection="column" marginTop={1}>
                <DownloadView
                    downloads={downloads}
                    isFocused={focus === 'downloads'}
                    onCancel={handleCancelDownload}
                    onClear={handleClearFinished}
                    onPlay={handlePlay}
                />
            </Box>

            <Box display={focus === 'discogs' ? 'flex' : 'none'} flexDirection="column" marginTop={1}>
                <MusicBrainzView
                    result={mbResult}
                    loading={mbLoading}
                    error={mbError}
                />
            </Box>

            <Box display={focus === 'results' ? 'flex' : 'none'} flexDirection="column" marginTop={1}>
                <ResultTable
                    results={results}
                    submittedQuery={submittedQuery}
                    isFocused={focus === 'results'}
                    onDownload={handleDownload}
                    onYoutube={handleYoutube}
                    onDiscogs={handleDiscogs}
                    config={config}
                    downloadedIds={downloadedIds}
                    onFilterStateChange={(v) => { isResultsFilteringRef.current = v; }}
                    onDrillStateChange={(v) => { isResultsDrillingRef.current = v; }}
                />
            </Box>

            <Box marginTop={1}>
                <Text color={THEME.DIM}>{keyhint}</Text>
            </Box>
        </Box>
    );
};
