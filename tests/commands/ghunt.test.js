import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageFlags } from 'discord.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghunt-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
const credsPath = path.join(tmp, 'creds', 'creds.m');
const GOOD_CREDS = Buffer.from(JSON.stringify({ cookies: { SID: 'x' } })).toString('base64');
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });
const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012/view';

let cmd, spawn, outDirs;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    process.env.GHUNT_CREDS_PATH = credsPath;
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
    cmd = require('../../commands/ghunt.js');
});

beforeEach(() => {
    outDirs.length = 0;
    fs.mkdirSync(path.dirname(credsPath), { recursive: true });
    fs.writeFileSync(credsPath, GOOD_CREDS);
    spawn.mockReset();
    spawn.mockRejectedValue(new Error('unstubbed safeSpawn'));
});

afterEach(() => vi.useRealTimers());

afterAll(() => {
    delete process.env.GHUNT_CREDS_PATH;
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

// editReply snapshots attachment contents at call time: the command deletes its dir later
function makeInteraction(options = {}) {
    const i = {
        user: { id: 'u1', username: 'user', tag: 'user#0001' },
        memberPermissions: { has: () => true },
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        sentFiles: [],
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (r) => {
            for (const f of r?.files ?? []) i.sentFiles.push({ name: f.name, body: fs.readFileSync(f.attachment, 'utf8') });
        })
    };
    return i;
}

const lastEdit = (i) => i.editReply.mock.calls.at(-1)[0];
const embedOf = (i) => lastEdit(i).embeds[0].data;
const field = (i, name) => embedOf(i).fields.find((f) => f.name === name);
const jsonArg = (args) => args[args.indexOf('--json') + 1];
const writesJson = (obj) => async (_cmd, args) => {
    fs.writeFileSync(jsonArg(args), JSON.stringify(obj));
    return { stdout: '', stderr: '', code: 0 };
};

describe('bob-ghunt check-login', () => {
    it('reports a valid session', async () => {
        const i = makeInteraction({ type: 'check-login' });
        await cmd.execute(i);
        const reply = i.reply.mock.calls[0][0];
        expect(reply.embeds[0].data.title).toBe('GHunt Login Status');
        expect(reply.embeds[0].data.description).toContain('Logged In');
        expect(reply.flags).toBe(MessageFlags.Ephemeral);
    });

    it('reports missing credentials', async () => {
        fs.rmSync(credsPath);
        const i = makeInteraction({ type: 'check-login' });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.description).toContain('Not Logged In');
    });

    it('reports a credentials file without usable cookies', async () => {
        fs.writeFileSync(credsPath, Buffer.from(JSON.stringify({ cookies: {} })).toString('base64'));
        const i = makeInteraction({ type: 'check-login' });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.description).toContain('Invalid');
    });
});

describe('bob-ghunt input validation', () => {
    it.each([
        ['email', 'not-an-email', /valid email/],
        ['email', null, /valid email/],
        ['drive', 'not a url', /valid Google Drive URL/],
        ['geolocate', 'ZZ:ZZ', /valid BSSID/],
        ['geolocate', 'AA:BB:CC:DD:EE', /valid BSSID/],
        ['gaia', null, /`query` field/],
        ['spiderdal', null, /`query` field/],
        ['bogus', 'x', /Invalid search type/]
    ])('rejects type=%s query=%j without spawning', async (type, query, message) => {
        const i = makeInteraction({ type, query });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].content).toMatch(message);
        expect(i.reply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
    });
    it('rejects a non-numeric Gaia ID', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'gaia', query: 'abc' });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/numeric Gaia ID/);
        expect(spawn).not.toHaveBeenCalled();
    });

    it('asks the user to log in, without spawning, when no credentials exist', async () => {
        fs.rmSync(credsPath);
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].content).toContain('GHunt Not Authenticated');
        expect(spawn).not.toHaveBeenCalled();
    });
});

