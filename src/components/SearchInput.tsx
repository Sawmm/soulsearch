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
    const blockNextChar = useRef<string | null>(null);

    useInput((input, key) => {
        if (!isFocused) return;

        const isKillLine = input === '\x15' || (key.ctrl && input === 'u') || (key.meta && key.backspace);
        const isDeleteWord = input === '\x17' || input === '\x1b\x7f' || input === '\x1b\x08' || (key.ctrl && key.backspace);

        if (isKillLine) {
            blockNextChar.current = key.ctrl && input === 'u' ? 'u' : null;
            onChange('');
            setTimeout(() => onChange(''), 0);
            return;
        }

        if (isDeleteWord) {
            blockNextChar.current = input === '\x17' ? 'w' : null;
            const newValue = value.replace(/(\s*\S+\s*)$/, '');
            onChange(newValue);
            setTimeout(() => onChange(newValue), 0);
            return;
        }
    });

    return (
        <Box borderStyle="single" borderColor={isFocused ? THEME.ACCENT : THEME.DIM} paddingX={1}>
            <Text color={isFocused ? THEME.ACCENT : THEME.DIM}>›</Text>
            <Box marginLeft={1}>
                {isFocused ? (
                    <TextInput
                        value={value}
                        onChange={(nextValue) => {
                            const blocked = blockNextChar.current;
                            if (blocked !== null) {
                                blockNextChar.current = null;
                                if (value === '' && nextValue === blocked) return;
                            }
                            onChange(nextValue);
                        }}
                        onSubmit={onSubmit}
                        placeholder="artist, album, or song..."
                    />
                ) : (
                    <Text color={THEME.DIM}>{value || 'artist, album, or song...'}</Text>
                )}
            </Box>
        </Box>
    );
};
