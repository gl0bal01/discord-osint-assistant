import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = 'whoxy-secret-key-123';
let cmd;
let axios;
let reportsDir;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoxy-test-'));
    process.env.REPORTS_DIR = reportsDir;
    axios = require('axios');
    cmd = require('../../commands/whoxy.js');
});

afterAll(() => {
    fs.rmSync(reportsDir, { recursive: true, force: true });
});

beforeEach(() => {
    vi.stubEnv('WHOXY_API_KEY', KEY);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

function makeInteraction(opts = {}) {
    const sent = [];
    const record = async (p) => { sent.push(p); };
    return {
        sent,
        options: {
            getString: (k) => opts[k] ?? null,
            getBoolean: (k) => opts[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(record),
        followUp: vi.fn(record),
        reply: vi.fn(record)
    };
}

const everything = (sent) => JSON.stringify(sent);
const lastContent = (i) => i.sent.at(-1).content ?? '';

function httpErr(status, data = {}, statusText = 'Err') {
    return Object.assign(new Error(`Request failed with status code ${status} key=${KEY}`), {
        response: { status, data, statusText }
    });
}
const timeoutErr = () => Object.assign(new Error(`timeout of 15000ms exceeded key=${KEY}`), { code: 'ECONNABORTED' });

const record = (over = {}) => ({
    num: 1,
    domain_name: 'example.com',
    create_date: '2006-03-31',
    domain_registrar: { registrar_name: 'GoDaddy.com, LLC' },
    registrant_contact: { full_name: 'Alice', email_address: 'alice@example.com', phone_number: '17813431234' },
    name_servers: ['ns1.a.com'],
    ...over
});

describe('bob-whoxy definition', () => {
    it('exposes history, reverse and balance as type choices', () => {
        const json = cmd.data.toJSON();
        const type = json.options.find((o) => o.name === 'type');
        expect(type.choices.map((c) => c.value)).toEqual(['history', 'reverse', 'balance']);
    });
});

describe('bob-whoxy input validation', () => {
    it('rejects history without a domain and makes no request', async () => {
        const i = makeInteraction({ type: 'history' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Missing Domain');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects a malformed domain and makes no request', async () => {
        const i = makeInteraction({ type: 'history', domain: 'not a domain!' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Whoxy History Failed');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects a domain carrying a path-traversal payload and makes no request', async () => {
        const i = makeInteraction({ type: 'history', domain: 'example.com/../../admin' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Failed');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects reverse search without a value and makes no request', async () => {
        const i = makeInteraction({ type: 'reverse', identifier: 'name' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Missing Search Parameters');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects reverse search without an identifier and makes no request', async () => {
        const i = makeInteraction({ type: 'reverse', value: 'Alice' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Missing Search Parameters');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects an invalid email for email reverse search and makes no request', async () => {
        const i = makeInteraction({ type: 'reverse', identifier: 'email', value: 'not-an-email' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Whoxy Reverse Failed');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects an unknown request type and makes no request', async () => {
        const i = makeInteraction({ type: 'bogus' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Invalid Request Type');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-whoxy missing API key', () => {
    it.each([
        ['history', { type: 'history', domain: 'example.com' }],
        ['reverse', { type: 'reverse', identifier: 'name', value: 'Alice' }],
        ['balance', { type: 'balance' }]
    ])('reports a configuration error for %s and makes no request', async (_n, opts) => {
        vi.stubEnv('WHOXY_API_KEY', '');
        const i = makeInteraction(opts);
        await cmd.execute(i);
        expect(lastContent(i)).toContain('API key is not configured');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-whoxy happy path', () => {
    it('summarises record count for a history lookup', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, total_records_found: 2, whois_records: [record(), record({ num: 2 })] } });
        const i = makeInteraction({ type: 'history', domain: 'example.com' });
        await cmd.execute(i);
        const embed = i.sent.at(-1).embeds[0].data;
        expect(embed.title).toContain('Whoxy WHOIS Analysis');
        expect(embed.description).toContain('example.com');
        expect(embed.fields[0].value).toContain('**Records Found:** 2');
        expect(embed.fields[0].value).toContain('Success');
        expect(i.sent.at(-1).files).toBeUndefined();
    });

    it('sends the domain as a query param, not in the URL', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, whois_records: [] } });
        await cmd.execute(makeInteraction({ type: 'history', domain: 'example.com' }));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.whoxy.com/');
        expect(cfg.params).toEqual({ key: KEY, history: 'example.com' });
    });

    it('attaches a text report when detailed is set', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, whois_records: [record()] } });
        const i = makeInteraction({ type: 'history', domain: 'example.com', detailed: true });
        await cmd.execute(i);
        const file = i.sent.at(-1).files[0];
        expect(file.name).toMatch(/^whoxy_history_\d+\.txt$/);
        expect(file.attachment.toString()).toContain('## Domain: example.com');
    });

    it('lists reverse WHOIS results with the search value', async () => {
        axios.get.mockResolvedValue({
            data: { status: 1, search_result: [{ domain_name: 'a.com', create_date: '2020-01-01' }, { domain_name: 'b.net', create_date: '2021-01-01' }] }
        });
        const i = makeInteraction({ type: 'reverse', identifier: 'email', value: 'admin@example.com' });
        await cmd.execute(i);
        const embed = i.sent.at(-1).embeds[0].data;
        expect(embed.description).toContain('admin@example.com');
        expect(embed.fields[0].value).toContain('**Domains Found:** 2');
        expect(axios.get.mock.calls[0][1].params).toEqual({ key: KEY, reverse: 'whois', email: 'admin@example.com' });
    });

    it('reports top extensions in detailed reverse analysis', async () => {
        axios.get.mockResolvedValue({
            data: { status: 1, search_result: [{ domain_name: 'a.com' }, { domain_name: 'b.com' }, { domain_name: 'c.net' }] }
        });
        const i = makeInteraction({ type: 'reverse', identifier: 'company', value: 'Acme', detailed: true });
        await cmd.execute(i);
        const fields = i.sent.at(-1).embeds[0].data.fields;
        expect(fields[1].value).toContain('.com (2), .net (1)');
    });

    it('marks the analysis as failed when Whoxy answers status 0', async () => {
        axios.get.mockResolvedValue({ data: { status: 0, status_reason: 'Invalid API key' } });
        const i = makeInteraction({ type: 'history', domain: 'example.com' });
        await cmd.execute(i);
        expect(i.sent.at(-1).embeds[0].data.fields[0].value).toContain('Failed');
    });

    it('shows the real Whoxy balance fields for a balance check', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, live_whois_balance: 0, whois_history_balance: 100, reverse_whois_balance: 7 } });
        const i = makeInteraction({ type: 'balance' });
        await cmd.execute(i);
        const embed = i.sent.at(-1).embeds[0].data;
        const value = embed.fields[0].value;
        expect(value).toContain('**WHOIS History Balance:** 100');
        expect(value).toContain('**Reverse WHOIS Balance:** 7');
    });

    it('reports an auth error when Whoxy answers status 0 (bad or expired key)', async () => {
        axios.get.mockResolvedValue({ data: { status: 0, status_reason: 'Invalid API key' } });
        const i = makeInteraction({ type: 'balance' });
        await cmd.execute(i);
        const reply = JSON.stringify(i.sent.at(-1));
        expect(reply).toContain('Authentication Error');
    });

    it('counts registrant email changes between real nested history records', async () => {
        axios.get.mockResolvedValue({
            data: {
                status: 1,
                whois_records: [
                    record({ create_date: '2006-01-01' }),
                    record({ create_date: '2010-01-01', registrant_contact: { full_name: 'Bob', email_address: 'bob@example.com' } })
                ]
            }
        });
        const i = makeInteraction({ type: 'history', domain: 'example.com', detailed: true });
        await cmd.execute(i);
        const analysis = i.sent.at(-1).embeds[0].data.fields.find((f) => f.name.includes('Change Analysis'));
        expect(analysis.value).toContain('**Email Changes:** 1');
    });

    it('redacts phone and street in every nested contact block in privacy mode', async () => {
        const contact = { full_name: 'Alice', email_address: 'a@example.com', phone_number: '5550001111', mailing_address: '1 Secret Street', zip_code: '99999' };
        axios.get.mockResolvedValue({
            data: { status: 1, whois_records: [record({ registrant_contact: contact, administrative_contact: contact, technical_contact: contact, billing_contact: contact })] }
        });
        const i = makeInteraction({ type: 'history', domain: 'example.com', detailed: true, 'privacy-mode': true });
        await cmd.execute(i);
        const report = i.sent.at(-1).files[0].attachment.toString();
        for (const secret of ['5550001111', '1 Secret Street', '99999']) expect(report).not.toContain(secret);
        expect(report).toContain('[REDACTED]');
    });

    it('redacts nested contact details in reverse search results in privacy mode', async () => {
        axios.get.mockResolvedValue({
            data: { status: 1, search_result: [{ domain_name: 'a.com', registrant_contact: { phone_number: '5550002222', mailing_address: '2 Hidden Rd' } }] }
        });
        const i = makeInteraction({ type: 'reverse', identifier: 'name', value: 'Alice', detailed: true, 'privacy-mode': true });
        await cmd.execute(i);
        const report = i.sent.at(-1).files[0].attachment.toString();
        expect(report).not.toContain('5550002222');
        expect(report).not.toContain('2 Hidden Rd');
    });

    it('redacts phone numbers from real nested records in privacy mode', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, whois_records: [record()] } });
        const i = makeInteraction({ type: 'history', domain: 'example.com', detailed: true, 'privacy-mode': true });
        await cmd.execute(i);
        expect(i.sent.at(-1).files[0].attachment.toString()).not.toContain('17813431234');
    });
});

describe('bob-whoxy upstream failures', () => {
    it.each([
        [401, 'Authentication Error'],
        [429, 'Rate Limit Exceeded'],
        [500, 'Service Unavailable']
    ])('answers HTTP %i with a generic message that hides the key and error.message', async (status, expected) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction({ type: 'history', domain: 'example.com' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(lastContent(i)).toContain(expected);
        expect(everything(i.sent)).not.toContain(KEY);
        expect(everything(i.sent)).not.toContain('Request failed');
    });

    it('answers a timeout with a timeout message that hides the key', async () => {
        axios.get.mockRejectedValue(timeoutErr());
        const i = makeInteraction({ type: 'reverse', identifier: 'name', value: 'Alice' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Timeout Error');
        expect(everything(i.sent)).not.toContain(KEY);
        expect(everything(i.sent)).not.toContain('timeout of');
    });

    it('answers a balance failure without leaking the key', async () => {
        axios.get.mockRejectedValue(httpErr(401));
        const i = makeInteraction({ type: 'balance' });
        await cmd.execute(i);
        expect(lastContent(i)).toContain('Whoxy Balance Failed');
        expect(everything(i.sent)).not.toContain(KEY);
    });
});

describe('bob-whoxy security', () => {
    it('never echoes the API key in a successful reply', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, whois_records: [record()] } });
        const i = makeInteraction({ type: 'history', domain: 'example.com', detailed: true });
        await cmd.execute(i);
        expect(everything(i.sent)).not.toContain(KEY);
        expect(i.sent.at(-1).files[0].attachment.toString()).not.toContain(KEY);
    });

    it('passes a reverse value containing query metacharacters only as a param value', async () => {
        axios.get.mockResolvedValue({ data: { status: 1, search_result: [] } });
        await cmd.execute(makeInteraction({ type: 'reverse', identifier: 'keyword', value: 'acme&key=evil' }));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.whoxy.com/');
        expect(cfg.params.key).toBe(KEY);
    });
});