describe('bob-ghunt searches', () => {
    it('email lookup links the profile and attaches JSON and HTML reports', async () => {
        spawn.mockImplementation(writesJson({ personId: '1234567890' }));
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(i.deferReply).toHaveBeenCalled();
        expect(embedOf(i).title).toBe('Email Lookup Results');
        expect(field(i, 'Gmail OSINT Tool').value).toContain('gmail-osint.activetk.jp/john');
        expect(field(i, 'Google Maps Reviews').value).toContain('/maps/contrib/1234567890/reviews');
        expect(i.sentFiles).toHaveLength(2);
        expect(i.sentFiles[0].name).toMatch(/^email_john@gmail\.com_\d+\.json$/);
        expect(JSON.parse(i.sentFiles[0].body)).toEqual({ personId: '1234567890' });
        expect(i.sentFiles[1].name).toMatch(/^GHunt_Report_email_\d+\.html$/);
        expect(i.sentFiles[1].body).toContain('GHunt OSINT Report');
    });

    it('email lookup passes the optional flags to ghunt', async () => {
        spawn.mockImplementation(writesJson({}));
        await cmd.execute(makeInteraction({ type: 'email', query: 'john@example.org', driver: true, sight: true }));
        const [bin, args, opts] = spawn.mock.calls[0];
        expect(bin).toBe('ghunt');
        expect(args).toEqual(['email', '--json', expect.stringMatching(/email_john@example\.org_\d+\.json$/), '--driver', '--sight', '--', 'john@example.org']);
        expect(opts.timeout).toBe(120_000);
    });

    it('email lookup searches the exact address, as one argv element after --', async () => {
        spawn.mockImplementation(writesJson({}));
        await cmd.execute(makeInteraction({ type: 'email', query: '-a+b-c@example.org' }));
        expect(spawn.mock.calls[0][1].slice(-2)).toEqual(['--', '-a+b-c@example.org']);
        expect(spawn.mock.calls[0][1][2]).toMatch(/email__a_b_c@example\.org_\d+\.json$/);
    });

    it('email lookup URL-encodes the address in markdown links', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'email', query: 'a)[x](https://evil.example@example.org' });
        await cmd.execute(i);
        const values = embedOf(i).fields.map((f) => f.value).join('\n');
        expect(values).not.toContain('evil.example@');
        expect(values).not.toMatch(/\)\[/);
        expect(values).toContain('https://epieos.com/?q=a%29%5Bx%5D%28https%3A%2F%2Fevil.example%40example.org');
    });

    it('gaia lookup sends only the numeric ID', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'gaia', query: '108123456789012345678' });
        await cmd.execute(i);
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['gaia', '108123456789012345678']);
        expect(embedOf(i).title).toBe('Gaia ID Lookup Results');
    });

    it('drive analysis passes the URL as one argv element', async () => {
        spawn.mockImplementation(writesJson({}));
        await cmd.execute(makeInteraction({ type: 'drive', query: DRIVE }));
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['drive', DRIVE]);
    });
    it('drive analysis attaches the results', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'drive', query: DRIVE });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('Google Drive Analysis');
        expect(i.sentFiles[0].name).toMatch(/^drive_1AbCdEfGhIjKlMnOpQrStUvWxYz012_\d+\.json$/);
    });

    it('geolocate accepts a colon-separated BSSID', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'geolocate', query: 'AA:BB:CC:DD:EE:FF' });
        await cmd.execute(i);
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['geolocate', 'AA:BB:CC:DD:EE:FF']);
        expect(embedOf(i).title).toBe('BSSID Geolocation Results');
    });

    it('spiderdal strips everything but domain characters from the argument', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'spiderdal', query: 'exa mple.com;id' });
        await cmd.execute(i);
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['spiderdal', '-u']);
        expect(spawn.mock.calls[0][1][2]).toBe('example.comid');
        expect(spawn.mock.calls[0][1][3]).toBe('--json');
        expect(embedOf(i).title).toBe('Digital Asset Links Analysis');
    });

    it('spiderdal strips a leading dash or dot and rejects an all-dash query', async () => {
        spawn.mockImplementation(writesJson({}));
        await cmd.execute(makeInteraction({ type: 'spiderdal', query: '--help.example.com' }));
        expect(spawn.mock.calls[0][1][2]).toBe('help.example.com');
        const i = makeInteraction({ type: 'spiderdal', query: '-.-' });
        await cmd.execute(i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/domain/);
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('gaia embed never carries the raw query into markdown links', async () => {
        spawn.mockImplementation(writesJson({}));
        const i = makeInteraction({ type: 'gaia', query: '1)[Re-login](https://evil.example' });
        await cmd.execute(i);
        expect(JSON.stringify(embedOf(i))).not.toContain('evil');
        expect(embedOf(i).fields[0].value).toBe('[View Reviews](https://www.google.com/maps/contrib/1/reviews)');
    });

    it('says so, without attachments, when ghunt wrote no output', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(field(i, 'GHunt Results').value).toBe('GHunt executed but no results were found.');
        expect(lastEdit(i).files).toBeUndefined();
    });
});

describe('bob-ghunt failures', () => {
    it('tells the user the tool is missing, without the underlying message', async () => {
        spawn.mockRejectedValue(coded(`Failed to start process: spawn ghunt ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(field(i, 'GHunt Error').value).toContain('not installed');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it.each([
        ['timeout', `Process timed out after 120 seconds ${SECRET}`],
        ['other failure', `kaboom ${SECRET}`]
    ])('shows a generic message on %s', async (_n, message) => {
        spawn.mockRejectedValue(new Error(message));
        const i = makeInteraction({ type: 'gaia', query: '123' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(field(i, 'GHunt Error').value).toContain('Error running GHunt');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it('reports an authentication failure without echoing stderr', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: `401 Unauthorized ${SECRET}`, code: 1 });
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).title).toBe('Authentication Failed');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });
    it('reports an authentication failure when ghunt exits non-zero complaining about credentials', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: 'Your credentials are invalid or expired', code: 1 });
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('Authentication Failed');
    });
});

describe('bob-ghunt non-zero exit', () => {
    it('replies with a generic failure, not "no results", when ghunt fails for a non-auth reason', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: `something else broke ${SECRET}`, code: 1 });
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(field(i, 'GHunt Error').value).toBe('GHunt failed. Check server logs.');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
        expect(lastEdit(i).files).toBeUndefined();
    });

    it('detects an auth failure reported on stdout', async () => {
        spawn.mockResolvedValue({ stdout: 'Session expired, run ghunt login', stderr: '', code: 1 });
        const i = makeInteraction({ type: 'email', query: 'john@gmail.com' });
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('Authentication Failed');
    });
});

describe('bob-ghunt cleanup', () => {
    it.each([
        ['a successful run', () => writesJson({ personId: '1' })],
        ['a failed run', () => async () => { throw new Error('kaboom'); }]
    ])('removes the results directory 30 seconds after %s', async (_n, impl) => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        spawn.mockImplementation(impl());
        await cmd.execute(makeInteraction({ type: 'email', query: 'john@gmail.com' }));
        expect(fs.existsSync(outDirs[0])).toBe(true);
        await vi.advanceTimersByTimeAsync(30_000);
        vi.useRealTimers();
        await vi.waitFor(() => expect(fs.existsSync(outDirs[0])).toBe(false));
    });
});
