import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-test-'));
process.env.REPORTS_DIR = path.join(tmpRoot, 'reports');
process.env.CLEANUP_DELAY = '10'; // read at module load; keep the delayed cleanup fast
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client-id';

const SAFE = { httpAgent: { safe: 'http' }, httpsAgent: { safe: 'https' } };
const INTERNAL = /^(127\.|10\.|192\.168\.|169\.254\.|localhost$)/;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

let cmd, axios, getSpy, validateSpy, createdDirs;

beforeAll(() => {
    validateSpy = vi.spyOn(require('../../utils/ssrf.js'), 'validateUrlNotInternal');
    vi.spyOn(require('../../utils/ssrf.js'), 'getSafeAxiosConfig').mockReturnValue(SAFE);
    vi.spyOn(require('../../utils/temp.js'), 'reportDirPath').mockImplementation((name) => {
        const d = fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
        createdDirs.push(d);
        return d;
    });
    axios = require('axios');
    getSpy = vi.spyOn(axios, 'get');
    cmd = require('../../commands/favicons.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
    createdDirs = [];
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
    validateSpy.mockReset().mockImplementation(async (u) => {
        if (INTERNAL.test(new URL(u).hostname)) throw new Error('URL resolves to a private/internal IP address');
    });
});

function makeInteraction({ url, raw = null, verbose = null, format = null }) {
    const replies = [];
    const fileContents = {};
    return {
        replies,
        fileContents,
        options: {
            getString: (k) => ({ url, format })[k] ?? null,
            getBoolean: (k) => ({ raw, verbose })[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (payload) => {
            replies.push(payload);
            for (const f of payload?.files ?? []) {
                fileContents[f.name] = fs.readFileSync(f.attachment);
            }
        })
    };
}

const last = (i) => i.replies.at(-1);
const embed = (i) => last(i).embeds[0].data;
const field = (i, needle) => embed(i).fields.find((f) => f.name.includes(needle));

// Route axios.get by URL: the page, and favicon downloads by exact URL.
function routeAxios({ pageUrl, html, icons = {} }) {
    getSpy.mockImplementation(async (url) => {
        if (url === pageUrl) return { data: html };
        const hit = icons[url];
        if (hit) return { data: hit.data, headers: { 'content-type': hit.type } };
        throw Object.assign(new Error('404 not found'), { response: { status: 404 } });
    });
}

const PAGE_URL = 'https://example.com/home';
const HTML = '<html><head><title>Example Home</title><link rel="icon" type="image/png" href="/static/icon.png"></head></html>';
const ICON_URL = 'https://example.com/static/icon.png';

describe('bob-favicon: input validation', () => {
    it.each(['not a url', 'ftp://example.com/', 'javascript:alert(1)'])('rejects %j with a user-facing error and no request', async (bad) => {
        const i = makeInteraction({ url: bad });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(embed(i).title).toContain('Unexpected Error');
        expect(validateSpy).not.toHaveBeenCalled();
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('trims whitespace around the URL before using it', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: `  ${PAGE_URL}  ` });
        await cmd.execute(i);
        expect(validateSpy).toHaveBeenCalledWith(PAGE_URL);
        expect(getSpy.mock.calls[0][0]).toBe(PAGE_URL);
    });
});

describe('bob-favicon: SSRF protection', () => {
    it.each(['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:9000/'])(
        'blocks %s and makes no request',
        async (bad) => {
            const i = makeInteraction({ url: bad });
            await cmd.execute(i);
            expect(validateSpy).toHaveBeenCalledWith(bad);
            expect(last(i)).toBe('The provided URL is not allowed.');
            expect(getSpy).not.toHaveBeenCalled();
            expect(createdDirs).toHaveLength(0);
        }
    );

    it('fetches the page and the favicon with the safe agents, after validating the page URL', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        await cmd.execute(makeInteraction({ url: PAGE_URL }));
        expect(validateSpy.mock.invocationCallOrder[0]).toBeLessThan(getSpy.mock.invocationCallOrder[0]);
        expect(getSpy.mock.calls.map((c) => c[0])).toEqual([PAGE_URL, ICON_URL]);
        for (const [, config] of getSpy.mock.calls) {
            expect(config.httpAgent).toBe(SAFE.httpAgent);
            expect(config.httpsAgent).toBe(SAFE.httpsAgent);
        }
    });

    it('does not request a favicon candidate that points at an internal host', async () => {
        const evilIcon = 'http://169.254.169.254/latest/meta-data/iam';
        routeAxios({
            pageUrl: PAGE_URL,
            html: `<html><head><link rel="icon" href="${evilIcon}"></head></html>`,
            icons: { [evilIcon]: { data: PNG, type: 'image/png' } }
        });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(evilIcon);
        expect(last(i).embeds[0].data.description).toBe('Could not find or download any favicons from **example.com**');
    });
});

