import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { THEME } from '../theme.js';
import { AppConfig, SearchResult, SearchResultFile } from '../types.js';
import { formatSize } from '../utils.js';
import * as path from 'path';

interface ResultTableProps {
    results: SearchResult[];
    submittedQuery: string;
    isFocused?: boolean;
    onDownload: (username: string, file: SearchResultFile) => void;
    onYoutube: (filename: string) => void;
    onDiscogs: (filename: string) => void;
    config: AppConfig;
    downloadedIds: Set<string>;
    onFilterStateChange?: (isFiltering: boolean) => void;
    onDrillStateChange?: (isDrilling: boolean) => void;
}

type FolderGroup = {
    user: string;
    hasFreeUploadSlot: boolean;
    folderPath: string;
    folderName: string;
    files: SearchResultFile[];
    totalSize: number;
    formats: string[];
    maxBitrate: number;
};

function getFolderPath(filename: string): string {
    return filename.replace(/[/\\][^/\\]+$/, '');
}

function buildFolderGroups(
    flattenedResults: { user: string; file: SearchResultFile; hasFreeUploadSlot: boolean }[]
): FolderGroup[] {
    const map = new Map<string, FolderGroup>();
    for (const item of flattenedResults) {
        const folderPath = getFolderPath(item.file.filename);
        const key = `${item.user}\0${folderPath}`;
        if (!map.has(key)) {
            const segments = folderPath.split(/[/\\]/);
            const folderName = segments[segments.length - 1] || folderPath;
            map.set(key, {
                user: item.user,
                hasFreeUploadSlot: item.hasFreeUploadSlot,
                folderPath,
                folderName,
                files: [],
                totalSize: 0,
                formats: [],
                maxBitrate: 0,
            });
        }
        const group = map.get(key)!;
        group.files.push(item.file);
        group.totalSize += item.file.size;
        const ext = path.extname(item.file.filename).slice(1).toUpperCase();
        if (ext && !group.formats.includes(ext)) group.formats.push(ext);
        if (item.file.bitRate && item.file.bitRate > group.maxBitrate) group.maxBitrate = item.file.bitRate;
    }
    return Array.from(map.values());
}

