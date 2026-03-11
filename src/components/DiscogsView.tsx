import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';
import { DiscogsResult } from '../types.js';

interface DiscogsViewProps {
    result: DiscogsResult | null;
    loading: boolean;
    error: string | null;
}

export const DiscogsView: React.FC<DiscogsViewProps> = ({ result, loading, error }) => {
    if (loading) {
        return (
            <Box padding={2} borderStyle="round" borderColor={THEME.INFO} justifyContent="center">
                <Text color={THEME.INFO}> Fetching Discogs data... </Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box padding={2} borderStyle="round" borderColor={THEME.ERROR} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.ERROR}> Discogs Lookup Failed </Text>
                <Text color={THEME.DIM}> {error} </Text>
                <Box marginTop={1}>
                    <Text color={THEME.DIM}> Press Esc to go back </Text>
                </Box>
            </Box>
        );
    }

    if (!result) {
        return (
            <Box padding={2} borderStyle="round" borderColor={THEME.DIM} justifyContent="center" flexDirection="column" alignItems="center">
                <Text color={THEME.DIM}> No Discogs release found for this file. </Text>
                <Box marginTop={1}>
                    <Text color={THEME.DIM}> Press Esc to go back </Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={THEME.ACCENT} padding={1}>
            <Box marginBottom={1} borderBottom borderStyle="single" borderColor={THEME.ACCENT}>
                <Text bold color={THEME.ACCENT}> DISCOGS RELEASE INFO </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1}>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Title:</Text></Box>
                    <Text color={THEME.PRIMARY} bold>{result.title}</Text>
                </Box>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Year:</Text></Box>
                    <Text color={THEME.PRIMARY}>{result.year || 'N/A'}</Text>
                </Box>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Label:</Text></Box>
                    <Text color={THEME.PRIMARY}>{result.label?.join(', ') || 'N/A'}</Text>
                </Box>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Country:</Text></Box>
                    <Text color={THEME.PRIMARY}>{result.country || 'N/A'}</Text>
                </Box>
            </Box>

            <Box flexDirection="column" marginBottom={1}>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Genre:</Text></Box>
                    <Text color={THEME.SUCCESS}>{result.genre?.join(', ') || 'N/A'}</Text>
                </Box>
                <Box>
                    <Box width={12}><Text color={THEME.INFO}>Style:</Text></Box>
                    <Text color={THEME.SUCCESS}>{result.style?.join(', ') || 'N/A'}</Text>
                </Box>
            </Box>

            <Box marginTop={1} borderTop borderStyle="single" borderColor={THEME.DIM} paddingTop={1} flexDirection="column">
                <Text color={THEME.DIM} wrap="truncate"> URL: {result.resource_url} </Text>
                <Box marginTop={1}>
                    <Text color={THEME.DIM}> Press Esc to go back </Text>
                </Box>
            </Box>
        </Box>
    );
};
