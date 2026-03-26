import { useState, useRef, useMemo } from 'react';
import * as path from 'path';
import { downloadFile, cancelDownload } from '../api.js';
import { convertAudio, detectActualBitrate, applySmartFolders, tagAudioFile } from '../converter.js';
import type { DownloadTask, SearchResultFile, AppConfig } from '../types.js';

const PROGRESS_THROTTLE_MS = 150;

export function useDownloads(
    config: AppConfig,
    onStatus: (msg: string) => void
) {
    const [downloads, setDownloads] = useState<DownloadTask[]>([]);
    // Tracks kill functions for in-progress conversions so we can abort ffmpeg on cancel
    const conversionKills = useRef<Map<string, () => void>>(new Map());
    // Prevents duplicate downloads when the user triggers the same file twice before state updates
    const pendingDownloads = useRef<Set<string>>(new Set());
    // Throttles progress updates to avoid flooding React with state updates during fast downloads
    const progressThrottle = useRef<Map<string, number>>(new Map());

    const downloadedIds = useMemo(() => {
        const ids = new Set<string>();
        downloads.forEach(d => {
            if (d.status !== 'error') {
                ids.add(d.id.split('|')[0]);
            }
        });
        return ids;
    }, [downloads]);

    const handleDownload = (username: string, file: SearchResultFile) => {
        const parts = file.filename.split(/[\\/]/);
        const filename = parts[parts.length - 1] || 'file';
        const baseId = `${username}:${file.filename}`;
        const taskId = `${baseId}|${Date.now()}`;

        if (downloadedIds.has(baseId) || pendingDownloads.current.has(baseId)) return;
        pendingDownloads.current.add(baseId);

        const newTask: DownloadTask = {
            id: taskId,
            filename,
            username,
            size: file.size,
            progress: 0,
            status: 'downloading'
        };

        setDownloads(prev => [newTask, ...prev]);
        onStatus(`Queued: ${filename}`);

        downloadFile(taskId, username, file, (percent) => {
            const now = Date.now();
            const last = progressThrottle.current.get(taskId) ?? 0;
            if (percent >= 100 || now - last >= PROGRESS_THROTTLE_MS) {
                progressThrottle.current.set(taskId, now);
                setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, progress: percent } : t));
            }
        })
        .then(async (downloadedPath) => {
            if (config.autoConvert.enabled) {
                setDownloads(prev => prev.map(t =>
                    t.id === taskId ? { ...t, status: 'converting', progress: 100 } : t
                ));
                onStatus(`Processing: ${filename}...`);

                try {
                    let analysis = undefined;
                    let info = '';

                    // Always analyze if smartMode is on, or if specifically requested
                    if (config.autoConvert.smartMode || config.autoConvert.detectFakeBitrate) {
                        analysis = await detectActualBitrate(downloadedPath);
                        info = ` [Actual: ${analysis.estimatedBitrate}]`;
                    }

                    const result = await convertAudio(downloadedPath, config, analysis, (kill) => {
                        // Register kill immediately when ffmpeg starts, not after it finishes
                        conversionKills.current.set(taskId, kill);
                    });

                    let finalPath = result.outputPath;

                    if (config.autoConvert.smartFolders) {
                        finalPath = await applySmartFolders(finalPath, config);
                    }

                    conversionKills.current.delete(taskId);
                    progressThrottle.current.delete(taskId);
                    pendingDownloads.current.delete(baseId);

                    const folderInfo = config.autoConvert.smartFolders && finalPath !== result.outputPath
                        ? ` → ${path.basename(path.dirname(finalPath))}` : '';

                    setDownloads(prev => prev.map(t =>
                        t.id === taskId ? { ...t, status: 'completed', localPath: finalPath, conversionInfo: `${result.format.toUpperCase()}${info ? " " + info : ""}` } : t
                    ));
                    onStatus(`Finished: ${filename}${info} (${result.format.toUpperCase()}${folderInfo})`);
                } catch (convErr) {
                    conversionKills.current.delete(taskId);
                    progressThrottle.current.delete(taskId);
                    pendingDownloads.current.delete(baseId);
                    const errMsg = convErr instanceof Error ? convErr.message : 'Processing failed';
                    // Don't report cancellations as errors
                    if (errMsg === 'Cancelled by user') return;
                    setDownloads(prev => prev.map(t =>
                        t.id === taskId ? { ...t, status: 'error', errorMessage: 'Processing failed' } : t
                    ));
                    onStatus(`Processing Error: ${filename}`);
                }
            } else {
                let finalPath = downloadedPath;

                if (config.autoConvert.autoTag) {
                    setDownloads(prev => prev.map(t =>
                        t.id === taskId ? { ...t, status: 'converting' } : t
                    ));
                    onStatus(`Tagging: ${filename}...`);
                    finalPath = await tagAudioFile(finalPath);
                }

                if (config.autoConvert.smartFolders) {
                    finalPath = await applySmartFolders(finalPath, config);
                }

                const folderInfo = config.autoConvert.smartFolders && finalPath !== downloadedPath
                    ? ` → ${path.basename(path.dirname(finalPath))}` : '';

                progressThrottle.current.delete(taskId);
                pendingDownloads.current.delete(baseId);
                setDownloads(prev => prev.map(t =>
                    t.id === taskId ? { ...t, status: 'completed', localPath: finalPath, progress: 100, conversionInfo: config.autoConvert.autoTag ? 'Original (Tagged)' : 'Original' } : t
                ));
                onStatus(`Finished: ${filename}${folderInfo}`);
            }
        })
        .catch((err) => {
            progressThrottle.current.delete(taskId);
            pendingDownloads.current.delete(baseId);
            if (err.message === 'Cancelled by user') return;
            setDownloads(prev => prev.map(t =>
                t.id === taskId ? { ...t, status: 'error', errorMessage: err.message } : t
            ));
            onStatus(`Error: ${err.message}`);
        });
    };

    const handleCancelDownload = (id: string) => {
        const task = downloads.find(t => t.id === id);
        if (!task) return;

        if (task.status === 'downloading') {
            cancelDownload(id, task.localPath);
        } else if (task.status === 'converting') {
            // Kill the active ffmpeg conversion process
            const killFn = conversionKills.current.get(id);
            if (killFn) {
                killFn();
                conversionKills.current.delete(id);
            }
        } else {
            return; // Nothing to cancel for completed/error tasks
        }

        setDownloads(prev => prev.map(t =>
            t.id === id ? { ...t, status: 'error', errorMessage: 'Cancelled by user' } : t
        ));
        onStatus(`Cancelled: ${task.filename}`);
    };

    const handleClearFinished = () => {
        setDownloads(prev => prev.filter(t => t.status === 'downloading' || t.status === 'converting'));
        onStatus('Cleared finished downloads');
    };

    return {
        downloads,
        downloadedIds,
        handleDownload,
        handleCancelDownload,
        handleClearFinished
    };
}
