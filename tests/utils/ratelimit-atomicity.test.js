import { describe, it, expect, beforeEach } from 'vitest';

let checkRateLimit;

beforeEach(() => {
    // Reset the in-module Maps between tests via CJS cache eviction.
    const path = require.resolve('../../utils/ratelimit.js');
    delete require.cache[path];
    ({ checkRateLimit } = require('../../utils/ratelimit.js'));
});

describe('checkRateLimit atomicity (TOCTOU regression)', () => {
    it('exactly one of N concurrent same-tick calls passes', async () => {
        const userId = 'race-user';
        const cmd = 'bob-nuclei';
        const N = 100;

        // Promise.all runs the sync function in the same microtask burst.
        // Since check-and-record is atomic, only the first should pass.
        const results = await Promise.all(
            Array.from({ length: N }, () => Promise.resolve().then(() => checkRateLimit(userId, cmd)))
        );

        const passed = results.filter((r) => !r.limited);
        const blocked = results.filter((r) => r.limited);

        expect(passed.length).toBe(1);
        expect(blocked.length).toBe(N - 1);
        for (const b of blocked) {
            expect(b.retryAfter).toBeGreaterThan(0);
            expect(b.reason).toBeDefined();
        }
    });

    it('synchronous burst: only first call passes, the rest are limited', () => {
        const userId = 'sync-burst';
        const cmd = 'bob-sherlock';
        const results = [];
        for (let i = 0; i < 50; i++) results.push(checkRateLimit(userId, cmd));
        expect(results[0].limited).toBe(false);
        expect(results.slice(1).every((r) => r.limited)).toBe(true);
    });

    it('different users racing same command: all pass once', async () => {
        const cmd = 'bob-maigret';
        const users = Array.from({ length: 25 }, (_, i) => `user-${i}`);
        const results = await Promise.all(
            users.map((u) => Promise.resolve().then(() => checkRateLimit(u, cmd)))
        );
        expect(results.every((r) => !r.limited)).toBe(true);
    });

    it('does not over-increment daily count on blocked attempts', async () => {
        // RATE_LIMIT_DAILY default = 200. With 30s heavy cooldown, 250 rapid calls
        // for the same user/command should all be blocked after the first, so the
        // user must NEVER hit the daily cap from a single rapid burst.
        const userId = 'daily-burst';
        const cmd = 'bob-nuclei';
        const calls = 250;
        const results = [];
        for (let i = 0; i < calls; i++) results.push(checkRateLimit(userId, cmd));

        const passed = results.filter((r) => !r.limited).length;
        expect(passed).toBe(1);

        // Every blocked result should report a cooldown reason, not the daily cap.
        const dailyBlocked = results.filter((r) => r.limited && /Daily/i.test(r.reason || ''));
        expect(dailyBlocked.length).toBe(0);
    });
});
