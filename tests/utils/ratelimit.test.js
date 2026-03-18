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
    it('allows first command use', () => {
        const result = checkRateLimit('user1', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('blocks rapid repeat of same command', () => {
        recordUsage('user1', 'bob-nuclei');
        const result = checkRateLimit('user1', 'bob-nuclei');
        expect(result.limited).toBe(true);
        expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('allows different commands from same user', () => {
        recordUsage('user1', 'bob-nuclei');
        const result = checkRateLimit('user1', 'bob-dns');
        expect(result.limited).toBe(false);
    });

    it('allows same command from different users', () => {
        recordUsage('user1', 'bob-nuclei');
        const result = checkRateLimit('user2', 'bob-nuclei');
        expect(result.limited).toBe(false);
    });
});
