import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { getSafeAxiosConfig } from '../../utils/ssrf.js';

/**
 * Connect-time DNS rebinding defense: even if a hostname resolves to a
 * private IP, the agent's custom lookup must reject the connection BEFORE
 * the socket is opened. Uses `localhost` (always 127.0.0.1) as a stable
 * proxy for "hostname that resolves to a private IP".
 */
describe('getSafeAxiosConfig — connect-time SSRF guard', () => {
    it('returns a frozen config with httpAgent and httpsAgent', () => {
        const cfg = getSafeAxiosConfig();
        expect(cfg.httpAgent).toBeDefined();
        expect(cfg.httpsAgent).toBeDefined();
        expect(Object.isFrozen(cfg)).toBe(true);
    });

    it('agents install a custom lookup hook (not Node default)', () => {
        const { httpAgent, httpsAgent } = getSafeAxiosConfig();
        expect(typeof httpAgent.options.lookup).toBe('function');
        expect(typeof httpsAgent.options.lookup).toBe('function');
    });

    it('blocks http request to hostname resolving to private IP (localhost → 127.0.0.1)', async () => {
        const { httpAgent } = getSafeAxiosConfig();
        const err = await new Promise((resolve, reject) => {
            const req = http.request(
                { hostname: 'localhost', port: 80, path: '/', agent: httpAgent, timeout: 2000 },
                () => reject(new Error('connection should have been blocked'))
            );
            req.on('error', resolve);
            req.on('timeout', () => reject(new Error('unexpected timeout — lookup did not fire')));
            req.end();
        });
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/private\/internal IP/i);
    });

    it('lookup hook rejects an explicit private address synthetically', async () => {
        const { httpAgent } = getSafeAxiosConfig();
        const lookup = httpAgent.options.lookup;

        const err = await new Promise((resolve) => {
            lookup('localhost', { all: false, family: 0 }, (e) => resolve(e));
        });
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/private\/internal IP|Could not resolve/i);
    });

    it('lookup hook supports `all: true` callback signature', async () => {
        // Public host should pass through and return an array when all:true.
        const { httpAgent } = getSafeAxiosConfig();
        const lookup = httpAgent.options.lookup;

        const result = await new Promise((resolve, reject) => {
            lookup('one.one.one.one', { all: true, family: 0 }, (e, addrs) => {
                if (e) return reject(e);
                resolve(addrs);
            });
        }).catch((e) => e);

        // If DNS is unavailable in the sandbox, accept that as non-fatal.
        if (result instanceof Error) {
            expect(result.message).toMatch(/Could not resolve|ENOTFOUND|EAI_AGAIN/i);
            return;
        }
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        for (const a of result) {
            expect(typeof a.address).toBe('string');
            expect([4, 6]).toContain(a.family);
        }
    });
});
