import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maigret-test-'));
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
    cmd = require('../../commands/maigret.js');
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
const embedOf = (i) => lastReply(i).embeds[0].data;
const writes = (content) => async (_cmd, _args, out) => {
    fs.writeFileSync(out, content);
    return { stderr: '', code: 0 };
};

const SMALL = [
    '[+] GitHub: https://github.com/johndoe',
    '[+] Reddit: https://www.reddit.com/user/johndoe',
    'Total Websites Username Detected On : 2',
    ''
].join('\n');

describe('bob-maigret input validation', () => {
    it.each(['ab', 'john doe', '../etc/passwd', 'a;b&c', 'a'.repeat(51)])('rejects %j without spawning', async (username) => {
        const i = makeInteraction({ username });
        await cmd.execute(i);
        expect(lastReply(i)).toMatch(/Invalid username format/);
        expect(spawnToFile).not.toHaveBeenCalled();
    });
    it('does not hand a dash-prefixed username to maigret as an option', async () => {
        spawnToFile.mockImplementation(writes(SMALL));
        await cmd.execute(makeInteraction({ username: '--help' }));
        const args = spawnToFile.mock.calls[0]?.[1] ?? [];
        expect(args[0]?.startsWith('-') ?? false).toBe(false);
    });
});

describe('bob-maigret scan', () => {
    it('previews a small report in the embed and attaches the file', async () => {
        spawnToFile.mockImplementation(writes(SMALL));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        const embed = embedOf(i);
        expect(embed.title).toBe('OSINT Scan Results for johndoe');
        expect(embed.description).toBe('Scan completed successfully');
        expect(embed.fields[0].name).toBe('Results Preview');
        expect(embed.fields[0].value).toContain('[+] GitHub: https://github.com/johndoe');
        expect(lastReply(i).files[0].name).toBe('johndoe_results.txt');
    });

    it('skips the preview and says so when the report is large', async () => {
        spawnToFile.mockImplementation(writes('[+] Site: https://x.example/johndoe\n'.repeat(100)));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('too large to preview');
        expect(embedOf(i).fields).toBeUndefined();
        expect(lastReply(i).files).toHaveLength(1);
    });

    it('reports no findings when the output is empty', async () => {
        spawnToFile.mockImplementation(writes('   \n'));
        const i = makeInteraction({ username: 'johndoe' });
        await cmd.execute(i);
        expect(embedOf(i).description).toBe('Scan completed with no findings');
        expect(lastReply(i).files).toBeUndefined();
    });

    it('passes the username as one argv element with the expected flags and timeout', async () => {
        spawnToFile.mockImplementation(writes(SMALL));
        await cmd.execute(makeInteraction({ username: 'john.doe_1', verbose: true, timeout: 120 }));
        const [, args, , opts] = spawnToFile.mock.calls[0];
        expect(args).toEqual(['john.doe_1', '-a', '--no-progressbar', '--txt', '--verbose']);
        expect(opts.timeout).toBe(120_000);
    });

    it('defaults to a 300 second timeout without --verbose', async () => {
        spawnToFile.mockImplementation(writes(SMALL));
        await cmd.execute(makeInteraction({ username: 'johndoe' }));
        const [, args, , opts] = spawnToFile.mock.calls[0];
        expect(args).not.toContain('--verbose');
        expect(opts.timeout).toBe(300_000);
    });
});

describe('bob-maigret failures', () => {
    it('tells the user the tool is missing, without the underlying message', async () => {
        spawnToFile.mockRejectedValue(coded(`Failed to start process: spawn maigret ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        const embed = embedOf(i);
        expect(embed.title).toBe('Scan Error');
        expect(embed.fields[0].value).toContain('not installed');
        expect(JSON.stringify(embed)).not.toContain(SECRET);
    });

    it('suggests a larger timeout when the scan times out', async () => {
        spawnToFile.mockRejectedValue(coded(`Process timed out after 60 seconds ${SECRET}`, 'ETIMEDOUT'));
        const i = makeInteraction({ username: 'johndoe', timeout: 60 });
        await cmd.execute(i);
        expect(embedOf(i).fields[0].value).toContain('timed out after 60s');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it('shows a generic message for any other failure', async () => {
        spawnToFile.mockRejectedValue(new Error(`kaboom ${SECRET}`));
        const i = makeInteraction({ username: 'johndoe' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).fields[0].value).toContain('unexpected error');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });
});

describe('bob-maigret cleanup', () => {
    it('removes the temp output file after a successful scan', async () => {
        spawnToFile.mockImplementation(writes(SMALL));
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
        expect(fs.existsSync(outFiles[0])).toBe(false);
    });
});
