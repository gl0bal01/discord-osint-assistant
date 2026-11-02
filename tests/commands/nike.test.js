import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TOKEN = 'nike-bearer-token-ABC123';
let cmd;
let axios;
let temp;
let workDir;
let counter = 0;

// nike.js keeps the token in module state, so load a fresh copy for every test.
function loadFresh() {
    delete require.cache[require.resolve('../../commands/nike.js')];
    return require('../../commands/nike.js');
}

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nike-test-'));
    process.env.REPORTS_DIR = path.join(workDir, 'reports');
    temp = require('../../utils/temp.js');
    vi.spyOn(temp, 'reportFilePath').mockImplementation((name, ext) => path.join(workDir, `${name}_${++counter}.${ext}`));
    vi.spyOn(temp, 'cleanupFile').mockResolvedValue(undefined);
    axios = require('axios');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    vi.stubEnv('NIKE_TOKEN', TOKEN);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
    cmd = loadFresh();
});

afterEach(() => {
    axios.get.mockRestore();
    axios.post.mockRestore();
    vi.unstubAllEnvs();
});

function makeInteraction(opts = {}) {
    const sent = [];
    const rec = async (p) => { sent.push(p); };
    return {
        sent,
        options: { getString: (k) => opts[k] ?? null },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(rec),
        followUp: vi.fn(rec),
        reply: vi.fn(rec)
    };
}

const everything = (i) => JSON.stringify(i.sent);
const contents = (i) => i.sent.map((p) => p.content ?? '');
const last = (i) => i.sent.at(-1).content;

function httpErr(status) {
    return Object.assign(new Error(`Request failed with status code ${status} Bearer ${TOKEN}`), {
        response: { status, data: { message: TOKEN } }
    });
}

const person = (n, over = {}) => ({
    upmId: `id-${n}`,
    displayName: `runner${n}`,
    firstName: 'Ada',
    lastName: `Runner${n}`,
    hometown: 'Portland',
    visibility: 'PUBLIC',
    imageUrl: `https://img.example.com/${n}.png`,
    ...over
});

describe('bob-nike definition', () => {
    it('offers optional email, name and token options', () => {
        const opts = cmd.data.toJSON().options;
        expect(opts.map((o) => o.name)).toEqual(['email', 'name', 'token']);
        expect(opts.every((o) => !o.required)).toBe(true);
    });
});

describe('bob-nike input validation', () => {
    it('asks for an email or name when neither is given and makes no request', async () => {
        const i = makeInteraction();
        await cmd.execute(i);
        expect(last(i)).toContain('provide either an email or a name');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('only acknowledges the token when a token is supplied without a search', async () => {
        const i = makeInteraction({ token: 'fresh-token-XYZ' });
        await cmd.execute(i);
        expect(contents(i)).toHaveLength(1);
        expect(last(i)).toContain('New token saved');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-nike missing token', () => {
    it('tells the user to supply a token and makes no request', async () => {
        vi.stubEnv('NIKE_TOKEN', '');
        const i = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('provide a new token');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('uses a token supplied through the token option for the lookup', async () => {
        vi.stubEnv('NIKE_TOKEN', '');
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1)] } });
        const i = makeInteraction({ email: 'a@b.com', token: 'fresh-token-XYZ' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-token-XYZ');
        expect(everything(i)).not.toContain('fresh-token-XYZ');
    });
});

describe('bob-nike happy path', () => {
    it('attaches an HTML report and previews the first three results', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [1, 2, 3, 4].map((n) => person(n)) } });
        const i = makeInteraction({ email: 'ada@example.com' });
        await cmd.execute(i);

        const report = i.sent.find((p) => p.files);
        expect(report.content).toBe('Found 4 results for "ada@example.com".');
        expect(fs.readFileSync(report.files[0], 'utf8')).toContain('runner4');

        const preview = i.sent.find((p) => p.content?.startsWith('Preview of results'));
        expect(preview.content).toContain('**Result 3**');
        expect(preview.content).not.toContain('**Result 4**');
        expect(preview.content).toContain('Username: runner1');
        expect(preview.content).toContain('Name: Ada Runner1');
        expect(preview.content).toContain('...and 1 more results available');
    });

    it('searches by name when no email is given', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1)] } });
        const i = makeInteraction({ name: 'Ada Runner' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][0]).toContain('searchstring=Ada%20Runner');
    });

    it('reports no results when the API returns an empty list', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [] } });
        const i = makeInteraction({ email: 'nobody@example.com' });
        await cmd.execute(i);
        expect(last(i)).toBe('[!] No results found');
    });

    it('falls back to a text listing when the report file cannot be created', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1, { email: 'ada@example.com' })] } });
        temp.reportFilePath.mockImplementationOnce(() => { throw new Error('disk full /secret/path'); });
        const i = makeInteraction({ email: 'ada@example.com' });
        await cmd.execute(i);
        expect(last(i)).toContain("couldn't create HTML report");
        expect(last(i)).toContain('Username:      runner1');
        expect(everything(i)).not.toContain('disk full');
    });

    it('keeps every fallback message within 2000 characters for many results', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: Array.from({ length: 30 }, (_, n) => person(n, { email: `p${n}@example.com` })) } });
        temp.reportFilePath.mockImplementationOnce(() => { throw new Error('disk full'); });
        const i = makeInteraction({ name: 'Ada' });
        await cmd.execute(i);
        expect(i.sent.length).toBeGreaterThan(1);
        for (const c of contents(i)) expect(c.length).toBeLessThanOrEqual(2000);
    });
});

