import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';
import type { DownloadTask } from '../types.js';

interface DownloadViewProps {
    downloads: DownloadTask[];
    isFocused?: boolean;
    onCancel: (id: string) => void;
    onClear: () => void;
}

const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const DownloadView: React.FC<DownloadViewProps> = ({ downloads, isFocused = false, onCancel, onClear }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const VIEWPORT_SIZE = 15;

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
                <Box width="40%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> FILENAME </Text></Box>
                <Box width="15%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> USER </Text></Box>
                <Box width="15%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> SIZE </Text></Box>
                <Box width="20%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> PROGRESS </Text></Box>
                <Box width="10%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> STATUS </Text></Box>
            </Box>
            
            {visibleDownloads.map((task, index) => {
                const actualIndex = scrollOffset + index;
                const isSelected = isFocused && actualIndex === selectedIndex;
                
                let statusColor = THEME.INFO;
                if (task.status === "completed") statusColor = THEME.SUCCESS;
                if (task.status === "error") statusColor = THEME.ERROR;

                return (
                    <Box key={task.id} 
                         paddingX={1}
                         backgroundColor={isSelected ? THEME.BG_SELECT : undefined}>
                        <Box width="40%">
                            <Text color={isSelected ? THEME.PRIMARY : (isFocused ? THEME.PRIMARY : THEME.DIM)} wrap="truncate" bold={isSelected}>
                                {isSelected ? '▶ ' : ''}{task.filename}
                            </Text>
                        </Box>
                        <Box width="15%"><Text color={isFocused ? THEME.INFO : THEME.DIM} wrap="truncate">{task.username}</Text></Box>
                        <Box width="15%"><Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{formatSize(task.size)}</Text></Box>
                        <Box width="20%">
                            <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>
                                {`[${"█".repeat(Math.floor(task.progress / 10))}${" ".repeat(10 - Math.floor(task.progress / 10))}] ${task.progress}%`}
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
                    {isFocused ? '[x] Cancel  [c] Clear Finished  [Tab] Results' : 'Tab to view results'}
                </Text>
                <Text color={THEME.INFO}>
                    {selectedIndex + 1}/{downloads.length}
                </Text>
            </Box>
        </Box>
    );
};
