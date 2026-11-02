import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const KEY = 'dnsdumpster-secret-789';
let cmd;
let axios;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    cmd = require('../../commands/dns.js');
});

beforeEach(() => {
    vi.stubEnv('DNSDUMPSTER_TOKEN', KEY);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

function makeInteraction(domain) {
    const sent = [];
    const rec = async (p) => { sent.push(p); };
    return {
        sent,
        options: { getString: (k) => (k === 'domain' ? domain : null) },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(rec),
        followUp: vi.fn(rec),
        reply: vi.fn(rec)
    };
}

const everything = (i) => JSON.stringify(i.sent);
const last = (i) => i.sent.at(-1).content;

function httpErr(status, statusText = 'Err') {
    return Object.assign(new Error(`Request failed with status code ${status} key=${KEY}`), {
        response: { status, statusText, data: { detail: KEY } }
    });
}

const bigRecords = () => ({
    a: Array.from({ length: 120 }, (_, n) => ({ host: `host${n}.example.com`, ip: `10.0.${n % 250}.${n % 200}`, asn: 'AS64500' }))
});

// Extract the fenced JSON body out of a reply.
const body = (content) => content.split('```json\n')[1].replace(/\n```$/, '');

describe('bob-dns definition', () => {
    it('requires a domain option capped at 253 characters', () => {
        const [opt] = cmd.data.toJSON().options;
        expect(opt).toMatchObject({ name: 'domain', required: true, max_length: 253 });
    });
});

describe('bob-dns input validation', () => {
    it.each(['not a domain', 'example.com/../../x', 'example.com?x=1', 'nodots', '-bad.com'])(
        'rejects %j with a format message and makes no request',
        async (domain) => {
            const i = makeInteraction(domain);
            await cmd.execute(i);
            expect(last(i)).toContain('Invalid Domain Format');
            expect(axios.get).not.toHaveBeenCalled();
        }
    );
});

describe('bob-dns missing API key', () => {
    it('reports a configuration error and makes no request', async () => {
        vi.stubEnv('DNSDUMPSTER_TOKEN', '');
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(last(i)).toContain('API token is not configured');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-dns happy path', () => {
    it('shows the records for a short result in a single reply', async () => {
        axios.get.mockResolvedValue({ data: { a: [{ host: 'www.example.com', ip: '93.184.216.34' }] } });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(i.sent).toHaveLength(1);
        expect(last(i)).toContain('DNS Analysis Results for `example.com`');
        const parsed = JSON.parse(body(last(i)));
        expect(parsed.domain).toBe('example.com');
        expect(parsed.records.a[0].ip).toBe('93.184.216.34');
        expect(i.followUp).not.toHaveBeenCalled();
    });

    it('queries the validated domain with the token in a header, not the URL', async () => {
        axios.get.mockResolvedValue({ data: { a: [] , x: 1 } });
        await cmd.execute(makeInteraction('example.com'));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.dnsdumpster.com/domain/example.com');
        expect(url).not.toContain(KEY);
        expect(cfg.headers['X-API-Key']).toBe(KEY);
    });

    it('tells the user when the API returns no records', async () => {
        axios.get.mockResolvedValue({ data: {} });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(last(i)).toContain('No DNS Information Found');
    });

    it('splits long output into numbered parts that each fit a Discord message', async () => {
        axios.get.mockResolvedValue({ data: bigRecords() });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        const total = i.sent.length;
        expect(total).toBeGreaterThan(2);
        expect(i.sent[0].content).toContain(`(Part 1/${total})`);
        expect(i.sent.at(-1).content).toContain(`(Part ${total}/${total})`);
        expect(i.followUp).toHaveBeenCalledTimes(total - 1);
        for (const p of i.sent) expect(p.content.length).toBeLessThanOrEqual(2000);
    });

    it('preserves every record when long output is split and reassembled', async () => {
        const data = bigRecords();
        axios.get.mockResolvedValue({ data });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        const joined = i.sent.map((p) => body(p.content)).join('\n');
        expect(JSON.parse(joined).records).toEqual(data);
    });

    it('keeps a result just under 2000 chars within the Discord message limit', async () => {
        const wrap = (pad) => JSON.stringify({ domain: 'example.com', timestamp: new Date().toISOString(), records: { pad } }, null, 2);
        const pad = 'x'.repeat(1990 - wrap('').length);
        axios.get.mockResolvedValue({ data: { pad } });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        for (const p of i.sent) expect(p.content.length).toBeLessThanOrEqual(2000);
    });
});

describe('bob-dns upstream failures', () => {
    it.each([
        [401, 'Authentication failed'],
        [429, 'Rate limit exceeded'],
        [500, 'temporarily unavailable']
    ])('answers HTTP %i with a generic message and no key or error.message', async (status, expected) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction('example.com');
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain('DNS Lookup Failed');
        expect(last(i)).toContain(expected);
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
    });

    it('tells the user the domain was not found on HTTP 404', async () => {
        axios.get.mockRejectedValue(httpErr(404));
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(last(i)).toContain('not found');
        expect(everything(i)).not.toContain(KEY);
    });

    it('answers a timeout with a timeout message and no key', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`timeout of 15000ms exceeded ${KEY}`), { code: 'ECONNABORTED' }));
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(last(i)).toContain('timed out');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('timeout of');
    });

    it('gives a generic message for an unrecognised error', async () => {
        axios.get.mockRejectedValue(new Error(`kaboom ${KEY}`));
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(last(i)).toContain('unexpected error');
        expect(everything(i)).not.toContain(KEY);
    });
});

describe('bob-dns security', () => {
    it('never echoes the API token in a successful reply', async () => {
        axios.get.mockResolvedValue({ data: bigRecords() });
        const i = makeInteraction('example.com');
        await cmd.execute(i);
        expect(everything(i)).not.toContain(KEY);
    });
});
