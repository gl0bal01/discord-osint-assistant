import { describe, it, expect } from 'vitest';
import { shodanFaviconHash } from '../../utils/favicon-hash.js';

// Reference values from Python: mmh3.hash(codecs.encode(data, 'base64')), as Shodan computes it.
describe('shodanFaviconHash', () => {
    it('matches Python mmh3 over newline-wrapped base64', () => {
        expect(shodanFaviconHash(Buffer.alloc(0))).toBe(0);
        expect(shodanFaviconHash(Buffer.from('hello'))).toBe(1155597304);
    });

    it('wraps long input at 76 chars (multi-line base64)', () => {
        const data = Buffer.from(Array.from({ length: 768 }, (_, i) => i % 256));
        expect(shodanFaviconHash(data)).toBe(1836528006);
    });

    it('returns a signed 32-bit integer', () => {
        const hashes = Array.from({ length: 64 }, (_, i) => shodanFaviconHash(Buffer.from(`icon-${i}`)));
        expect(hashes.every((h) => Number.isInteger(h) && h >= -(2 ** 31) && h < 2 ** 31)).toBe(true);
        expect(hashes.some((h) => h < 0)).toBe(true);
    });
});