export const ResultTable: React.FC<ResultTableProps> = ({
    results,
    submittedQuery,
    isFocused = false,
    onDownload,
    onYoutube,
    onDiscogs,
    config,
    downloadedIds,
    onFilterStateChange,
    onDrillStateChange,
}) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [isFiltering, setIsFiltering] = useState(false);
    const [filterText, setFilterText] = useState('');
    const [viewMode, setViewMode] = useState<'files' | 'folders'>('folders');
    const [drillFolder, setDrillFolder] = useState<FolderGroup | null>(null);

    // Saved cursor positions when switching views
    const savedFilesPos = useRef({ index: 0, scroll: 0 });
    const savedFoldersPos = useRef({ index: 0, scroll: 0 });

    const VIEWPORT_SIZE = config.ui.viewportSize;

    const flattenedResults = useMemo(() => {
        let list: { user: string; file: SearchResultFile; hasFreeUploadSlot: boolean }[] = [];
        results.forEach(result => {
            result.files.forEach(file => {
                list.push({ user: result.username, file, hasFreeUploadSlot: result.hasFreeUploadSlot });
            });
        });
        if (filterText) {
            const lowerFilter = filterText.toLowerCase();
            list = list.filter(r =>
                r.user.toLowerCase().includes(lowerFilter) ||
                r.file.filename.toLowerCase().includes(lowerFilter)
            );
        }
        list.sort((a, b) => {
            let valA: any = 0, valB: any = 0;
            switch (config.search.sortBy) {
                case 'size':    valA = a.file.size;          valB = b.file.size;          break;
                case 'bitrate': valA = a.file.bitRate || 0;  valB = b.file.bitRate || 0;  break;
                case 'user':    valA = a.user.toLowerCase(); valB = b.user.toLowerCase(); break;
                default:        valA = a.file.size;          valB = b.file.size;
            }
            if (valA === valB) return 0;
            return config.search.sortOrder === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
        return list;
    }, [results, filterText, config.search.sortBy, config.search.sortOrder]);

    const folderGroups = useMemo(() => {
        return buildFolderGroups(flattenedResults).sort((a, b) => {
            switch (config.search.sortBy) {
                case 'size':    return config.search.sortOrder === 'desc' ? b.totalSize - a.totalSize : a.totalSize - b.totalSize;
                case 'bitrate': return config.search.sortOrder === 'desc' ? b.maxBitrate - a.maxBitrate : a.maxBitrate - b.maxBitrate;
                case 'user':    return config.search.sortOrder === 'desc' ? b.user.localeCompare(a.user) : a.user.localeCompare(b.user);
                default:        return b.totalSize - a.totalSize;
            }
        });
    }, [flattenedResults, config.search.sortBy, config.search.sortOrder]);

    const activeList = viewMode === 'folders' ? folderGroups : flattenedResults;
    const drillFiles = drillFolder?.files ?? [];

    useEffect(() => {
        onFilterStateChange?.(isFiltering);
    }, [isFiltering, onFilterStateChange]);

    useEffect(() => {
        onDrillStateChange?.(drillFolder !== null);
    }, [drillFolder, onDrillStateChange]);

    useEffect(() => {
        setFilterText('');
        setIsFiltering(false);
        setDrillFolder(null);
        setSelectedIndex(0);
        setScrollOffset(0);
        savedFilesPos.current = { index: 0, scroll: 0 };
        savedFoldersPos.current = { index: 0, scroll: 0 };
    }, [submittedQuery]);

    // Clamp cursor to bounds as results stream in (skip while in drill — cursor managed manually there)
    useEffect(() => {
        if (drillFolder !== null) return;
        const len = activeList.length;
        if (len === 0) {
            setSelectedIndex(0);
            setScrollOffset(0);
        } else {
            setSelectedIndex(prev => Math.min(prev, len - 1));
            setScrollOffset(prev => Math.min(prev, Math.max(0, len - VIEWPORT_SIZE)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeList.length, VIEWPORT_SIZE]);

    useInput((input, key) => {
        if (!isFocused) return;

        if (isFiltering) {
            if (key.escape || key.return) {
                setIsFiltering(false);
                if (key.escape) setFilterText('');
                return;
            }
            const isDeleteWord = input === '\x17' || input === '\x1b\x7f' || input === '\x1b\x08' || (key.ctrl && key.backspace);
            const isKillLine = input === '\x15' || (key.ctrl && input === 'u') || (key.meta && key.backspace);
            if (isDeleteWord) { setFilterText(prev => prev.replace(/(\s*\S+\s*)$/, '')); return; }
            if (isKillLine) { setFilterText(''); return; }
            return;
        }

        // Esc exits drill mode (App.tsx Esc handler is blocked when drilling via onDrillStateChange)
        if (key.escape && drillFolder) {
            setDrillFolder(null);
            setSelectedIndex(savedFoldersPos.current.index);
            setScrollOffset(savedFoldersPos.current.scroll);
            return;
        }

        if (input === 'f' || input === '/') {
            setIsFiltering(true);
            setSelectedIndex(0);
            setScrollOffset(0);
            return;
        }

        // v: toggle between folder list and flat file list, preserving cursor position
        if (input === 'v' && !drillFolder) {
            if (viewMode === 'files') {
                savedFilesPos.current = { index: selectedIndex, scroll: scrollOffset };
                // Try to land on the folder containing the currently selected file
                const cur = flattenedResults[selectedIndex];
                let newIndex = savedFoldersPos.current.index;
                if (cur) {
                    const fp = getFolderPath(cur.file.filename);
                    const fi = folderGroups.findIndex(g => g.user === cur.user && g.folderPath === fp);
                    if (fi >= 0) newIndex = fi;
                }
                const newScroll = Math.min(newIndex, Math.max(0, folderGroups.length - VIEWPORT_SIZE));
                setViewMode('folders');
                setSelectedIndex(newIndex);
                setScrollOffset(newScroll);
            } else {
                savedFoldersPos.current = { index: selectedIndex, scroll: scrollOffset };
                // Try to land on the first file of the currently selected folder
                const cur = folderGroups[selectedIndex];
                let newIndex = savedFilesPos.current.index;
                if (cur) {
                    const fi = flattenedResults.findIndex(r =>
                        r.user === cur.user && getFolderPath(r.file.filename) === cur.folderPath
                    );
                    if (fi >= 0) newIndex = fi;
                }
                const newScroll = Math.min(newIndex, Math.max(0, flattenedResults.length - VIEWPORT_SIZE));
                setViewMode('files');
                setSelectedIndex(newIndex);
                setScrollOffset(newScroll);
            }
            return;
        }

        const currentLen = drillFolder ? drillFiles.length : activeList.length;
        if (currentLen === 0) return;

        let nextIndex = selectedIndex;
        if (key.downArrow || input === 'j') nextIndex = Math.min(selectedIndex + 1, currentLen - 1);
        else if (key.upArrow || input === 'k') nextIndex = Math.max(selectedIndex - 1, 0);
        else if (input === 'G') nextIndex = currentLen - 1;
        else if (input === 'g') nextIndex = 0;
        else if (key.return) {
            if (drillFolder) {
                // Download selected file from drill view
                const file = drillFiles[selectedIndex];
                if (file) {
                    const fileId = `${drillFolder.user}:${file.filename}`;
                    if (!downloadedIds.has(fileId)) onDownload(drillFolder.user, file);
                }
            } else if (viewMode === 'folders') {
                // Drill into folder
                const group = folderGroups[selectedIndex];
                if (group) {
                    savedFoldersPos.current = { index: selectedIndex, scroll: scrollOffset };
                    setDrillFolder(group);
                    setSelectedIndex(0);
                    setScrollOffset(0);
                }
            } else {
                const item = flattenedResults[selectedIndex];
                if (item) {
                    const fileId = `${item.user}:${item.file.filename}`;
                    if (!downloadedIds.has(fileId)) onDownload(item.user, item.file);
                }
            }
        } else if (input === 'a') {
            // Download all files in current context
            if (drillFolder) {
                drillFolder.files.forEach(file => {
                    const fileId = `${drillFolder.user}:${file.filename}`;
                    if (!downloadedIds.has(fileId)) onDownload(drillFolder.user, file);
                });
            } else if (viewMode === 'folders') {
                const group = folderGroups[selectedIndex];
                if (group) {
                    group.files.forEach(file => {
                        const fileId = `${group.user}:${file.filename}`;
                        if (!downloadedIds.has(fileId)) onDownload(group.user, file);
                    });
                }
            } else {
                const item = flattenedResults[selectedIndex];
                if (item) {
                    const fp = getFolderPath(item.file.filename);
                    flattenedResults
                        .filter(r => r.user === item.user && getFolderPath(r.file.filename) === fp)
                        .forEach(r => {
                            const fileId = `${r.user}:${r.file.filename}`;
                            if (!downloadedIds.has(fileId)) onDownload(r.user, r.file);
                        });
                }
            }
        } else if (input === 'y' && !drillFolder && viewMode === 'files') {
            const item = flattenedResults[selectedIndex];
            if (!item) return;
            const parts = item.file.filename.split(/[\\/]/);
            let filename = parts[parts.length - 1] || item.file.filename;
            filename = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
            onYoutube(filename);
        } else if (input === 'd' && !drillFolder && viewMode === 'files') {
            const item = flattenedResults[selectedIndex];
            if (!item) return;
            const parts = item.file.filename.split(/[\\/]/);
            let filename = parts[parts.length - 1] || item.file.filename;
            filename = filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
            onDiscogs(filename);
        }

        if (nextIndex !== selectedIndex) {
            setSelectedIndex(nextIndex);
            if (nextIndex < scrollOffset) setScrollOffset(nextIndex);
            else if (nextIndex >= scrollOffset + VIEWPORT_SIZE) setScrollOffset(nextIndex - VIEWPORT_SIZE + 1);
        }
    });

    if (results.length === 0) {
        return (
            <Box padding={2} borderStyle="single" borderColor={THEME.DIM} justifyContent="center">
                <Text color={THEME.DIM}>waiting for results...</Text>
            </Box>
        );
    }

    const sortArrow = config.search.sortOrder === 'desc' ? '↓' : '↑';
    const borderColor = isFocused ? (isFiltering ? THEME.WARNING : THEME.ACCENT) : THEME.DIM;

    // ── Drill view: files inside a specific folder ──────────────────────────
    if (drillFolder) {
        return (
            <Box flexDirection="column" borderStyle="single" borderColor={borderColor}>
                <Box paddingX={1}>
                    <Text color={THEME.WARNING}>↳ </Text>
                    <Text color={isFocused ? THEME.WARNING : THEME.DIM}>{drillFolder.user} / </Text>
                    <Text color={isFocused ? THEME.ACCENT : THEME.DIM}>{drillFolder.folderName}</Text>
                </Box>

                <Box paddingX={1}>
                    <Box width="55%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>filename</Text></Box>
                    <Box width="15%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>size</Text></Box>
                    {config.ui.showBitrate && (
                        <Box width="10%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>kbps</Text></Box>
                    )}
                    {config.ui.showSlots && (
                        <Box width="10%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>slots</Text></Box>
                    )}
                </Box>

                {drillFiles.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE).map((file, index) => {
                    const actualIndex = scrollOffset + index;
                    const isSelected = isFocused && actualIndex === selectedIndex;
                    const fileId = `${drillFolder.user}:${file.filename}`;
                    const isAlreadyDownloaded = downloadedIds.has(fileId);
                    const parts = file.filename.split(/[\\/]/);
                    const filename = parts[parts.length - 1] || file.filename;
                    const nameColor = isAlreadyDownloaded ? THEME.SUCCESS : isFocused ? THEME.PRIMARY : THEME.DIM;

                    return (
                        <Box
                            key={`${file.filename}-${file.size}`}
                            paddingX={1}
                            backgroundColor={isSelected ? THEME.BG_SELECT : undefined}
                        >
                            <Box width="55%">
                                <Text color={isSelected ? THEME.WARNING : nameColor} wrap="truncate" strikethrough={isAlreadyDownloaded}>
                                    {isSelected ? '› ' : '  '}{filename}
                                </Text>
                            </Box>
                            <Box width="15%">
                                <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{formatSize(file.size)}</Text>
                            </Box>
                            {config.ui.showBitrate && (
                                <Box width="10%">
                                    <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{file.bitRate || '—'}</Text>
                                </Box>
                            )}
                            {config.ui.showSlots && (
                                <Box width="10%">
                                    <Text color={drillFolder.hasFreeUploadSlot ? THEME.SUCCESS : THEME.DIM}>
                                        {drillFolder.hasFreeUploadSlot ? 'open' : 'queued'}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    );
                })}

                <Box paddingX={1} justifyContent="space-between">
                    <Text color={THEME.DIM}>
                        {drillFiles.length} files  <Text color={THEME.ACCENT}>esc:back  enter:download  a:all</Text>
                    </Text>
                    <Text color={THEME.DIM}>{selectedIndex + 1}/{drillFiles.length}</Text>
                </Box>
            </Box>
        );
    }

    // ── Folder list view ─────────────────────────────────────────────────────
    if (viewMode === 'folders') {
        return (
            <Box flexDirection="column" borderStyle="single" borderColor={borderColor}>
                {isFiltering && (
                    <Box paddingX={1}>
                        <Text color={THEME.WARNING}>filter  </Text>
                        {/* @ts-ignore */}
                        <TextInput value={filterText} onChange={setFilterText} focus={isFiltering} />
                    </Box>
                )}

                <Box paddingX={1}>
                    <Box width="15%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>user</Text></Box>
                    <Box width="45%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>folder</Text></Box>
                    <Box width="8%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>files</Text></Box>
                    <Box width="15%">
                        <Text color={isFocused ? THEME.INFO : THEME.DIM}>
                            size{config.search.sortBy === 'size' ? ` ${sortArrow}` : ''}
                        </Text>
                    </Box>
                    <Box width="10%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>format</Text></Box>
                    {config.ui.showSlots && (
                        <Box width="7%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>slots</Text></Box>
                    )}
                </Box>

                {folderGroups.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE).map((group, index) => {
                    const actualIndex = scrollOffset + index;
                    const isSelected = isFocused && actualIndex === selectedIndex;
                    const allDownloaded = group.files.every(f => downloadedIds.has(`${group.user}:${f.filename}`));
                    const nameColor = allDownloaded ? THEME.SUCCESS : isFocused ? THEME.PRIMARY : THEME.DIM;

                    return (
                        <Box
                            key={`${group.user}-${group.folderPath}`}
                            paddingX={1}
                            backgroundColor={isSelected ? THEME.BG_SELECT : undefined}
                        >
                            <Box width="15%">
                                <Text color={isSelected ? THEME.WARNING : (isFocused ? THEME.INFO : THEME.DIM)} wrap="truncate">
                                    {isSelected ? '› ' : '  '}{group.user}
                                </Text>
                            </Box>
                            <Box width="45%">
                                <Text color={nameColor} wrap="truncate" strikethrough={allDownloaded}>
                                    {group.folderName}
                                </Text>
                            </Box>
                            <Box width="8%">
                                <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{group.files.length}</Text>
                            </Box>
                            <Box width="15%">
                                <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{formatSize(group.totalSize)}</Text>
                            </Box>
                            <Box width="10%">
                                <Text color={isFocused ? THEME.ACCENT : THEME.DIM} wrap="truncate">
                                    {group.formats.join('/')}
                                    {group.maxBitrate > 0 && group.formats.every(f => f === 'MP3') ? ` ${group.maxBitrate}` : ''}
                                </Text>
                            </Box>
                            {config.ui.showSlots && (
                                <Box width="7%">
                                    <Text color={group.hasFreeUploadSlot ? THEME.SUCCESS : THEME.DIM}>
                                        {group.hasFreeUploadSlot ? 'open' : 'queued'}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    );
                })}

                <Box paddingX={1} justifyContent="space-between">
                    <Text color={THEME.DIM}>
                        {folderGroups.length} folders  sort:{config.search.sortBy} {sortArrow}  <Text color={THEME.ACCENT}>v:files</Text>
                    </Text>
                    <Text color={THEME.DIM}>{selectedIndex + 1}/{folderGroups.length}</Text>
                </Box>
            </Box>
        );
    }

    // ── Flat file list view ──────────────────────────────────────────────────
    return (
        <Box flexDirection="column" borderStyle="single" borderColor={borderColor}>
            {isFiltering && (
                <Box paddingX={1}>
                    <Text color={THEME.WARNING}>filter  </Text>
                    {/* @ts-ignore */}
                    <TextInput value={filterText} onChange={setFilterText} focus={isFiltering} />
                </Box>
            )}

            <Box paddingX={1}>
                <Box width="15%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>user</Text></Box>
                <Box width="50%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>filename</Text></Box>
                <Box width="15%">
                    <Text color={isFocused ? THEME.INFO : THEME.DIM}>
                        size{config.search.sortBy === 'size' ? ` ${sortArrow}` : ''}
                    </Text>
                </Box>
                {config.ui.showBitrate && (
                    <Box width="10%">
                        <Text color={isFocused ? THEME.INFO : THEME.DIM}>
                            kbps{config.search.sortBy === 'bitrate' ? ` ${sortArrow}` : ''}
                        </Text>
                    </Box>
                )}
                {config.ui.showSlots && (
                    <Box width="10%"><Text color={isFocused ? THEME.INFO : THEME.DIM}>slots</Text></Box>
                )}
            </Box>

            {flattenedResults.slice(scrollOffset, scrollOffset + VIEWPORT_SIZE).map((item, index) => {
                const actualIndex = scrollOffset + index;
                const isSelected = isFocused && actualIndex === selectedIndex;
                const fileId = `${item.user}:${item.file.filename}`;
                const isAlreadyDownloaded = downloadedIds.has(fileId);
                const parts = item.file.filename.split(/[\\/]/);
                const filename = parts[parts.length - 1] || item.file.filename;
                const nameColor = isAlreadyDownloaded ? THEME.SUCCESS : isFocused ? THEME.PRIMARY : THEME.DIM;

                return (
                    <Box
                        key={`${item.user}-${item.file.filename}-${item.file.size}`}
                        paddingX={1}
                        backgroundColor={isSelected ? THEME.BG_SELECT : undefined}
                    >
                        <Box width="15%">
                            <Text color={isSelected ? THEME.WARNING : (isFocused ? THEME.INFO : THEME.DIM)} wrap="truncate">
                                {isSelected ? '› ' : '  '}{item.user}
                            </Text>
                        </Box>
                        <Box width="50%">
                            <Text color={nameColor} wrap="truncate" strikethrough={isAlreadyDownloaded}>
                                {filename}
                            </Text>
                        </Box>
                        <Box width="15%">
                            <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{formatSize(item.file.size)}</Text>
                        </Box>
                        {config.ui.showBitrate && (
                            <Box width="10%">
                                <Text color={isFocused ? THEME.PRIMARY : THEME.DIM}>{item.file.bitRate || '—'}</Text>
                            </Box>
                        )}
                        {config.ui.showSlots && (
                            <Box width="10%">
                                <Text color={item.hasFreeUploadSlot ? THEME.SUCCESS : THEME.DIM}>
                                    {item.hasFreeUploadSlot ? 'open' : 'queued'}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            })}

            <Box paddingX={1} justifyContent="space-between">
                <Text color={THEME.DIM}>
                    {flattenedResults.length} files  sort:{config.search.sortBy} {sortArrow}  <Text color={THEME.ACCENT}>v:folders</Text>
                </Text>
                <Text color={THEME.DIM}>{selectedIndex + 1}/{flattenedResults.length}</Text>
            </Box>
        </Box>
    );
};
