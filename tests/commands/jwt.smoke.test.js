import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageFlags } from 'discord.js';

// vi.mock does not intercept require() inside the CJS command, so the previous version of this
// file ran the real findJwtTool and passed only because jwt_tool is not installed (every case
// ended in the "JWT tool not found" error embed). Spy on the shared module objects instead,
// before the command destructures them.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
process.env.JWT_TEMP_FOLDER = path.join(tmp, 'jwt');
process.env.JWT_WORDLIST = path.join(tmp, 'words.txt');
const TOOL = '/opt/tools/jwt_tool';
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });
const VALID_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc';

let cmd, spawnToFile, spawnPrime, toolAvailable, outFiles;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    fs.mkdirSync(path.join(tmp, 'out'), { recursive: true });
    spawnToFile = vi.spyOn(require('../../utils/process.js'), 'safeSpawnToFile');
    spawnPrime = vi.spyOn(require('../../utils/process.js'), 'safeSpawn');
    toolAvailable = vi.spyOn(require('../../utils/tools.js'), 'isToolAvailable');
    let n = 0;
    vi.spyOn(require('../../utils/temp.js'), 'reportFilePath').mockImplementation((label, ext = 'txt') => {
        const f = path.join(tmp, 'out', `${label}_${n++}.${ext}`);
        outFiles.push(f);
        return f;
    });
    cmd = require('../../commands/jwt.js');
});

beforeEach(() => {
    outFiles = [];
    fs.writeFileSync(process.env.JWT_WORDLIST, 'password\n');
    spawnToFile.mockReset();
    spawnPrime.mockReset();
    spawnPrime.mockResolvedValue({ stdout: '', stderr: '', code: 1 });
    spawnToFile.mockRejectedValue(new Error('unstubbed safeSpawnToFile'));
    toolAvailable.mockReset();
    toolAvailable.mockImplementation((candidates) => candidates.includes(TOOL));
});

afterEach(() => vi.useRealTimers());

