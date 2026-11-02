import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// vi.mock does not intercept require() inside the CJS command, so the previous version of this
// file ran the real safeSpawn and passed only because the templates directory did not exist.
// Spy on the shared module object instead, before the command destructures it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuclei-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
const TEMPLATES = path.join(tmp, 'templates');
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });

let cmd, spawn, outFiles;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    fs.mkdirSync(TEMPLATES, { recursive: true });
    spawn = vi.spyOn(require('../../utils/process.js'), 'safeSpawn');
    cmd = require('../../commands/nuclei.js');
});

beforeEach(() => {
    process.env.NUCLEI_TEMPLATE_PATH = TEMPLATES;
    outFiles = [];
    spawn.mockReset();
    spawn.mockRejectedValue(new Error('unstubbed safeSpawn'));
});

afterAll(() => {
    delete process.env.NUCLEI_TEMPLATE_PATH;
    vi.restoreAllMocks();
    for (const f of outFiles) fs.rmSync(f, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
});

function makeInteraction(options = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined)
    };
}

const lastEdit = (i) => i.editReply.mock.calls.at(-1)[0];
const outArg = (args) => args[args.indexOf('-o') + 1];
// Stub nuclei: record the -o file (so cleanup can be checked) and write findings into it
const findings = (body, stderr = '') => async (_bin, args) => {
    outFiles.push(outArg(args));
    if (body !== null) fs.writeFileSync(outArg(args), body);
    return { stdout: '', stderr, code: 0 };
};

const OUTPUT = [
    '[github-user-enum:github] [http] [info] https://github.com/johndoe',
    '[reddit-user-enum:reddit] [http] [info] https://www.reddit.com/user/johndoe',
    '[github-user-enum:github] [http] [info] https://github.com/johndoe',
    ''
].join('\n');