describe('bob-favicon: happy path', () => {
    it('shows MD5 and SHA256 of the favicon and attaches it', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);

        expect(embed(i).title).toContain('Favicon Analysis: example.com');
        expect(embed(i).description).toContain('Example Home');
        const hashes = field(i, 'Hash Values').value;
        const md5 = crypto.createHash('md5').update(PNG).digest('hex');
        const sha256 = crypto.createHash('sha256').update(PNG).digest('hex');
        expect(hashes).toContain(md5.slice(0, 16));
        expect(hashes).toContain(sha256.slice(0, 16));
        expect(field(i, 'Technical Details').value).toContain('image/png');
        expect(Object.keys(i.fileContents)).toEqual(['favicon-example_com.png']);
        expect(i.fileContents['favicon-example_com.png'].equals(PNG)).toBe(true);
    });

    it('links the Censys search to the favicon MD5', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        const md5 = crypto.createHash('md5').update(PNG).digest('hex');
        expect(field(i, 'Search Platforms').value).toContain(`md5_hash%3D${md5}`);
    });

    it('computes the Shodan favicon hash (signed mmh3 of newline-wrapped base64)', async () => {
        const murmur = require('murmurhash');
        const wrapped = PNG.toString('base64').replace(/(.{76})/g, '$1\n') + '\n';
        const expected = murmur.v3(wrapped) | 0;
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(field(i, 'Search Platforms').value).toContain(`http.favicon.hash%3A${expected})`);
    });

    it('shows the MurmurHash3 in hexadecimal when format is hex', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: PAGE_URL, format: 'hex' });
        await cmd.execute(i);
        const dec = require('../../utils/favicon-hash.js').shodanFaviconHash(PNG);
        const shown = field(i, 'Hash Values').value;
        expect(shown).toContain((dec >>> 0).toString(16));
        expect(shown).not.toContain(`\`${dec}\``);
    });

    it('falls back to /favicon.ico and warns when the page declares no icon', async () => {
        const ico = Buffer.from('000001000100', 'hex');
        routeAxios({
            pageUrl: PAGE_URL,
            html: '<html><head><title>Bare</title></head></html>',
            icons: { 'https://example.com/favicon.ico': { data: ico, type: 'image/x-icon' } }
        });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(field(i, 'Notice').value).toMatch(/default favicon\.ico/);
        expect(Object.keys(i.fileContents)).toEqual(['favicon-example_com.ico']);
    });

    it('exports a JSON analysis alongside the image when raw is set', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        const i = makeInteraction({ url: PAGE_URL, raw: true });
        await cmd.execute(i);

        expect(embed(i).title).toContain('Raw Favicon Data Export');
        expect(Object.keys(i.fileContents).sort()).toEqual(['favicon-analysis-example_com.json', 'favicon-example_com.png']);
        const json = JSON.parse(i.fileContents['favicon-analysis-example_com.json'].toString());
        expect(json.domain).toBe('example.com');
        expect(json.faviconUrl).toBe(ICON_URL);
        expect(json.hashes.md5).toBe(crypto.createHash('md5').update(PNG).digest('hex'));
    });

    it('lists the URLs it tried when no candidate returns an image', async () => {
        routeAxios({
            pageUrl: PAGE_URL,
            html: HTML,
            icons: { [ICON_URL]: { data: Buffer.from('<html>nope</html>'), type: 'text/html' } }
        });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(embed(i).title).toContain('No Favicon Found');
        expect(field(i, 'Attempted URLs').value).toContain(ICON_URL);
        expect(last(i).files).toBeUndefined();
    });
});

