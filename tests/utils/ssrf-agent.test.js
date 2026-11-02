import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import dns from 'node:dns';
import axios from 'axios';
import { getSafeAxiosConfig, validateUrlNotInternal } from '../../utils/ssrf.js';

afterEach(() => vi.restoreAllMocks());

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
        // Public host should pass through and return an array when all:true (DNS stubbed: offline).
        vi.spyOn(dns, 'lookup').mockImplementation((_h, _o, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]));
        const { httpAgent } = getSafeAxiosConfig();
        const result = await new Promise((resolve, reject) => {
            httpAgent.options.lookup('one.one.one.one', { all: true, family: 0 }, (e, addrs) => (e ? reject(e) : resolve(addrs)));
        });
        expect(result).toEqual([{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
    });

    it('rejects a hostname if any of its records is private (no partial trust)', async () => {
        vi.spyOn(dns, 'lookup').mockImplementation((_h, _o, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.5', family: 4 }]));
        const err = await new Promise((resolve) => getSafeAxiosConfig().httpAgent.options.lookup('mixed.example', { all: true }, resolve));
        expect(err.code).toBe('ESSRF');
    });
});

// Node never calls the agent's lookup hook for an IP-literal host, which is how a
// direct http://127.0.0.1/ or a redirect to one used to get through.
describe('getSafeAxiosConfig — IP-literal destinations', () => {
    const withServer = async (fn) => {
        let connections = 0;
        const srv = http.createServer((_q, r) => r.end('INTERNAL')).on('connection', () => { connections++; });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        try {
            await fn(srv.address().port);
        } finally {
            await new Promise((r) => srv.close(r));
        }
        return connections;
    };

    it.each(['127.0.0.1', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]'])('blocks %s before any socket opens', async (host) => {
        const connections = await withServer(async (port) => {
            const err = await axios.get(`http://${host}:${port}/`, { ...getSafeAxiosConfig(), timeout: 2000 }).catch((e) => e);
            expect(err.code).toBe('ESSRF');
        });
        expect(connections).toBe(0);
    });

    it('also guards the https agent', () => {
        const cb = vi.fn();
        expect(getSafeAxiosConfig().httpsAgent.createConnection({ host: '169.254.169.254', port: 443 }, cb)).toBeUndefined();
        expect(cb.mock.calls[0][0].code).toBe('ESSRF');
    });
});

describe('validateUrlNotInternal — IP literals', () => {
    it.each(['http://127.0.0.1/', 'http://[::1]/', 'http://[::]/', 'http://100.100.100.200/', 'http://[::ffff:a9fe:a9fe]/'])('rejects %s', async (url) => {
        await expect(validateUrlNotInternal(url)).rejects.toThrow(/private\/internal/);
    });

    it('accepts a public IP literal without a DNS lookup', async () => {
        const resolve4 = vi.spyOn(dns.promises, 'resolve4');
        await expect(validateUrlNotInternal('https://1.1.1.1/')).resolves.toBeUndefined();
        expect(resolve4).not.toHaveBeenCalled();
    });
});