describe('bob-nike upstream failures', () => {
    it('clears the cached token and asks for a new one on HTTP 401', async () => {
        axios.get.mockRejectedValue(httpErr(401));
        const i = makeInteraction({ email: 'a@b.com', token: 'short-lived' });
        await cmd.execute(i);
        expect(last(i)).toContain('Token expired');

        vi.stubEnv('NIKE_TOKEN', '');
        axios.get.mockClear();
        const j = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(j);
        expect(last(j)).toContain('provide a new token');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('names the real command in the token-expired message', async () => {
        axios.get.mockRejectedValue(httpErr(401));
        const i = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('/bob-nike');
    });

    it.each([[429], [500]])('answers HTTP %i with a generic message and no token', async (status) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction({ email: 'a@b.com' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain('An error occurred while processing your request');
        expect(everything(i)).not.toContain(TOKEN);
        expect(everything(i)).not.toContain('Request failed');
    });

    it('answers a timeout with a generic message and no token', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`timeout of 15000ms exceeded ${TOKEN}`), { code: 'ECONNABORTED' }));
        const i = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(i);
        expect(last(i)).toContain('An error occurred while processing your request');
        expect(everything(i)).not.toContain(TOKEN);
        expect(everything(i)).not.toContain('timeout of');
    });
});

describe('bob-nike security', () => {
    it('URL-encodes the search string so it cannot add query parameters', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [] } });
        await cmd.execute(makeInteraction({ email: 'a+b@x.com&evil=1#frag' }));
        const url = axios.get.mock.calls[0][0];
        expect(url).toBe('https://api.nike.com/usersearch/search/v2?searchstring=a%2Bb%40x.com%26evil%3D1%23frag');
    });

    it('sends the token as a bearer header and never echoes it in replies', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1)] } });
        const i = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(everything(i)).not.toContain(TOKEN);
    });

    it('escapes third-party HTML in the report file', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1, { displayName: '<script>alert(1)</script>' })] } });
        const i = makeInteraction({ email: '<img src=x onerror=alert(1)>' });
        await cmd.execute(i);
        const html = fs.readFileSync(i.sent.find((p) => p.files).files[0], 'utf8');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;script&gt;');
    });

    it('neutralizes @everyone coming from a Nike display name in the preview', async () => {
        axios.get.mockResolvedValue({ status: 200, data: { objects: [person(1, { displayName: '@everyone' })] } });
        const i = makeInteraction({ email: 'a@b.com' });
        await cmd.execute(i);
        const preview = i.sent.find((p) => p.content?.startsWith('Preview of results'));
        expect(preview.content).not.toMatch(/@everyone/);
    });
});
