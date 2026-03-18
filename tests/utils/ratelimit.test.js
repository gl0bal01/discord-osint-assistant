import { describe, it, expect, beforeEach } from 'vitest';
// We need to test the module fresh each time
let checkRateLimit, recordUsage;

beforeEach(async () => {
    // Reset module state between tests
    const mod = await import('../../utils/ratelimit.js');
    checkRateLimit = mod.checkRateLimit;
    recordUsage = mod.recordUsage;
});

describe('checkRateLimit', () => {
    // Use unique user IDs per test to avoid state leaking between tests
    // (ES module caching means internal Maps persist across beforeEach)

    it('allows first command use', () => {
        const result = checkRateLimit('user-first', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('blocks rapid repeat of same command (atomic check-and-record)', () => {
        // First call passes and atomically records usage
        const first = checkRateLimit('user-repeat', 'bob-nuclei');
        expect(first.limited).toBe(false);
        // Second call should be blocked because usage was already recorded
        const result = checkRateLimit('user-repeat', 'bob-nuclei');
        expect(result.limited).toBe(true);
        expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('allows different commands from same user', () => {
        // Records usage for bob-nuclei atomically
        checkRateLimit('user-diffcmd', 'bob-nuclei');
        const result = checkRateLimit('user-diffcmd', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('allows same command from different users', () => {
        // Records usage for user-a atomically
        checkRateLimit('user-a', 'bob-nuclei');
        const result = checkRateLimit('user-b', 'bob-nuclei');
        expect(result.limited).toBe(false);
    });
});
