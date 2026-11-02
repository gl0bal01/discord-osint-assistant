import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linkook-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });

let cmd, spawn, outDirs;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(): spy before the command destructures its imports
    spawn = vi.spyOn(require('../../utils/process.js'), 'safeSpawn');
    let n = 0;
    outDirs = [];
    vi.spyOn(require('../../utils/temp.js'), 'reportDirPath').mockImplementation((label) => {
        const d = path.join(tmp, `${label}_${n++}`);
        fs.mkdirSync(d, { recursive: true });
        outDirs.push(d);
        return d;
    });
    cmd = require('../../commands/linkook.js');
});

beforeEach(() => {
    outDirs.length = 0;
    spawn.mockReset();
    spawn.mockRejectedValue(new Error('unstubbed safeSpawn'));
});

afterEach(() => vi.useRealTimers());

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

// editReply snapshots attachment file contents at call time, because the command
// deletes its output dir shortly afterwards
function makeInteraction(options = {}) {
    const interaction = {
        user: { id: 'u1', tag: 'user#0001' },
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        sentFiles: [],
        editReply: vi.fn(async (r) => {
            for (const f of r?.files ?? []) {
                interaction.sentFiles.push({ name: f.name, body: fs.readFileSync(f.attachment, 'utf8') });
            }
        })
    };
    return interaction;
}

const lastReply = (i) => i.editReply.mock.calls.at(-1)[0];
const contentOf = (i) => {
    const r = lastReply(i);
    return typeof r === 'string' ? r : r.content;
};
const outDirArg = (args) => args[args.indexOf('--output') + 1];
const runs = (stdout, files = {}, code = 0) => async (_cmd, args) => {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(outDirArg(args), name), body);
    return { stdout, stderr: '', code };
};

describe('bob-linkook input validation', () => {
    it.each(['john doe', 'john;doe', '$(id)', 'a/b', 'né'])('rejects %j without spawning', async (username) => {
        const i = makeInteraction({ username });
        await cmd.execute(i);
        expect(contentOf(i)).toMatch(/invalid characters/);
        expect(spawn).not.toHaveBeenCalled();
    });

    it('rejects an empty username without spawning', async () => {
        const i = makeInteraction({ username: '   ' });
        await cmd.execute(i);
        expect(contentOf(i)).toMatch(/valid username/);
        expect(spawn).not.toHaveBeenCalled();
    });
    it('does not hand a dash-prefixed username to linkook as an option', async () => {
        spawn.mockImplementation(runs(''));
        await cmd.execute(makeInteraction({ username: '--help' }));
        const args = spawn.mock.calls[0]?.[1] ?? [];
        expect(args[0]?.startsWith('-') ?? false).toBe(false);
    });
});

describe('bob-linkook results', () => {
    const STDOUT = 'FOUND: github https://github.com/johndoe\nFOUND: reddit https://reddit.com/u/johndoe\nnoise\n';

    it('attaches one summary containing the found sites and result file contents', async () => {
        spawn.mockImplementation(runs(STDOUT, { 'github.json': '{"user":"johndoe"}' }));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('found on 2 platforms');
        expect(lastReply(i).files).toHaveLength(1);
        expect(i.sentFiles[0].name).toBe('linkook_johndoe_results.txt');
        expect(i.sentFiles[0].body).toContain('FOUND ON 2 SITES:\ngithub\nreddit');
        expect(i.sentFiles[0].body).toContain('=== github.json ===\n{"user":"johndoe"}');
    });

    it('raw mode attaches each result file', async () => {
        spawn.mockImplementation(runs(STDOUT, { 'a.json': '1', 'b.json': '2' }));
        const i = makeInteraction({ username: 'johndoe', raw: true });
        await cmd.execute(i);
        expect(i.sentFiles.map((f) => f.name).sort()).toEqual(['a.json', 'b.json']);
        expect(contentOf(i)).toContain('on 2 platforms');
    });

    it('raw mode sends at most 10 files and says how many were left out', async () => {
        const files = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`f${n}.json`, '{}']));
        spawn.mockImplementation(runs(STDOUT, files));
        const i = makeInteraction({ username: 'johndoe', raw: true });
        await cmd.execute(i);
        expect(lastReply(i).files).toHaveLength(10);
        expect(contentOf(i)).toContain('Showing 10/12');
    });

    it('says nothing was found when there is no stdout match and no files', async () => {
        spawn.mockImplementation(runs('Scanning...\n'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('No results found for username "johndoe"');
    });

    it('lists found site names when no result files were written', async () => {
        spawn.mockImplementation(runs('FOUND: github\n'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('Found 1 sites');
        expect(contentOf(i)).toContain('Sites: github');
    });
    it('names the site on a "[+] Site: url" line', async () => {
        spawn.mockImplementation(runs('[+] GitHub: https://github.com/johndoe\n'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('Sites: GitHub');
    });

    it('runs linkook with the username as a single argv element and a 3 minute timeout', async () => {
        spawn.mockImplementation(runs(''));
        await cmd.execute(makeInteraction({ username: 'john.doe_1' }));
        const [bin, args, opts] = spawn.mock.calls[0];
        expect(bin).toBe('linkook');
        expect(args).toEqual(['john.doe_1', '--scan-all', '--output', outDirs[0]]);
        expect(opts.timeout).toBe(180_000);
    });
});

describe('bob-linkook failures', () => {
    it('tells the user the tool is missing, without the underlying message', async () => {
        spawn.mockRejectedValue(coded(`Failed to start process: spawn linkook ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(contentOf(i)).toContain('not installed');
        expect(contentOf(i)).not.toContain(SECRET);
    });

    it.each([
        ['timeout', `Process timed out after 180 seconds ${SECRET}`],
        ['other failure', `kaboom ${SECRET}`]
    ])('shows a generic message on %s', async (_n, message) => {
        spawn.mockRejectedValue(new Error(message));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(contentOf(i)).toContain('An error occurred');
        expect(contentOf(i)).not.toContain(SECRET);
    });

    it('does not leak stderr when linkook exits non-zero with no output', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: `Traceback ${SECRET}`, code: 1 });
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(contentOf(i)).toContain('An error occurred');
        expect(contentOf(i)).not.toContain(SECRET);
    });
});

describe('bob-linkook cleanup', () => {
    it.each([
        ['a successful run', () => runs('FOUND: github\n', { 'a.json': '{}' })],
        ['a failed run', () => async () => { throw new Error('kaboom'); }]
    ])('removes the output directory 5 seconds after %s', async (_n, impl) => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        spawn.mockImplementation(impl());
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        expect(fs.existsSync(outDirs[0])).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        vi.useRealTimers();
        await vi.waitFor(() => expect(fs.existsSync(outDirs[0])).toBe(false));
    });
});
