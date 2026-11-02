import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = 'hostio-secret-token-456';
let cmd;
let axios;
let workDir;
let counter = 0;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostio-test-'));
    process.env.REPORTS_DIR = path.join(workDir, 'reports');
    // Keep temp output out of the repo's temp/ and skip the delayed cleanup timer.
    const temp = require('../../utils/temp.js');
    vi.spyOn(temp, 'reportFilePath').mockImplementation((name, ext) => path.join(workDir, `${name}_${++counter}.${ext}`));
    vi.spyOn(temp, 'cleanupFile').mockResolvedValue(undefined);
    axios = require('axios');
    cmd = require('../../commands/hostio.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    vi.stubEnv('HOSTIO_API_KEY', KEY);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
});

afterEach(() => {
    axios.get.mockRestore();
    axios.post.mockRestore();
    vi.unstubAllEnvs();
});

function makeInteraction(sub, opts = {}) {
    const sent = [];
    const rec = async (p) => { sent.push(p); };
    return {
        sent,
        options: {
            getSubcommand: () => sub,
            getString: (k) => opts[k] ?? null,
            getInteger: (k) => opts[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(rec),
        followUp: vi.fn(rec),
        reply: vi.fn(rec)
    };
}

const textOf = (p) => (typeof p === 'string' ? p : p?.content ?? '');
const last = (i) => textOf(i.sent.at(-1));
const everything = (i) => JSON.stringify(i.sent);

function httpErr(status, statusText = 'Err') {
    return Object.assign(new Error(`Request failed with status code ${status} token=${KEY}`), {
        response: { status, statusText, data: {} }
    });
}
const timeoutErr = () => Object.assign(new Error(`timeout of 15000ms exceeded token=${KEY}`), { code: 'ECONNABORTED' });

describe('bob-hostio definition', () => {
    it('exposes full, domains and related subcommands', () => {
        expect(cmd.data.toJSON().options.map((o) => o.name)).toEqual(['full', 'domains', 'related']);
    });

    it('offers ip, ns, mx, analytics, adsense and asn as field choices', () => {
        const domains = cmd.data.toJSON().options.find((o) => o.name === 'domains');
        const field = domains.options.find((o) => o.name === 'field');
        expect(field.choices.map((c) => c.value)).toEqual(['ip', 'ns', 'mx', 'analytics', 'adsense', 'asn']);
    });
});

describe('bob-hostio input validation', () => {
    it.each([
        ['full', { domain: 'not a domain' }],
        ['full', { domain: 'example.com/../../etc' }],
        ['related', { domain: 'bad_domain!' }]
    ])('rejects invalid domain for %s and makes no request', async (sub, opts) => {
        const i = makeInteraction(sub, opts);
        await cmd.execute(i);
        expect(last(i)).toContain('valid domain name');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it.each([
        ['ip', 'abc'],
        ['ip', '1.2.3.4/../../x'],
        ['ns', 'bad_ns!'],
        ['mx', 'a b'],
        ['analytics', 'XX-123'],
        ['adsense', 'pub-abc'],
        ['asn', 'ASxyz']
    ])('rejects %s value %j and makes no request', async (field, value) => {
        const i = makeInteraction('domains', { field, value });
        await cmd.execute(i);
        expect(last(i)).toContain(`Invalid value format for field: ${field}`);
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-hostio missing API key', () => {
    it.each([
        ['full', { domain: 'example.com' }],
        ['domains', { field: 'ip', value: '1.2.3.4' }],
        ['related', { domain: 'example.com' }]
    ])('reports missing key for %s and makes no request', async (sub, opts) => {
        vi.stubEnv('HOSTIO_API_KEY', '');
        const i = makeInteraction(sub, opts);
        await cmd.execute(i);
        expect(last(i)).toContain('HOSTIO_API_KEY not found');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-hostio happy path', () => {
    it('summarises a full lookup with title and first IP and attaches the JSON', async () => {
        const body = { web: { title: 'Example Domain' }, dns: { a: ['93.184.216.34'] } };
        axios.get.mockResolvedValue({ data: body });
        const i = makeInteraction('full', { domain: 'example.com' });
        await cmd.execute(i);
        const reply = i.sent.at(-1);
        expect(reply.content).toContain('Full domain information for "example.com"');
        expect(reply.content).toContain('Title: Example Domain');
        expect(reply.content).toContain('IP: 93.184.216.34');
        expect(reply.files[0].name).toMatch(/^hostio_full_example_com_[0-9a-f]{12}\.json$/);
        expect(JSON.parse(fs.readFileSync(reply.files[0].attachment, 'utf8'))).toEqual(body);
        expect(axios.get.mock.calls[0][0]).toBe('https://host.io/api/full/example.com');
    });

    it('counts domains for a field search and forwards the limit', async () => {
        axios.get.mockResolvedValue({ data: { domains: ['a.com', 'b.com'] } });
        const i = makeInteraction('domains', { field: 'ip', value: '1.2.3.4', limit: 5 });
        await cmd.execute(i);
        expect(last(i)).toContain('Found 2 domains with ip = "1.2.3.4"');
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://host.io/api/domains/ip/1.2.3.4');
        expect(cfg.params).toEqual({ token: KEY, limit: 5 });
    });

    it('counts related domains', async () => {
        axios.get.mockResolvedValue({ data: { domains: ['x.com', 'y.com', 'z.com'] } });
        const i = makeInteraction('related', { domain: 'example.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('Found 3 domains related to "example.com"');
        expect(axios.get.mock.calls[0][0]).toBe('https://host.io/api/related/example.com');
    });

    it('says Unknown when the response has no domains list', async () => {
        axios.get.mockResolvedValue({ data: {} });
        const i = makeInteraction('related', { domain: 'example.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('Found Unknown domains related');
    });
});

describe('bob-hostio upstream failures', () => {
    it.each([
        [401, 'API authentication failed'],
        [404, 'No information found'],
        [429, 'Rate limit exceeded'],
        [500, 'API error: 500']
    ])('answers HTTP %i appropriately without leaking token or error.message', async (status, expected) => {
        axios.get.mockRejectedValue(httpErr(status, 'Internal Server Error'));
        const i = makeInteraction('full', { domain: 'example.com' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain(expected);
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
    });

    it('answers a timeout with a timeout message and no token', async () => {
        axios.get.mockRejectedValue(timeoutErr());
        const i = makeInteraction('domains', { field: 'asn', value: 'AS15169' });
        await cmd.execute(i);
        expect(last(i)).toContain('timed out');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('timeout of');
    });

    it('gives a generic message for an unrecognised error', async () => {
        axios.get.mockRejectedValue(new Error(`boom ${KEY}`));
        const i = makeInteraction('full', { domain: 'example.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('unexpected error');
        expect(everything(i)).not.toContain(KEY);
    });
});

describe('bob-hostio security', () => {
    it('keeps the token out of the request URL and out of every reply', async () => {
        axios.get.mockResolvedValue({ data: { web: { title: 'T' } } });
        const i = makeInteraction('full', { domain: 'example.com' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][0]).not.toContain(KEY);
        expect(axios.get.mock.calls[0][1].params.token).toBe(KEY);
        expect(everything(i)).not.toContain(KEY);
    });
});