describe('bob-favicon: scraped content handling', () => {
    it('does not put scraped @everyone text in the message content', async () => {
        routeAxios({
            pageUrl: PAGE_URL,
            html: '<html><head><title>@everyone free nitro</title><link rel="icon" href="/i.png"></head></html>',
            icons: { 'https://example.com/i.png': { data: PNG, type: 'image/png' } }
        });
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(last(i).content).toBeUndefined();
    });
});

describe('bob-favicon: upstream failures', () => {
    const pageFails = (err) => getSpy.mockRejectedValue(err);

    it('reports an unresolvable hostname by domain, not by error text', async () => {
        pageFails(Object.assign(new Error('getaddrinfo ENOTFOUND example.com 10.9.9.9'), { code: 'ENOTFOUND' }));
        const i = makeInteraction({ url: PAGE_URL });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(embed(i).title).toContain('Connection Error');
        expect(embed(i).description).toBe('Cannot resolve hostname: example.com');
    });

    it('reports a timeout without the underlying error message', async () => {
        pageFails(Object.assign(new Error('timeout of 15000ms exceeded secret-proxy.internal'), { code: 'ECONNABORTED' }));
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(embed(i).description).toMatch(/timeout/i);
        expect(JSON.stringify(last(i))).not.toContain('secret-proxy.internal');
    });

    it('reports the HTTP status of an error response', async () => {
        pageFails(Object.assign(new Error('Request failed secret-detail'), { response: { status: 503, statusText: 'Service Unavailable' } }));
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(embed(i).description).toBe('HTTP 503: Service Unavailable');
    });

    it('uses a generic message for any other fetch error', async () => {
        pageFails(new Error('ECONNRESET to 10.0.0.5:5432 secret'));
        const i = makeInteraction({ url: PAGE_URL });
        await cmd.execute(i);
        expect(embed(i).description).toBe('Failed to fetch webpage');
        expect(JSON.stringify(last(i))).not.toContain('secret');
    });

    it('gives a generic embed when something unexpected throws', async () => {
        require('../../utils/temp.js').reportDirPath.mockImplementationOnce(() => {
            throw new Error('EACCES /srv/secret/path');
        });
        const i = makeInteraction({ url: PAGE_URL });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(embed(i).title).toContain('Unexpected Error');
        expect(JSON.stringify(last(i))).not.toContain('/srv/secret/path');
    });
});

describe('bob-favicon: temp file cleanup', () => {
    it('removes the temp directory after a successful analysis', async () => {
        routeAxios({ pageUrl: PAGE_URL, html: HTML, icons: { [ICON_URL]: { data: PNG, type: 'image/png' } } });
        await cmd.execute(makeInteraction({ url: PAGE_URL }));
        expect(createdDirs).toHaveLength(1);
        await vi.waitFor(() => expect(fs.existsSync(createdDirs[0])).toBe(false));
    });

    it('removes the temp directory when the page fetch fails', async () => {
        getSpy.mockRejectedValue(new Error('boom'));
        await cmd.execute(makeInteraction({ url: PAGE_URL }));
        expect(createdDirs).toHaveLength(1);
        await vi.waitFor(() => expect(fs.existsSync(createdDirs[0])).toBe(false));
    });
});