describe('bob-nuclei input validation', () => {
    it.each(['../../etc/passwd', 'ab', 'john doe', 'john;id', 'a'.repeat(51)])('rejects username %j without spawning', async (username) => {
        const i = makeInteraction({ username });
        await cmd.execute(i);
        expect(i.deferReply).toHaveBeenCalled();
        expect(lastEdit(i).content).toMatch(/Invalid Username Format/);
        expect(spawn).not.toHaveBeenCalled();
    });

    it('rejects a missing username without spawning', async () => {
        const i = makeInteraction({});
        await cmd.execute(i);
        expect(lastEdit(i).content).toMatch(/Invalid Username Format/);
        expect(spawn).not.toHaveBeenCalled();
    });

    it.each(['good,bad tag!', 'a;id', 'x,$(id)', '-oops/../x', 'dev', 'social,professional', 'academic', 'osint'])('rejects tags %j without spawning', async (tags) => {
        const i = makeInteraction({ username: 'johndoe', tags });
        await cmd.execute(i);
        expect(lastEdit(i).content).toMatch(/Invalid Tag/);
        expect(lastEdit(i).content).toContain('`social`');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('fails loudly, without spawning, when the templates directory is missing', async () => {
        process.env.NUCLEI_TEMPLATE_PATH = path.join(tmp, 'nope');
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(lastEdit(i).content).toContain('Nuclei templates not found');
        expect(spawn).not.toHaveBeenCalled();
    });
});

describe('bob-nuclei scan', () => {
    it('shows the findings inline, attaches the file and lists unique profile URLs', async () => {
        spawn.mockImplementation(findings(OUTPUT));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        const reply = lastEdit(i);
        expect(reply.content).toContain('<@u1> ✅ **OSINT Enumeration Complete**');
        expect(reply.allowedMentions).toEqual({ users: ['u1'] }); // pings the requester only
        expect(reply.content).toContain('2 potential profiles found');
        expect(reply.content).toContain('https://github.com/johndoe');
        expect(reply.files[0].attachment).toBe(outFiles[0]);
        expect(reply.files[0].name).toMatch(/^johndoe_osint_results_\d{4}-\d{2}-\d{2}\.txt$/);
        const list = i.followUp.mock.calls.at(-1)[0].content;
        expect(list).toContain('Discovered Profiles');
        expect(list).toContain('1. https://github.com/johndoe\n2. https://www.reddit.com/user/johndoe');
    });

    it('keeps every message under the Discord limit for large outputs', async () => {
        const big = Array.from({ length: 200 }, (_, n) => `[t:site${n}] [http] [info] https://site${n}.example.com/johndoe`).join('\n');
        spawn.mockImplementation(findings(big));
        const i = makeInteraction({ username: 'johndoe', tags: 'social,gaming,coding,tech,business' });
        await cmd.execute(i);
        const sent = [...i.editReply.mock.calls, ...i.followUp.mock.calls].map(([m]) => m.content);
        expect(sent.length).toBeGreaterThan(2);
        for (const content of sent) expect(content.length).toBeLessThanOrEqual(2000);
    });

    it('builds the nuclei argv with the username as one -var element', async () => {
        spawn.mockImplementation(findings(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'john.doe_1', tags: 'Social, osint-coding,social,', timeout: 90 }));
        const [, args, opts] = spawn.mock.calls[0];
        expect(args).toEqual([
            '-t', TEMPLATES,
            '-tags', 'osint-social,osint-coding',
            '-etags', 'osint-porn',
            '-var', 'user=john.doe_1',
            '-o', outFiles[0],
            '-disable-update-check', '-esc', '-silent'
        ]);
        expect(opts.timeout).toBe(90_000);
    });

    it('excludes adult-site templates unless that category is requested', async () => {
        spawn.mockImplementation(findings(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'john' }));
        expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-tags', 'osint', '-etags', 'osint-porn']));
        spawn.mockClear();
        await cmd.execute(makeInteraction({ username: 'john', tags: 'porn' }));
        expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-tags', 'osint-porn']));
        expect(spawn.mock.calls[0][1]).not.toContain('-etags');
    });

    it('uses -v instead of -silent in verbose mode and defaults to a 300 second timeout', async () => {
        spawn.mockImplementation(findings(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe', verbose: true }));
        const [, args, opts] = spawn.mock.calls[0];
        expect(args.at(-1)).toBe('-v');
        expect(args).not.toContain('-silent');
        expect(opts.timeout).toBe(300_000);
    });

    it('reports no profiles when nuclei wrote nothing', async () => {
        spawn.mockImplementation(findings(null));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(lastEdit(i).content).toContain('✅ **OSINT Scan Complete**');
        expect(lastEdit(i).content).toContain('No profiles found');
        expect(lastEdit(i).files).toBeUndefined();
    });

    it('warns that the scan did not run correctly when stderr says so', async () => {
        spawn.mockImplementation(findings(null, 'fatal: no templates provided for scan'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(lastEdit(i).content).toContain('⚠️ **OSINT Scan Complete**');
        expect(lastEdit(i).content).toContain('did not run correctly');
    });
});

describe('bob-nuclei failures', () => {
    it('reports a missing binary without the underlying message', async () => {
        spawn.mockRejectedValue(coded(`Failed to start process: spawn nuclei ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastEdit(i).content).toContain('Configuration Error');
        expect(lastEdit(i).content).not.toContain(SECRET);
    });

    it('shows a generic error for an unexpected failure', async () => {
        spawn.mockRejectedValue(new Error(`kaboom ${SECRET}`));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastEdit(i).content).toContain('An error occurred while processing your request');
        expect(lastEdit(i).content).not.toContain(SECRET);
    });
    it('names a scan timeout as a timeout', async () => {
        spawn.mockRejectedValue(coded(`Process timed out after 90 seconds ${SECRET}`, 'ETIMEDOUT'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(lastEdit(i).content).toContain('Scan Timeout');
    });
});

describe('bob-nuclei cleanup', () => {
    it('removes the output file after a successful scan', async () => {
        spawn.mockImplementation(findings(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        expect(fs.existsSync(outFiles[0])).toBe(false);
    });

    it('removes the output file when the scan fails midway', async () => {
        spawn.mockImplementation(async (_b, args) => {
            outFiles.push(outArg(args));
            fs.writeFileSync(outArg(args), 'partial');
            throw coded('Process timed out after 90 seconds', 'ETIMEDOUT');
        });
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        expect(fs.existsSync(outFiles[0])).toBe(false);
    });
});
