import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';
import { AppConfig, SearchResult, SearchResultFile } from '../types.js';

interface ResultTableProps {
    results: SearchResult[];
    isFocused?: boolean;
    onDownload: (username: string, file: SearchResultFile) => void;
    onYoutube: (filename: string) => void;
    onDiscogs: (filename: string) => void;
    config: AppConfig;
    downloadedIds: Set<string>;
}

const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const ResultTable: React.FC<ResultTableProps> = ({ 
    results, 
    isFocused = false, 
    onDownload, 
    onYoutube, 
    onDiscogs,
    config,
    downloadedIds
}) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const VIEWPORT_SIZE = config.ui.viewportSize;

    const flattenedResults: { user: string; file: SearchResultFile; hasFreeUploadSlot: boolean }[] = [];
    results.forEach(result => {
        result.files.forEach(file => {
            flattenedResults.push({ 
                user: result.username, 
                file,
                hasFreeUploadSlot: result.hasFreeUploadSlot
            });
        });
    });

    // Dynamic Sorting based on config
    flattenedResults.sort((a, b) => {
        let valA: any = 0;
        let valB: any = 0;

        switch (config.search.sortBy) {
            case 'size':
                valA = a.file.size;
                valB = b.file.size;
                break;
            case 'bitrate':
                valA = a.file.bitRate || 0;
                valB = b.file.bitRate || 0;
                break;
            case 'user':
                valA = a.user.toLowerCase();
                valB = b.user.toLowerCase();
                break;
        }

        if (config.search.sortOrder === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });

    useInput((input, key) => {
        if (!isFocused || flattenedResults.length === 0) return;
        let nextIndex = selectedIndex;
        if (key.downArrow || input === 'j') nextIndex = Math.min(selectedIndex + 1, flattenedResults.length - 1);
        else if (key.upArrow || input === 'k') nextIndex = Math.max(selectedIndex - 1, 0);
        else if (input === 'G') nextIndex = flattenedResults.length - 1;
        else if (input === 'g') nextIndex = 0;
        else if (input === 'y') {
            const item = flattenedResults[selectedIndex];
            const parts = item.file.filename.split(/[\\/]/);
            let filename = parts[parts.length - 1] || item.file.filename;
            filename = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
            onYoutube(filename);
        } else if (input === 'd') {
            const item = flattenedResults[selectedIndex];
            const parts = item.file.filename.split(/[\\/]/);
            let filename = parts[parts.length - 1] || item.file.filename;
            filename = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
            onDiscogs(filename);
        } else if (key.return) {
            const item = flattenedResults[selectedIndex];
            const fileId = `${item.user}:${item.file.filename}`;
            if (!downloadedIds.has(fileId)) {
                onDownload(item.user, item.file);
            }
        }

        if (nextIndex !== selectedIndex) {
            setSelectedIndex(nextIndex);
            if (nextIndex < scrollOffset) setScrollOffset(nextIndex);
            else if (nextIndex >= scrollOffset + VIEWPORT_SIZE) setScrollOffset(nextIndex - VIEWPORT_SIZE + 1);
        }
    });

    if (results.length === 0) {
        return (
            <Box padding={2} borderStyle="round" borderColor={THEME.DIM} justifyContent="center">
                <Text color={THEME.DIM}> Waiting for search results... </Text>
            </Box>
        );
    }

    const visibleResults = flattenedResults.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={isFocused ? THEME.ACCENT : THEME.DIM}>
            <Box paddingX={1} marginBottom={1}>
                <Box width="15%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> USER </Text></Box>
                <Box width="50%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> FILENAME </Text></Box>
                <Box width="15%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> SIZE {config.search.sortBy === 'size' ? (config.search.sortOrder === 'desc' ? '↓' : '↑') : ''} </Text></Box>
                {config.ui.showBitrate && <Box width="10%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> BITRATE </Text></Box>}
                {config.ui.showSlots && <Box width="10%"><Text bold color={isFocused ? THEME.ACCENT : THEME.DIM}> SLOTS </Text></Box>}
            </Box>
            
            {visibleResults.map((item, index) => {
                const actualIndex = scrollOffset + index;
                const isSelected = isFocused && actualIndex === selectedIndex;
                const fileId = `${item.user}:${item.file.filename}`;
                const isAlreadyDownloaded = downloadedIds.has(fileId);
                const parts = item.file.filename.split(/[\\/]/);
                const filename = parts[parts.length - 1] || item.file.filename;

                return (
                    <Box key={`${item.user}-${item.file.filename}-${item.file.size}`} 
                         paddingX={1}
                         backgroundColor={isSelected ? THEME.BG_SELECT : undefined}>
                        <Box width="15%">
                            <Text color={isSelected ? THEME.WARNING : (isFocused ? THEME.INFO : THEME.DIM)} wrap="truncate" bold={isSelected}>
                                {isSelected ? '▶ ' : ''}{item.user}
                            </Text>
                        </Box>
                        <Box width="50%">
                            <Text color={isAlreadyDownloaded ? THEME.SUCCESS : (isSelected ? THEME.PRIMARY : (isFocused ? THEME.PRIMARY : THEME.DIM))} 
                                  wrap="truncate" 
                                  bold={isSelected}
                                  strikethrough={isAlreadyDownloaded}>
                                {filename}
                            </Text>
                        </Box>
                        <Box width="15%"><Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{formatSize(item.file.size)}</Text></Box>
                        {config.ui.showBitrate && <Box width="10%"><Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{item.file.bitRate || '???'}</Text></Box>}
                        {config.ui.showSlots && (
                            <Box width="10%">
                                <Text color={item.hasFreeUploadSlot ? THEME.SUCCESS : THEME.DIM}>
                                    {item.hasFreeUploadSlot ? 'OPEN' : 'QUEUED'}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            })}
            
            <Box paddingX={1} paddingTop={1} justifyContent="space-between">
                <Text color={THEME.DIM}> 
                    {flattenedResults.length} files • Sort: {config.search.sortBy} ({config.search.sortOrder})
                </Text>
                <Text color={THEME.INFO}>
                    Row {selectedIndex + 1}/{flattenedResults.length}
                </Text>
            </Box>
        </Box>
    );
};