afterAll(() => {
    cmd.shutdown();
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

// editReply snapshots attachment contents at call time: the command deletes the file 30s later
function makeInteraction(subcommand, options = {}) {
    const i = {
        user: { id: 'u1', tag: 'user#0001' },
        options: {
            getSubcommand: () => subcommand,
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        sentFiles: [],
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (r) => {
            for (const f of r?.files ?? []) i.sentFiles.push({ name: f.name, body: fs.readFileSync(f.attachment, 'utf8') });
        })
    };
    return i;
}

const lastEdit = (i) => i.editReply.mock.calls.at(-1)[0];
const embedOf = (i) => lastEdit(i).embeds[0].data;
const prints = (text) => async (_cmd, _args, out) => {
    fs.writeFileSync(out, text);
    return { stderr: '', code: 0 };
};

describe('bob-jwt input validation', () => {
    it.each(['not-a-jwt', 'a.b', 'a.b.c;id', '$(id).b.c', 'a.b.c d', '-Qj.t.', '-x.y.z'])('rejects token %j without spawning', async (token) => {
        const i = makeInteraction('analyze', { token });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('❌ Invalid JWT Format');
        expect(spawnToFile).not.toHaveBeenCalled();
    });

    it('defers ephemerally because output may contain token data', async () => {
        spawnToFile.mockImplementation(prints('decoded'));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await cmd.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    });

    it('requires a value for tamper modify, without spawning', async () => {
        const i = makeInteraction('tamper', { token: VALID_JWT, action: 'modify', claim: 'sub', secret: 's3cret' });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('❌ Missing Value');
        expect(spawnToFile).not.toHaveBeenCalled();
    });

    it('requires a wordlist for crack, without spawning', async () => {
        fs.rmSync(process.env.JWT_WORDLIST);
        const i = makeInteraction('crack', { token: VALID_JWT });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('❌ Wordlist Not Found');
        expect(spawnToFile).not.toHaveBeenCalled();
    });

    it('reports a missing jwt_tool, without spawning', async () => {
        toolAvailable.mockReturnValue(false);
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await cmd.execute(i);
        expect(embedOf(i).description).toContain('JWT tool not found');
        expect(spawnToFile).not.toHaveBeenCalled();
    });
});

describe('bob-jwt analyze', () => {
    it('shows the decoded token and attaches the full output', async () => {
        spawnToFile.mockImplementation(prints('Header: {"alg":"HS256"}\nPayload: {"sub":"1234567890"}\n'));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await cmd.execute(i);
        expect(lastEdit(i).content).toBe('JWT analyze operation completed successfully.');
        expect(embedOf(i).title).toBe('🔍 JWT Analysis Results');
        expect(embedOf(i).description).toContain('"sub":"1234567890"');
        expect(i.sentFiles).toEqual([{ name: 'jwt-analyze-results.txt', body: 'Header: {"alg":"HS256"}\nPayload: {"sub":"1234567890"}\n' }]);
    });

    it('runs jwt_tool with a throwaway HOME that is removed afterwards', async () => {
        let runHome;
        spawnToFile.mockImplementation(async (_cmd, _args, out, opts) => {
            runHome = opts.env.HOME;
            expect(fs.existsSync(runHome)).toBe(true);
            fs.writeFileSync(out, 'ok');
            return { stderr: '', code: 0 };
        });
        await cmd.execute(makeInteraction('analyze', { token: VALID_JWT }));
        expect(runHome).toContain('jwt-home-');
        expect(runHome).not.toBe(process.env.HOME);
        expect(spawnPrime.mock.calls[0][2].env.HOME).toBe(runHome);
        expect(fs.existsSync(runHome)).toBe(false);
    });

    it('passes the token as a single argv element, with -v only when verbose', async () => {
        spawnToFile.mockImplementation(prints('ok'));
        await cmd.execute(makeInteraction('analyze', { token: VALID_JWT }));
        await cmd.execute(makeInteraction('analyze', { token: VALID_JWT, verbose: true }));
        expect(spawnToFile.mock.calls[0].slice(0, 2)).toEqual([TOOL, [VALID_JWT]]);
        expect(spawnToFile.mock.calls[1][1]).toEqual(['-v', VALID_JWT]);
    });

    it('truncates long output in the embed but keeps it whole in the attachment', async () => {
        const long = 'A'.repeat(3000);
        spawnToFile.mockImplementation(prints(long));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await cmd.execute(i);
        expect(embedOf(i).description.length).toBeLessThan(1100);
        expect(i.sentFiles[0].body).toBe(long);
    });
});

describe('bob-jwt tamper', () => {
    it('sends the secret on stdin and never in argv', async () => {
        spawnToFile.mockImplementation(prints('forged token'));
        const i = makeInteraction('tamper', { token: VALID_JWT, action: 'modify', claim: 'role', value: 'admin user', secret: 'hunter2' });
        await cmd.execute(i);
        const [bin, args, , opts] = spawnToFile.mock.calls[0];
        expect(bin).toBe(TOOL);
        expect(args).toEqual(['-v', VALID_JWT, '-I', '-pc', 'role', '-pv', 'admin user', '-S', 'hs256']);
        expect(args.join(' ')).not.toContain('hunter2');
        expect(opts.input).toBe('hunter2');
        expect(embedOf(i).title).toBe('🛠️ JWT Tampering Results');
        expect(JSON.stringify(lastEdit(i))).not.toContain('hunter2');
    });

    it('removes a claim with -rm and honours the chosen algorithm', async () => {
        spawnToFile.mockImplementation(prints('forged token'));
        await cmd.execute(makeInteraction('tamper', { token: VALID_JWT, action: 'delete', claim: 'exp', secret: 'k', algorithm: 'hs512' }));
        expect(spawnToFile.mock.calls[0][1]).toEqual(['-v', VALID_JWT, '-I', '-rm', 'exp', '-S', 'hs512']);
    });
});

describe('bob-jwt crack', () => {
    it('runs a dictionary attack with the configured wordlist and flags a match', async () => {
        spawnToFile.mockImplementation(prints('[+] MATCH: secret is "password"'));
        const i = makeInteraction('crack', { token: VALID_JWT });
        await cmd.execute(i);
        expect(spawnToFile.mock.calls[0][1]).toEqual(['-v', VALID_JWT, '-C', '-d', process.env.JWT_WORDLIST]);
        expect(embedOf(i).title).toBe('🔓 JWT Cracking Results');
        expect(embedOf(i).fields[0].name).toBe('✅ Success');
    });

    it('adds -b in brute mode and shows no success banner without a match', async () => {
        spawnToFile.mockImplementation(prints('no luck'));
        const i = makeInteraction('crack', { token: VALID_JWT, mode: 'brute' });
        await cmd.execute(i);
        expect(spawnToFile.mock.calls[0][1].at(-1)).toBe('-b');
        expect(embedOf(i).fields).toBeUndefined();
    });
});

describe('bob-jwt failures', () => {
    it('reports empty output as a warning', async () => {
        spawnToFile.mockImplementation(prints('  \n'));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('⚠️ No Output Generated');
    });

    it('tells the user jwt_tool is missing when it fails to start, hiding the underlying error', async () => {
        spawnToFile.mockRejectedValue(coded(`Failed to start process: spawn ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).description).toContain('JWT tool not found');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it('shows a generic message when jwt_tool fails without output, hiding the underlying error', async () => {
        spawnToFile.mockRejectedValue(new Error(`kaboom ${SECRET}`));
        const i = makeInteraction('analyze', { token: VALID_JWT });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).title).toBe('❌ Error');
        expect(embedOf(i).description).toContain('generated no output');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });
    it('tells the user when jwt_tool times out', async () => {
        spawnToFile.mockRejectedValue(coded(`Process timed out after 120 seconds ${SECRET}`, 'ETIMEDOUT'));
        const i = makeInteraction('crack', { token: VALID_JWT });
        await cmd.execute(i);
        expect(embedOf(i).description).toMatch(/timed out/i);
    });
});

describe('bob-jwt cleanup', () => {
    it.each([
        ['a successful run', () => prints('decoded')],
        ['a failed run', () => async (_c, _a, out) => { fs.writeFileSync(out, ''); throw new Error('kaboom'); }]
    ])('removes the output file 30 seconds after %s', async (_n, impl) => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        spawnToFile.mockImplementation(impl());
        await cmd.execute(makeInteraction('analyze', { token: VALID_JWT }));
        expect(fs.existsSync(outFiles[0])).toBe(true);
        await vi.advanceTimersByTimeAsync(30_000);
        vi.useRealTimers();
        await vi.waitFor(() => expect(fs.existsSync(outFiles[0])).toBe(false));
    });
});
