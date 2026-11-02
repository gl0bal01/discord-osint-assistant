import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });
const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit';

let cmd, spawn;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(): spy before the command destructures its imports
    spawn = vi.spyOn(require('../../utils/process.js'), 'safeSpawn');
    cmd = require('../../commands/xeuledoc.js');
});

beforeEach(() => {
    spawn.mockReset();
    spawn.mockRejectedValue(new Error('unstubbed safeSpawn'));
});

afterAll(() => vi.restoreAllMocks());

function makeInteraction(link) {
    return {
        options: { getString: (k) => (k === 'link' ? link : null) },
        deferReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

const embedOf = (i) => (i.editReply.mock.calls.at(-1) ?? i.reply.mock.calls.at(-1))[0].embeds[0].data;

const OUTPUT = [
    'Document ID : 1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    '',
    '[+] Creation date : 2023/04/05 10:11:12 (UTC)',
    '[+] Last edit date : 2024/01/02 03:04:05 (UTC)',
    '',
    'Public permissions :',
    '- reader',
    '',
    '[+] Owner found !',
    'Name : John Doe',
    'Email : johndoe@gmail.com',
    ''
].join('\n');

describe('bob-xeuledoc input validation', () => {
    it.each([
        ['not a url', /valid URL/],
        ['http://docs.google.com/document/d/1/edit', /valid Google resource link/],
        ['https://evil.example/docs.google.com', /valid Google resource link/],
        ['https://docs.google.com.evil.example/document/d/1/edit', /valid Google resource link/],
        ['file:///etc/passwd', /valid Google resource link/]
    ])('rejects %j without spawning', async (link, message) => {
        const i = makeInteraction(link);
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('Invalid Link');
        expect(embedOf(i).description).toMatch(message);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
    });
});

describe('bob-xeuledoc run', () => {
    it('shows xeuledoc output in a code block', async () => {
        spawn.mockResolvedValue({ stdout: OUTPUT, stderr: '', code: 0 });
        const i = makeInteraction(DOC);
        await cmd.execute(i);
        expect(i.deferReply).toHaveBeenCalled();
        expect(embedOf(i).title).toBe('xeuledoc Output');
        expect(embedOf(i).description).toBe(`\`\`\`\n${OUTPUT}\n\`\`\``);
    });

    it('passes the link as the only argv element, with the 60s timeout', async () => {
        spawn.mockResolvedValue({ stdout: OUTPUT, stderr: '', code: 0 });
        await cmd.execute(makeInteraction(DOC));
        expect(spawn).toHaveBeenCalledWith('xeuledoc', [DOC], { timeout: 60000 });
    });

    it('keeps shell metacharacters inside one URL-encoded argv element', async () => {
        spawn.mockResolvedValue({ stdout: OUTPUT, stderr: '', code: 0 });
        await cmd.execute(makeInteraction('https://docs.google.com/document/d/1/edit $(id) ; rm -rf /'));
        const args = spawn.mock.calls[0][1];
        expect(args).toHaveLength(1);
        expect(args[0]).not.toMatch(/\s/);
        expect(args[0].startsWith('https://docs.google.com/')).toBe(true);
    });
    it('still shows output when xeuledoc prints more than an embed can hold', async () => {
        spawn.mockResolvedValue({ stdout: 'x'.repeat(5000), stderr: '', code: 0 });
        const i = makeInteraction(DOC);
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('xeuledoc Output');
    });
});

describe('bob-xeuledoc failures', () => {
    it('reports a non-zero exit without leaking stderr', async () => {
        spawn.mockResolvedValue({ stdout: '', stderr: `Traceback ${SECRET}`, code: 1 });
        const i = makeInteraction(DOC);
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).title).toBe('Command Error');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it('tells the user the tool is missing, without the underlying message', async () => {
        spawn.mockRejectedValue(coded(`Failed to start process: spawn xeuledoc ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction(DOC);
        await cmd.execute(i);
        expect(embedOf(i).title).toBe('Execution Error');
        expect(embedOf(i).description).toContain('not installed');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });

    it.each([
        ['timeout', `Process timed out after 60 seconds ${SECRET}`],
        ['other failure', `kaboom ${SECRET}`]
    ])('shows a generic message on %s', async (_n, message) => {
        spawn.mockRejectedValue(new Error(message));
        const i = makeInteraction(DOC);
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(embedOf(i).description).toContain('unexpected error');
        expect(JSON.stringify(embedOf(i))).not.toContain(SECRET);
    });
});
