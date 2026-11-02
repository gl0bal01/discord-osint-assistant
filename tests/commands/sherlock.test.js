import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sherlock-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });

let cmd, spawnToFile, outFiles;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(): spy before the command destructures its imports
    spawnToFile = vi.spyOn(require('../../utils/process.js'), 'safeSpawnToFile');
    let n = 0;
    outFiles = [];
    fs.mkdirSync(path.join(tmp, 'out'), { recursive: true });
    vi.spyOn(require('../../utils/temp.js'), 'reportFilePath').mockImplementation((label, ext = 'txt') => {
        const f = path.join(tmp, 'out', `${label}_${n++}.${ext}`);
        outFiles.push(f);
        return f;
    });
    cmd = require('../../commands/sherlock.js');
});

beforeEach(() => {
    outFiles.length = 0;
    spawnToFile.mockReset();
    spawnToFile.mockRejectedValue(new Error('unstubbed safeSpawnToFile'));
});

afterAll(() => {
    vi.restoreAllMocks();
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
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

const lastReply = (i) => i.editReply.mock.calls.at(-1)[0];
const contentOf = (i) => {
    const r = lastReply(i);
    return typeof r === 'string' ? r : r.content;
};
const writes = (content, code = 0) => async (_cmd, _args, out) => {
    fs.writeFileSync(out, content);
    return { stderr: '', code };
};

const OUTPUT = [
    '[*] Checking username johndoe on:',
    '[+] GitHub: https://github.com/johndoe',
    '[+] Reddit: https://www.reddit.com/user/johndoe',
    '[+] GitHub: https://github.com/johndoe',
    '[-] Foo: Not Found!',
    ''
].join('\n');

describe('bob-sherlock input validation', () => {
    it.each(['ab', 'john doe', 'john/doe', 'a'.repeat(51), 'x$y'])('rejects %j without spawning', async (username) => {
        const i = makeInteraction({ username });
        await cmd.execute(i);
        expect(contentOf(i)).toMatch(/Invalid Username Format/);
        expect(spawnToFile).not.toHaveBeenCalled();
    });

    it('strips shell metacharacters so the username stays a single clean argv element', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'john;doe`id`' }));
        const [, args] = spawnToFile.mock.calls[0];
        expect(args).toEqual(['--', 'johndoeid']);
    });
    it('passes a dash-prefixed username after -- so it is a positional argument', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: '--help' }));
        const args = spawnToFile.mock.calls[0][1];
        expect(args).toEqual(['--', '--help']);
    });
});

describe('bob-sherlock scan', () => {
    it('lists unique profiles sorted by platform and attaches the raw output', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        const reply = lastReply(i);
        expect(reply.content).toContain('**Profiles Found:** 2');
        expect(reply.content).toContain('1. **GitHub**: https://github.com/johndoe');
        expect(reply.content).toContain('2. **Reddit**: https://www.reddit.com/user/johndoe');
        expect(reply.files).toHaveLength(1);
        expect(reply.files[0].name).toBe('sherlock_johndoe_results.txt');
        expect(reply.files[0].attachment.toString()).toBe(OUTPUT);
    });

    it('reports when no profiles match', async () => {
        spawnToFile.mockImplementation(writes('[*] Checking username johndoe on:\n[-] Foo: Not Found!\n'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('No Profiles Found');
    });

    it('says so when the scan produced no output, without leaking stderr', async () => {
        spawnToFile.mockImplementation(async (_c, _a, out) => {
            fs.writeFileSync(out, '');
            return { stderr: SECRET, code: 1 };
        });
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('No Results Generated');
        expect(contentOf(i)).not.toContain(SECRET);
    });

    it('caps the inline list at 10 links and points to the attachment', async () => {
        const many = Array.from({ length: 12 }, (_, n) => `[+] Site${String(n).padStart(2, '0')}: https://s${n}.example/johndoe`).join('\n');
        spawnToFile.mockImplementation(writes(many));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('**Profiles Found:** 12');
        expect(contentOf(i)).toContain('... and 2 more');
        expect(contentOf(i)).not.toContain('11. ');
    });

    it('passes flags and the timeout through to the spawn', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe', verbose: true, 'include-nsfw': true, timeout: 90 }));
        const [, args, , opts] = spawnToFile.mock.calls[0];
        expect(args).toEqual(['--verbose', '--nsfw', '--', 'johndoe']);
        expect(opts.timeout).toBe(90_000);
    });

    it('defaults to a 300 second timeout and no extra flags', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        const [, args, , opts] = spawnToFile.mock.calls[0];
        expect(args).toEqual(['--', 'johndoe']);
        expect(opts.timeout).toBe(300_000);
    });

    it('does not pass bot secrets to the child environment', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        const env = spawnToFile.mock.calls[0][3].env;
        expect(env).not.toHaveProperty('DISCORD_TOKEN');
        expect(env.PYTHONUNBUFFERED).toBe('1');
    });
});

describe('bob-sherlock failures', () => {
    it('shows a timeout hint without the underlying message', async () => {
        spawnToFile.mockRejectedValue(coded(`Process timed out after 30 seconds ${SECRET}`, 'ETIMEDOUT'));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(contentOf(i)).toContain('Timeout Error');
        expect(contentOf(i)).not.toContain(SECRET);
    });

    it('shows a generic message for an unexpected spawn failure', async () => {
        spawnToFile.mockRejectedValue(new Error(`kaboom ${SECRET}`));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(contentOf(i)).toContain('Unexpected Error');
        expect(contentOf(i)).not.toContain(SECRET);
    });
    it('tells the user the tool is missing when safeSpawn reports it failed to start', async () => {
        spawnToFile.mockRejectedValue(coded(`Failed to start process: spawn sherlock ENOENT`, 'ENOENT'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(contentOf(i)).toContain('Tool Not Found');
    });
});

describe('bob-sherlock cleanup', () => {
    it('removes the temp output file after a successful scan', async () => {
        spawnToFile.mockImplementation(writes(OUTPUT));
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        expect(outFiles).toHaveLength(1);
        expect(fs.existsSync(outFiles[0])).toBe(false);
    });

    it('removes the temp output file when the scan fails midway', async () => {
        spawnToFile.mockImplementation(async (_c, _a, out) => {
            fs.writeFileSync(out, 'partial');
            throw coded('Process timed out after 30 seconds', 'ETIMEDOUT');
        });
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        expect(outFiles).toHaveLength(1);
        expect(fs.existsSync(outFiles[0])).toBe(false);
    });
});
