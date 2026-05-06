import { describe, it, expect, beforeEach } from 'vitest';

let checkRateLimit;

beforeEach(async () => {
    const mod = await import('../../utils/ratelimit.js');
    checkRateLimit = mod.checkRateLimit;
});

describe('checkRateLimit', () => {
    it('allows first command use', () => {
        const result = checkRateLimit('user-first', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('blocks rapid repeat of same command (atomic check-and-record)', () => {
        const first = checkRateLimit('user-repeat', 'bob-nuclei');
        expect(first.limited).toBe(false);
        const result = checkRateLimit('user-repeat', 'bob-nuclei');
        expect(result.limited).toBe(true);
        expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('allows different commands from same user', () => {
        checkRateLimit('user-diffcmd', 'bob-nuclei');
        const result = checkRateLimit('user-diffcmd', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('allows same command from different users', () => {
        checkRateLimit('user-a', 'bob-nuclei');
        const result = checkRateLimit('user-b', 'bob-nuclei');
        expect(result.limited).toBe(false);
    });

    it('classifies bob-web-recon as heavy (verifies key fix)', () => {
        // Using a fresh user, the FIRST call records and is allowed.
        // The second call within the heavy cooldown (30s) must be limited
        // and report retryAfter close to the heavy bucket window.
        checkRateLimit('user-recon', 'bob-web-recon');
        const result = checkRateLimit('user-recon', 'bob-web-recon');
        expect(result.limited).toBe(true);
        // heavy = 30s; light = 3s. Anything > 3s confirms heavy bucket.
        expect(result.retryAfter).toBeGreaterThan(3);
    });

    it('classifies bob-favicon (verifies key fix)', () => {
        checkRateLimit('user-fav', 'bob-favicon');
        const result = checkRateLimit('user-fav', 'bob-favicon');
        expect(result.limited).toBe(true);
        expect(result.retryAfter).toBeGreaterThan(0);
    });
});
