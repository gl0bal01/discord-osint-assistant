import { describe, it, expect } from 'vitest';

const { splitIntoChunks } = require('../../utils/chunks.js');

describe('splitIntoChunks', () => {
    it('returns a single chunk for short text', () => {
        expect(splitIntoChunks('hello', 10)).toEqual(['hello']);
    });

    it('never produces a chunk longer than maxSize when a newline sits exactly at the limit', () => {
        const text = 'a'.repeat(9) + '\n' + 'b'.repeat(9);
        for (const c of splitIntoChunks(text, 9)) expect(c.length).toBeLessThanOrEqual(9);
    });

    it('never produces a chunk longer than maxSize for multi-line text', () => {
        const text = Array.from({ length: 200 }, (_, n) => `line ${n} ${'x'.repeat(n % 37)}`).join('\n');
        for (const max of [50, 100, 2000]) {
            for (const c of splitIntoChunks(text, max)) expect(c.length).toBeLessThanOrEqual(max);
        }
    });

    it('reassembles to the original text', () => {
        const text = Array.from({ length: 100 }, (_, n) => `row ${n}`).join('\n');
        expect(splitIntoChunks(text, 40).join('')).toBe(text);
    });

    it('prefers breaking after a newline near the limit', () => {
        const text = 'a'.repeat(8) + '\n' + 'b'.repeat(8);
        expect(splitIntoChunks(text, 12)[0]).toBe('a'.repeat(8) + '\n');
    });
});
