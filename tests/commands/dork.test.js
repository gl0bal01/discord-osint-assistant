import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let dork;
let workDir; // stands in for temp/reports/
let reportsDir; // stands in for reports/
const nameOf = (p) => path.basename(p);

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dork-work-'));
    reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dork-reports-'));
    process.env.REPORTS_DIR = reportsDir;
    // vi.mock does not intercept CJS require(): spy before dork.js destructures reportFilePath
    const temp = require('../../utils/temp.js');
    vi.spyOn(temp, 'reportFilePath').mockImplementation((label, ext = 'txt') =>
        path.join(workDir, `${label}_${Math.random().toString(16).slice(2)}.${ext}`));
    dork = require('../../commands/dork.js');
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(reportsDir, { recursive: true, force: true });
});

function makeInteraction(options = {}) {
    return {
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

// Runs the command with fake timers so the delayed temp-file cleanup is observable
async function run(options) {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const interaction = makeInteraction(options);
    await dork.execute(interaction);
    return interaction;
}

const lastReply = (i) => i.editReply.mock.calls.at(-1)[0];
const fileOf = (i) => lastReply(i).files[0].attachment; // AttachmentBuilder(path)
const urlsIn = (text) => text.split('\n').filter((l) => l.startsWith('https://'));

describe('bob-dork input validation', () => {
    it.each([
        ['firstname', { lastname: 'Doe' }],
        ['lastname', { firstname: 'John' }]
    ])('asks for both names when %s is missing', async (_missing, opts) => {
        const i = await run(opts);
        expect(lastReply(i)).toBe('Both first name and last name are required.');
        expect(fs.readdirSync(workDir)).toEqual([]);
    });

    it('rejects whitespace-only names', async () => {
        const i = await run({ firstname: '   ', lastname: 'Doe' });
        expect(typeof lastReply(i)).toBe('string');
    });
});

describe('bob-dork success output', () => {
    it('attaches a Google dork file for the person and says how many URLs it holds', async () => {
        const i = await run({ firstname: 'John', lastname: 'Doe' });
        const reply = lastReply(i);
        expect(reply.content).toMatch(/^Generated 10 search URLs for John Doe\./);
        expect(reply.files).toHaveLength(1);
        expect(reply.files[0].name).toBe('John_Doe_dorks.txt');

        const text = fs.readFileSync(fileOf(i), 'utf8');
        const urls = urlsIn(text);
        expect(urls).toHaveLength(10);
        expect(urls[0]).toBe(`https://www.google.com/search?q=${encodeURIComponent('"John Doe"')}`);
        expect(text).toContain('# Advanced Mode: No');
        expect(text).toContain('# Total URLs: 10');
    });

    it('adds the invasive dorks only in advanced mode', async () => {
        const basic = urlsIn(fs.readFileSync(fileOf(await run({ firstname: 'John', lastname: 'Doe' })), 'utf8'));
        const i = await run({ firstname: 'John', lastname: 'Doe', advanced: true });
        const text = fs.readFileSync(fileOf(i), 'utf8');
        expect(urlsIn(text).length).toBeGreaterThan(basic.length);
        expect(text).toContain('# Advanced Mode: Yes');
        expect(text).toContain(encodeURIComponent('site:vinelink.com'));
        expect(basic.join('\n')).not.toContain(encodeURIComponent('site:vinelink.com'));
    });

    it.each([
        ['bing', 'https://www.bing.com/search?q='],
        ['duckduckgo', 'https://duckduckgo.com/?q='],
        ['yandex', 'https://yandex.com/search/?text=']
    ])('builds %s search URLs when that engine is chosen', async (engine, base) => {
        const i = await run({ firstname: 'John', lastname: 'Doe', engine });
        const urls = urlsIn(fs.readFileSync(fileOf(i), 'utf8'));
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.every((u) => u.startsWith(base))).toBe(true);
    });

    it('URL-encodes name characters so they cannot inject query parameters', async () => {
        const i = await run({ firstname: 'A&b=1', lastname: 'D#oe' });
        const urls = urlsIn(fs.readFileSync(fileOf(i), 'utf8'));
        expect(urls.every((u) => u.split('?q=')[1] && !/[&#\s"]/.test(u.split('?q=')[1]))).toBe(true);
    });

    it('keeps path traversal characters out of the attachment name', async () => {
        const i = await run({ firstname: '../../etc', lastname: 'pass/wd' });
        expect(lastReply(i).files[0].name).toMatch(/^[A-Za-z0-9_-]+_dorks\.txt$/);
        expect(path.dirname(fileOf(i))).toBe(workDir);
    });

    it('archives a durable copy in the reports directory', async () => {
        await run({ firstname: 'Archive', lastname: 'Me' });
        const archived = fs.readdirSync(reportsDir).filter((f) => f.startsWith('dork_Archive_Me'));
        expect(archived).toHaveLength(1);
        expect(fs.readFileSync(path.join(reportsDir, archived[0]), 'utf8')).toContain('# OSINT Search URLs for Archive Me');
    });
});

describe('bob-dork temp file cleanup', () => {
    it('removes the temp file shortly after the reply is sent', async () => {
        const i = await run({ firstname: 'Clean', lastname: 'Up' });
        const file = fileOf(i);
        expect(fs.existsSync(file)).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false)); // unlink is real async I/O
    });

    it('removes the temp file even when sending the reply fails', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const before = new Set(fs.readdirSync(workDir));
        const interaction = makeInteraction({ firstname: 'Leak', lastname: 'Test' });
        interaction.editReply.mockRejectedValueOnce(new Error('discord down'));
        await dork.execute(interaction);
        await vi.advanceTimersByTimeAsync(10000);
        await vi.waitFor(() => expect(fs.readdirSync(workDir).filter((f) => !before.has(f))).toEqual([]), { timeout: 300 });
    });
});

describe('bob-dork error handling', () => {
    it('replies with a generic message and does not throw when writing the file fails', async () => {
        vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('ENOSPC /secret/path'); });
        const interaction = makeInteraction({ firstname: 'John', lastname: 'Doe' });
        await expect(dork.execute(interaction)).resolves.not.toThrow();
        const reply = lastReply(interaction);
        expect(reply).toBe('An error occurred while generating dork URLs.');
        expect(reply).not.toMatch(/ENOSPC|secret/);
    });
});
