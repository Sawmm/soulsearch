import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';
import type { DownloadTask } from '../types.js';

interface DownloadViewProps {
    downloads: DownloadTask[];
    isFocused?: boolean;
    onCancel: (id: string) => void;
    onClear: () => void;
    onPlay: (localPath: string, filename: string) => void;
}

function progressBar(percent: number, width = 12): string {
    const filled = Math.round((percent / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function statusIcon(status: DownloadTask['status'], isCancelled: boolean): string {
    if (isCancelled) return '✗';
    switch (status) {
        case 'downloading': return '↓';
        case 'converting':  return '⟳';
        case 'completed':   return '✓';
        case 'error':       return '✗';
    }
}

export const DownloadView: React.FC<DownloadViewProps> = ({ downloads, isFocused = false, onCancel, onClear, onPlay }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const VIEWPORT_SIZE = 15;

    useEffect(() => {
        const len = downloads.length;
        if (len === 0) {
            setSelectedIndex(0);
            setScrollOffset(0);
        } else {
            setSelectedIndex(prev => Math.min(prev, len - 1));
            setScrollOffset(prev => Math.min(prev, Math.max(0, len - VIEWPORT_SIZE)));
        }
    }, [downloads.length]);

    useInput((input, key) => {
        if (!isFocused || downloads.length === 0) {
            if (isFocused && input === 'c') onClear();
            return;
        }

        let nextIndex = selectedIndex;
        if (key.downArrow || input === 'j') nextIndex = Math.min(selectedIndex + 1, downloads.length - 1);
        else if (key.upArrow || input === 'k') nextIndex = Math.max(selectedIndex - 1, 0);
        else if (input === 'G') nextIndex = downloads.length - 1;
        else if (input === 'g') nextIndex = 0;
        else if (input === 'x') { onCancel(downloads[selectedIndex].id); }
        else if (input === 'c') { onClear(); }
        else if (input === ' ') {
            const task = downloads[selectedIndex];
            if (task?.status === 'completed' && task.localPath) {
                onPlay(task.localPath, task.filename);
            }
        }

        if (nextIndex !== selectedIndex) {
            setSelectedIndex(nextIndex);
            if (nextIndex < scrollOffset) setScrollOffset(nextIndex);
            else if (nextIndex >= scrollOffset + VIEWPORT_SIZE) setScrollOffset(nextIndex - VIEWPORT_SIZE + 1);
        }
    });

    if (downloads.length === 0) {
        return (
            <Box padding={2} borderStyle="single" borderColor={THEME.DIM} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.DIM}>no downloads yet</Text>
                <Box marginTop={1}>
                    <Text color={THEME.DIM}>tab · results</Text>
                </Box>
            </Box>
        );
    }

    const visibleDownloads = downloads.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE);

    return (
        <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? THEME.ACCENT : THEME.DIM}>
            <Box paddingX={1}>
                <Box width="5%"><Text color={isFocused ? THEME.INFO : THEME.DIM}> </Text></Box>
                <Box width="35%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>filename</Text></Box>
                <Box width="12%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>user</Text></Box>
                <Box width="20%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>progress</Text></Box>
                <Box width="28%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>info</Text></Box>
            </Box>

            {visibleDownloads.map((task, index) => {
                const actualIndex = scrollOffset + index;
                const isSelected = isFocused && actualIndex === selectedIndex;
                const isCancelled = task.status === 'error' && task.errorMessage === 'Cancelled by user';

                let statusColor = THEME.INFO;
                if (task.status === 'completed') statusColor = THEME.SUCCESS;
                if (task.status === 'error') statusColor = THEME.ERROR;
                if (task.status === 'converting') statusColor = THEME.WARNING;

                const icon = statusIcon(task.status, isCancelled);

                return (
                    <Box
                        key={task.id}
                        paddingX={1}
                        backgroundColor={isSelected ? THEME.BG_SELECT : undefined}
                    >
                        <Box width="5%">
                            <Text color={statusColor}>{isSelected ? '› ' : `${icon} `}</Text>
                        </Box>
                        <Box width="35%">
                            <Text
                                color={isSelected ? THEME.PRIMARY : (isFocused ? THEME.PRIMARY : THEME.DIM)}
                                wrap="truncate"
                                strikethrough={isCancelled}
                            >
                                {task.filename}
                            </Text>
                        </Box>
                        <Box width="12%">
                            <Text color={isFocused ? THEME.INFO : THEME.DIM} wrap="truncate" strikethrough={isCancelled}>
                                {task.username}
                            </Text>
                        </Box>
                        <Box width="20%">
                            <Text color={isFocused ? statusColor : THEME.DIM}>
                                {isCancelled
                                    ? 'cancelled'
                                    : task.status === 'completed'
                                    ? `${progressBar(100)} 100%`
                                    : `${progressBar(task.progress)} ${task.progress}%`
                                }
                            </Text>
                        </Box>
                        <Box width="28%">
                            <Text color={isFocused ? THEME.WARNING : THEME.DIM} wrap="truncate" strikethrough={isCancelled}>
                                {task.conversionInfo || (task.status === 'completed' ? 'original' : '')}
                            </Text>
                        </Box>
                    </Box>
                );
            })}

            <Box paddingX={1} paddingTop={0} justifyContent="space-between">
                <Text color={THEME.DIM}>
                    {isFocused ? 'x:cancel  c:clear  space:play' : 'tab · downloads'}
                </Text>
                <Text color={THEME.DIM}>{selectedIndex + 1}/{downloads.length}</Text>
            </Box>
        </Box>
    );
};
