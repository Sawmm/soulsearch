import React, { useRef } from 'react';
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
    const lastClearedTime = useRef(0);

    // High-level input interceptor
    useInput((input, key) => {
        if (!isFocused) return;

        // Ghostty/macOS specific: Cmd+Backspace often sends standard Ctrl+U (\x15)
        // or a combination that Ink parses as key.ctrl + 'u'
        const isKillLine = input === '\x15' || (key.ctrl && input === 'u') || (key.meta && key.backspace);
        const isDeleteWord = input === '\x17' || input === '\x1b\x7f' || input === '\x1b\x08';

        if (isKillLine) {
            // The "Easy Fix": Simply clear the state. 
            // To prevent the 'u' from leaking in, we track the timestamp.
            lastClearedTime.current = Date.now();
            onChange('');
            // Double-tap the clear to ensure TextInput's internal state doesn't win
            setTimeout(() => onChange(''), 0);
            return;
        }

        if (isDeleteWord) {
            const newValue = value.replace(/(\s*\S+\s*)$/, '');
            onChange(newValue);
            setTimeout(() => onChange(newValue), 0);
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
                        onChange={(nextValue) => {
                            // The "Race Condition" Filter:
                            // If we just cleared the line, ignore the stray 'u' 
                            // that TextInput might try to append from the Ctrl+U event.
                            if (nextValue === 'u' && value === '' && Date.now() - lastClearedTime.current < 50) {
                                return;
                            }
                            onChange(nextValue);
                        }}
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
