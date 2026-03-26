import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';
import { MusicBrainzResult } from '../types.js';

interface MusicBrainzViewProps {
    result: MusicBrainzResult | null;
    loading: boolean;
    error: string | null;
}

export const MusicBrainzView: React.FC<MusicBrainzViewProps> = ({ result, loading, error }) => {
    if (loading) {
        return (
            <Box padding={2} borderStyle="single" borderColor={THEME.INFO} justifyContent="center">
                <Text color={THEME.INFO}>looking up musicbrainz...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box padding={2} borderStyle="single" borderColor={THEME.ERROR} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.ERROR}>lookup failed</Text>
                <Text color={THEME.DIM}>{error}</Text>
                <Box marginTop={1}><Text color={THEME.DIM}>esc · back</Text></Box>
            </Box>
        );
    }

    if (!result) {
        return (
            <Box padding={2} borderStyle="single" borderColor={THEME.DIM} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.DIM}>no musicbrainz entry found</Text>
                <Box marginTop={1}><Text color={THEME.DIM}>esc · back</Text></Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" borderStyle="single" borderColor={THEME.ACCENT} padding={1}>
            <Box marginBottom={1}>
                <Text color={THEME.ACCENT}>musicbrainz</Text>
            </Box>

            <Box flexDirection="column" marginBottom={1}>
                {[
                    ['track',   result.recordingTitle],
                    ['artist',  result.artist || '—'],
                    ['album',   result.album || '—'],
                    ['year',    result.year || '—'],
                    ['label',   result.label || '—'],
                    ['country', result.country || '—'],
                ].map(([label, value]) => (
                    <Box key={label}>
                        <Box width={10}><Text color={THEME.DIM}>{label}</Text></Box>
                        <Text color={THEME.PRIMARY}>{value}</Text>
                    </Box>
                ))}
            </Box>

            {result.releaseMbid && (
                <Text color={THEME.DIM} wrap="truncate">mbid  {result.releaseMbid}</Text>
            )}

            <Box marginTop={1}><Text color={THEME.DIM}>esc · back</Text></Box>
        </Box>
    );
};
