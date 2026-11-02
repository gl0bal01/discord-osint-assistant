import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = 'pappers-secret-token-321';
let cmd;
let axios;
let workDir;
let counter = 0;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pappers-test-'));
    process.env.REPORTS_DIR = path.join(workDir, 'reports');
    const temp = require('../../utils/temp.js');
    vi.spyOn(temp, 'reportFilePath').mockImplementation((name, ext) => path.join(workDir, `${name}_${++counter}.${ext}`));
    vi.spyOn(temp, 'cleanupFile').mockResolvedValue(undefined);
    axios = require('axios');
    cmd = require('../../commands/pappers.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    // Only the progress interval is faked, so a leaked interval shows up in getTimerCount().
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubEnv('PAPPERS_API_KEY', KEY);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
});

afterEach(() => {
    axios.get.mockRestore();
    axios.post.mockRestore();
    vi.useRealTimers();
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

function httpErr(status, data = {}) {
    return Object.assign(new Error(`Request failed with status code ${status} api_token=${KEY}`), {
        response: { status, statusText: 'Err', data }
    });
}

describe('bob-pappers definition', () => {
    it('exposes company, search and officer subcommands', () => {
        expect(cmd.data.toJSON().options.map((o) => o.name)).toEqual(['company', 'search', 'officer']);
    });

    it('restricts country_code to the supported countries', () => {
        const company = cmd.data.toJSON().options.find((o) => o.name === 'company');
        const cc = company.options.find((o) => o.name === 'country_code');
        expect(cc.choices.map((c) => c.value)).toEqual(['UK', 'FR', 'BE', 'CH', 'DE', 'ES', 'IT', 'LU', 'NL']);
    });
});

describe('bob-pappers input validation', () => {
    it.each([
        ['company', { country_code: 'FR', company_number: '   ' }, 'valid company registration number'],
        ['search', { country_code: 'FR', query: ' a ' }, 'at least 2 characters'],
        ['officer', { country_code: 'FR', name: ' ' }, 'at least 2 characters']
    ])('rejects a blank %s input, makes no request and clears the progress timer', async (sub, opts, msg) => {
        const i = makeInteraction(sub, opts);
        await cmd.execute(i);
        expect(last(i)).toContain(msg);
        expect(axios.get).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('bob-pappers missing API key', () => {
    it.each([
        ['company', { country_code: 'FR', company_number: '552100554' }],
        ['search', { country_code: 'FR', query: 'acme' }],
        ['officer', { country_code: 'FR', name: 'Jean Dupont' }]
    ])('reports missing key for %s and makes no request', async (sub, opts) => {
        vi.stubEnv('PAPPERS_API_KEY', '');
        const i = makeInteraction(sub, opts);
        await cmd.execute(i);
        expect(last(i)).toContain('PAPPERS_API_KEY not found');
        expect(axios.get).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('bob-pappers happy path', () => {
    it('names the company and country and attaches the JSON for a company lookup', async () => {
        const body = { name: 'ACME SAS', company_number: '552100554' };
        axios.get.mockResolvedValue({ data: body });
        const i = makeInteraction('company', { country_code: 'FR', company_number: '552100554' });
        await cmd.execute(i);
        const reply = i.sent.at(-1);
        expect(reply.content).toContain('Company information for "ACME SAS" in France');
        expect(reply.files[0].name).toMatch(/^company_FR_552100554_[0-9a-f]{12}\.json$/);
        expect(JSON.parse(fs.readFileSync(reply.files[0].attachment, 'utf8'))).toEqual(body);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sends company parameters as query params to the company endpoint', async () => {
        axios.get.mockResolvedValue({ data: { name: 'X' } });
        await cmd.execute(makeInteraction('company', { country_code: 'BE', company_number: '0123.456.789' }));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.pappers.in/v1/company');
        expect(cfg.params).toEqual({ api_token: KEY, country_code: 'BE', company_number: '0123.456.789', fields: '' });
    });

    it('keeps only known field groups from the fields option', async () => {
        axios.get.mockResolvedValue({ data: { name: 'X' } });
        await cmd.execute(makeInteraction('company', { country_code: 'FR', company_number: '1', fields: 'officers, bogus,ubos' }));
        expect(axios.get.mock.calls[0][1].params.fields).toBe('officers,ubos');
    });

    it('expands fields=all to every known field group', async () => {
        axios.get.mockResolvedValue({ data: { name: 'X' } });
        await cmd.execute(makeInteraction('company', { country_code: 'FR', company_number: '1', fields: 'all' }));
        expect(axios.get.mock.calls[0][1].params.fields.split(',')).toEqual(
            ['officers', 'ubos', 'financials', 'documents', 'certificates', 'publications', 'establishments', 'contacts']
        );
    });

    it('falls back to Unknown Company when the response has no name', async () => {
        axios.get.mockResolvedValue({ data: { company_number: '1' } });
        const i = makeInteraction('company', { country_code: 'UK', company_number: '1' });
        await cmd.execute(i);
        expect(last(i)).toContain('Company information for "Unknown Company" in United Kingdom');
    });

    it('counts matching companies for a search and applies default paging', async () => {
        axios.get.mockResolvedValue({ data: { companies: [{ name: 'A' }, { name: 'B' }] } });
        const i = makeInteraction('search', { country_code: 'BE', query: 'acme' });
        await cmd.execute(i);
        expect(last(i)).toContain('Found 2 companies matching "acme" in Belgium');
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.pappers.in/v1/search');
        expect(cfg.params).toEqual({ api_token: KEY, country_code: 'BE', q: 'acme', page: 1, per_page: 10 });
    });

    it('counts matching officers and forwards page and per_page', async () => {
        axios.get.mockResolvedValue({ data: { officers: [{ name: 'Jean' }] } });
        const i = makeInteraction('officer', { country_code: 'FR', name: 'Jean Dupont', page: 2, per_page: 50 });
        await cmd.execute(i);
        expect(last(i)).toContain('Found 1 officers/directors matching "Jean Dupont" in France');
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.pappers.in/v1/officer');
        expect(cfg.params).toMatchObject({ name: 'Jean Dupont', page: 2, per_page: 50 });
    });

    it('reports no data when the API returns an empty body', async () => {
        axios.get.mockResolvedValue({ data: '' });
        const i = makeInteraction('search', { country_code: 'FR', query: 'acme' });
        await cmd.execute(i);
        expect(last(i)).toContain('No data received');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('bob-pappers upstream failures', () => {
    it.each([
        [401, 'API authentication failed'],
        [402, 'Insufficient credits'],
        [404, 'No results found'],
        [429, 'Rate limit exceeded']
    ])('answers HTTP %i with an appropriate message, no token and no timer leak', async (status, expected) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction('company', { country_code: 'FR', company_number: '1' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain(expected);
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('answers HTTP 500 with an API error and no token or error.message', async () => {
        axios.get.mockRejectedValue(httpErr(500));
        const i = makeInteraction('search', { country_code: 'FR', query: 'acme' });
        await cmd.execute(i);
        expect(last(i)).toContain('API error: 500');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('answers a timeout with a timeout message and no token', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`timeout of 30000ms exceeded ${KEY}`), { code: 'ECONNABORTED' }));
        const i = makeInteraction('officer', { country_code: 'FR', name: 'Jean Dupont' });
        await cmd.execute(i);
        expect(last(i)).toContain('timed out');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('timeout of');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not relay an upstream error body that echoes the API token', async () => {
        axios.get.mockRejectedValue(httpErr(500, { error: `invalid api_token ${KEY}` }));
        const i = makeInteraction('company', { country_code: 'FR', company_number: '1' });
        await cmd.execute(i);
        expect(everything(i)).not.toContain(KEY);
    });
});

describe('bob-pappers security', () => {
    it('never echoes the API token in a successful reply', async () => {
        axios.get.mockResolvedValue({ data: { name: 'ACME SAS', note: 'x' } });
        const i = makeInteraction('company', { country_code: 'FR', company_number: '1' });
        await cmd.execute(i);
        expect(everything(i)).not.toContain(KEY);
    });

    it('passes a hostile search query only as a param value, never in the URL', async () => {
        axios.get.mockResolvedValue({ data: { companies: [] } });
        await cmd.execute(makeInteraction('search', { country_code: 'FR', query: 'x&api_token=evil#../' }));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.pappers.in/v1/search');
        expect(cfg.params.api_token).toBe(KEY);
        expect(cfg.params.q).toBe('x&api_token=evil#../');
    });
});
