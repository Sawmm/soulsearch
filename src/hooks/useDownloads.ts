import { useState, useMemo } from 'react';
import { downloadFile, cancelDownload } from '../api.js';
import { convertAudio, detectActualBitrate, applySmartFolders } from '../converter.js';
import type { DownloadTask, SearchResultFile, AppConfig } from '../types.js';

export function useDownloads(
    config: AppConfig,
    onStatus: (msg: string) => void
) {
    const [downloads, setDownloads] = useState<DownloadTask[]>([]);

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
        onStatus(`Queued: ${filename}`);

        downloadFile(taskId, username, file, (percent) => {
            setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, progress: percent } : t));
        })
        .then(async (path) => {
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
                    onStatus(`Finished: ${filename}${info} (${result.format.toUpperCase()})`);
                } catch (convErr) {
                    setDownloads(prev => prev.map(t => 
                        t.id === taskId ? { ...t, status: 'error', errorMessage: 'Processing failed' } : t
                    ));
                    onStatus(`Processing Error: ${filename}`);
                }
            } else {
                let finalPath = path;
                if (config.autoConvert.smartFolders) {
                    finalPath = await applySmartFolders(finalPath, config);
                }

                setDownloads(prev => prev.map(t => 
                    t.id === taskId ? { ...t, status: 'completed', localPath: finalPath, progress: 100, conversionInfo: 'Original' } : t
                ));
                onStatus(`Finished: ${filename}`);
            }
        })
        .catch((err) => {
            if (err.message === 'Cancelled by user') return;
            setDownloads(prev => prev.map(t => 
                t.id === taskId ? { ...t, status: 'error', errorMessage: err.message } : t
            ));
            onStatus(`Error: ${err.message}`);
        });
    };

    const handleCancelDownload = (id: string) => {
        const task = downloads.find(t => t.id === id);
        if (task && (task.status === 'downloading' || task.status === 'converting')) {
            cancelDownload(id, task.localPath);
            setDownloads(prev => prev.map(t => 
                t.id === id ? { ...t, status: 'error', errorMessage: 'Cancelled by user' } : t
            ));
            onStatus(`Cancelled: ${task.filename}`);
        }
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
