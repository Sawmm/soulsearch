import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';
import type { DownloadTask } from '../types.js';
import { formatSize } from '../utils.js';

interface DownloadViewProps {
    downloads: DownloadTask[];
    isFocused?: boolean;
    onCancel: (id: string) => void;
    onClear: () => void;
    onPlay: (localPath: string, filename: string) => void;
}

export const DownloadView: React.FC<DownloadViewProps> = ({ downloads, isFocused = false, onCancel, onClear, onPlay }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const VIEWPORT_SIZE = 15;

    useEffect(() => {
        if (downloads.length === 0) {
            setSelectedIndex(0);
            setScrollOffset(0);
        } else if (selectedIndex >= downloads.length) {
            const clamped = downloads.length - 1;
            setSelectedIndex(clamped);
            if (clamped < scrollOffset) setScrollOffset(clamped);
        }
    }, [downloads.length, selectedIndex, scrollOffset]);

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
        else if (input === 'x') {
            onCancel(downloads[selectedIndex].id);
        } else if (input === 'c') {
            onClear();
        } else if (input === ' ') {
            const task = downloads[selectedIndex];
            if (task && task.status === 'completed' && task.localPath) {
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
            <Box padding={2} borderStyle="round" borderColor={THEME.DIM} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.DIM}> No active or past downloads... </Text>
                <Box marginTop={1}>
                    <Text color={THEME.DIM}> Press Tab to view results </Text>
                </Box>
            </Box>
        );
    }

    const visibleDownloads = downloads.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={isFocused ? THEME.ACCENT : THEME.DIM}>
            <Box paddingX={1} marginBottom={1}>
                <Box width="30%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> FILENAME </Text></Box>
                <Box width="10%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> USER </Text></Box>
                <Box width="20%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> PROGRESS </Text></Box>
                <Box width="30%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> CONVERSION </Text></Box>
                <Box width="10%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> STATUS </Text></Box>
            </Box>
            
            {visibleDownloads.map((task, index) => {
                const actualIndex = scrollOffset + index;
                const isSelected = isFocused && actualIndex === selectedIndex;
                const isCancelled = task.status === 'error' && task.errorMessage === 'Cancelled by user';
                
                let statusColor = THEME.INFO;
                if (task.status === "completed") statusColor = THEME.SUCCESS;
                if (task.status === "error") statusColor = THEME.ERROR;

                return (
                    <Box key={task.id} 
                         paddingX={1}
                         backgroundColor={isSelected ? THEME.BG_SELECT : undefined}>
                        <Box width="30%">
                            <Text color={isSelected ? THEME.PRIMARY : (isFocused ? THEME.PRIMARY : THEME.DIM)} 
                                  wrap="truncate" 
                                  bold={isSelected}
                                  strikethrough={isCancelled}>
                                {isSelected ? '▶ ' : ''}{task.filename}
                            </Text>
                        </Box>
                        <Box width="10%"><Text color={isFocused ? THEME.INFO : THEME.DIM} wrap="truncate" strikethrough={isCancelled}>{task.username}</Text></Box>
                        <Box width="20%">
                            <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>
                                {isCancelled ? '[ CANCELLED ]' : `[${"█".repeat(Math.floor(task.progress / 10))}${" ".repeat(10 - Math.floor(task.progress / 10))}] ${task.progress}%`}
                            </Text>
                        </Box>
                        <Box width="30%">
                            <Text color={isFocused ? THEME.WARNING : THEME.DIM} wrap="truncate" strikethrough={isCancelled}>
                                {task.conversionInfo || (task.status === "completed" ? "Original" : "")}
                            </Text>
                        </Box>
                        <Box width="10%">
                            <Text color={isFocused ? statusColor : THEME.DIM} bold={isSelected}>{task.status.toUpperCase()}</Text>
                        </Box>
                    </Box>
                );
            })}
            
            <Box paddingX={1} paddingTop={1} justifyContent="space-between">
                <Text color={THEME.DIM}> 
                    {isFocused ? '[x] Cancel  [c] Clear  [Space] Play  [Tab] Results' : 'Tab to view results'}
                </Text>
                <Text color={THEME.INFO}>
                    {selectedIndex + 1}/{downloads.length}
                </Text>
            </Box>
        </Box>
    );
};
