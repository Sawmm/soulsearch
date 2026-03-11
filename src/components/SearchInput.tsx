import React from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { THEME } from '../theme.js';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    isFocused?: boolean;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, onSubmit, isFocused = true }) => {
    // Intercept special deletion keys before they reach TextInput
    useInput((input, key) => {
        if (!isFocused) return;

        // Sequence mapping for different terminals/OS
        // ghostty/macOS specific handling
        const isWordDelete = 
            (key.backspace && (key.ctrl || key.meta)) || 
            input === '\u0017' || // Ctrl+W
            input === '\u001b\u007f' || // Alt+Backspace (macOS)
            input === '\u001b\u0008';

        const isLineDelete = 
            input === '\u0015' || // Ctrl+U (Standard)
            (key.ctrl && input === 'u') || // Literal Ctrl+U interpretation
            (key.meta && key.backspace); // Cmd+Backspace mapping

        if (isLineDelete) {
            // Use a slight delay to allow any pending TextInput updates to settle, 
            // then force the clear. This prevents the "u" from appearing.
            process.nextTick(() => onChange(''));
            return;
        }

        if (isWordDelete) {
            const newValue = value.replace(/(\s*\S+\s*)$/, '');
            process.nextTick(() => onChange(newValue));
            return;
        }
    });

    return (
        <Box borderStyle="round" borderColor={isFocused ? THEME.ACCENT : THEME.DIM} paddingX={1}>
            <Text color={isFocused ? THEME.SUCCESS : THEME.DIM} bold> SEARCH </Text>
            <Box marginLeft={1}>
                {isFocused ? (
                    <TextInput
                        value={value}
                        onChange={onChange}
                        onSubmit={onSubmit}
                        placeholder="artist, album, or song..."
                    />
                ) : (
                    <Text color={THEME.DIM}>{value || "artist, album, or song..."}</Text>
                )}
            </Box>
        </Box>
    );
};
