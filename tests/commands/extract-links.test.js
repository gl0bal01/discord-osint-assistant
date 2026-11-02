import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Everything the command writes (report dir, archives) goes under this dir.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-links-test-'));
process.env.REPORTS_DIR = path.join(tmpRoot, 'reports');
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client-id';

const SAFE = { httpAgent: { safe: 'http' }, httpsAgent: { safe: 'https' } };
const INTERNAL = /^(127\.|10\.|192\.168\.|169\.254\.|localhost$)/;

let cmd, axios, getSpy, validateSpy, dirSpy;
let createdDirs;

beforeAll(() => {
    // Spies on destructured imports must be installed BEFORE the command is required.
    validateSpy = vi.spyOn(require('../../utils/ssrf.js'), 'validateUrlNotInternal');
    vi.spyOn(require('../../utils/ssrf.js'), 'getSafeAxiosConfig').mockReturnValue(SAFE);
    dirSpy = vi.spyOn(require('../../utils/temp.js'), 'reportDirPath').mockImplementation((name) => {
        const d = fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
        createdDirs.push(d);
        return d;
    });
    axios = require('axios');
    getSpy = vi.spyOn(axios, 'get');
    cmd = require('../../commands/extract-links.js');
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

// editReply snapshots attached files at call time, because the command deletes them right after.
function makeInteraction(url, { failOnFiles = false } = {}) {
    const replies = [];
    const fileContents = {};
    return {
        replies,
        fileContents,
        user: { id: 'u1', tag: 'alice#0001' },
        options: { getString: (k) => (k === 'url' ? url : null) },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (payload) => {
            replies.push(payload);
            if (payload && payload.files) {
                for (const f of payload.files) {
                    fileContents[path.extname(f.attachment)] = fs.readFileSync(f.attachment, 'utf8');
                }
                if (failOnFiles) throw new Error('discord upload failed');
            }
        })
    };
}

const PAGE = `<html><head><title>Example Page</title></head><body>
<a href="/b">Beta</a><a href="https://other.example.org/x">Other</a>
<a href="/b">Beta again</a><a href="/a">Alpha</a><a>no href</a></body></html>`;

describe('bob-extract-links: input validation', () => {
    it.each(['not a url', 'example.com', ''])('rejects %j without any request', async (bad) => {
        const i = makeInteraction(bad);
        await cmd.execute(i);
        expect(i.replies.at(-1)).toMatch(/valid URL starting with `http/);
        expect(validateSpy).not.toHaveBeenCalled();
        expect(getSpy).not.toHaveBeenCalled();
    });

    it.each(['ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd'])('rejects non-http scheme %s', async (bad) => {
        const i = makeInteraction(bad);
        await cmd.execute(i);
        expect(i.replies.at(-1)).toMatch(/valid URL starting with `http/);
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('bob-extract-links: SSRF protection', () => {
    it.each(['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/'])(
        'blocks %s and makes no request',
        async (bad) => {
            const i = makeInteraction(bad);
            await cmd.execute(i);
            expect(validateSpy).toHaveBeenCalledWith(new URL(bad).href);
            expect(i.replies.at(-1)).toBe('The provided URL is not allowed.');
            expect(getSpy).not.toHaveBeenCalled();
        }
    );

    it('validates the URL before fetching and fetches with the safe agents', async () => {
        const order = [];
        validateSpy.mockImplementation(async () => { order.push('validate'); });
        getSpy.mockImplementation(async () => { order.push('get'); return { data: PAGE }; });
        await cmd.execute(makeInteraction('https://example.com/page'));
        expect(order).toEqual(['validate', 'get']);
        const [url, config] = getSpy.mock.calls[0];
        expect(url).toBe('https://example.com/page');
        expect(config.httpAgent).toBe(SAFE.httpAgent);
        expect(config.httpsAgent).toBe(SAFE.httpsAgent);
        expect(config.timeout).toBeGreaterThan(0);
    });
});

describe('bob-extract-links: happy path', () => {
    it('attaches a text and an HTML report and reports the unique link count', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        const i = makeInteraction('https://example.com/page');
        await cmd.execute(i);

        const reply = i.replies.at(-1);
        expect(reply.content).toContain('**3** unique links');
        expect(reply.content).toContain('`example.com`');
        expect(reply.files).toHaveLength(2);
        expect(Object.keys(i.fileContents).sort()).toEqual(['.html', '.txt']);
    });

    it('resolves relative links, drops duplicates and sorts alphabetically in the text report', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        const i = makeInteraction('https://example.com/page');
        await cmd.execute(i);

        const txt = i.fileContents['.txt'];
        expect(txt).toContain('PAGE TITLE: Example Page');
        expect(txt).toContain('TOTAL UNIQUE LINKS: 3');
        const order = ['https://example.com/a', 'https://example.com/b', 'https://other.example.org/x'].map((u) => txt.indexOf(u));
        expect(order.every((n) => n >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(txt.match(/https:\/\/example\.com\/b/g)).toHaveLength(1);
    });

    it('keeps the anchor text of the first occurrence of a duplicated link', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        const i = makeInteraction('https://example.com/page');
        await cmd.execute(i);
        expect(i.fileContents['.txt']).toContain('"Beta"\n   https://example.com/b');
    });

    it('says so when the page has no links and attaches nothing', async () => {
        getSpy.mockResolvedValue({ data: '<html><body><p>nothing</p></body></html>' });
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        expect(i.replies.at(-1)).toBe('No links found on https://example.com/.');
        expect(createdDirs).toHaveLength(0);
    });
});

describe('bob-extract-links: scraped content handling', () => {
    const evil = `<html><head><title>&lt;img src=x onerror=alert(1)&gt; @everyone</title></head><body>
<a href="https://evil.example/?q=1&x=2">&lt;script&gt;alert(1)&lt;/script&gt; @everyone</a></body></html>`;

    it('escapes scraped title and anchor text in the HTML report', async () => {
        getSpy.mockResolvedValue({ data: evil });
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        const html = i.fileContents['.html'];
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('<script>alert(1)');
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('q=1&amp;x=2');
    });

    it('escapes the requesting user tag in the HTML report', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        const i = makeInteraction('https://example.com/');
        i.user.tag = '<b>mallory</b>#0001';
        await cmd.execute(i);
        expect(i.fileContents['.html']).toContain('&lt;b&gt;mallory&lt;/b&gt;#0001');
        expect(i.fileContents['.html']).not.toContain('<b>mallory</b>');
    });

    it('does not relay scraped @everyone text in the Discord message content', async () => {
        getSpy.mockResolvedValue({ data: evil });
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        expect(i.replies.at(-1).content).not.toMatch(/@everyone/);
    });
});

describe('bob-extract-links: upstream failures', () => {
    it('gives a timeout message that hides the underlying error message', async () => {
        getSpy.mockRejectedValue(new axios.AxiosError('timeout of 15000ms exceeded for secret-host.internal', 'ECONNABORTED'));
        const i = makeInteraction('https://example.com/');
        await expect(cmd.execute(i)).resolves.not.toThrow();
        const msg = i.replies.at(-1);
        expect(msg).toMatch(/timed out/);
        expect(msg).not.toContain('secret-host.internal');
    });

    it('reports the HTTP status for an error response without leaking the message', async () => {
        const err = new axios.AxiosError('Request failed with status code 403 secret-token-123', 'ERR_BAD_REQUEST', {}, {}, { status: 403 });
        getSpy.mockRejectedValue(err);
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        expect(i.replies.at(-1)).toMatch(/HTTP status 403.*blocking automated requests/);
        expect(i.replies.at(-1)).not.toContain('secret-token-123');
    });

    it('says the site could not be reached when there is no response', async () => {
        getSpy.mockRejectedValue(new axios.AxiosError('getaddrinfo ENOTFOUND db.internal', 'ENOTFOUND', {}, {}));
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        expect(i.replies.at(-1)).toMatch(/could not be reached/);
        expect(i.replies.at(-1)).not.toContain('db.internal');
    });

    it('gives a generic message for a non-HTTP error', async () => {
        getSpy.mockRejectedValue(new Error('ECONNRESET 10.0.0.5:5432 secret'));
        const i = makeInteraction('https://example.com/');
        await cmd.execute(i);
        expect(i.replies.at(-1)).toBe('An unexpected error occurred. Please try again later.');
    });
});

describe('bob-extract-links: temp file cleanup', () => {
    it('removes the temp report directory after a successful reply', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        await cmd.execute(makeInteraction('https://example.com/'));
        expect(createdDirs).toHaveLength(1);
        await vi.waitFor(() => expect(fs.existsSync(createdDirs[0])).toBe(false));
    });

    it('removes the temp report directory when sending the reply fails', async () => {
        getSpy.mockResolvedValue({ data: PAGE });
        const i = makeInteraction('https://example.com/', { failOnFiles: true });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(i.replies.at(-1)).toBe('An unexpected error occurred. Please try again later.');
        expect(i.replies.at(-1)).not.toContain('discord upload failed');
        await vi.waitFor(() => expect(fs.existsSync(createdDirs[0])).toBe(false));
    });
});
