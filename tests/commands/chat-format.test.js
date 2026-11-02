import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

let chat;
let axios;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(), so spy on the shared axios instance
    axios = require('axios');
    chat = require('../../commands/chat.js');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});
afterAll(() => chat.shutdown());

describe('formatCodeReply', () => {
    const f = (s) => chat.formatCodeReply(s);

    it('converts a real CODE_GENERATOR reply to a Discord code block', () => {
        const reply = '<thinking>A single function has nothing to preview.</thinking>\n' +
            '<artifact identifier="add" type="application/code" language="javascript" title="add">\n' +
            'function add(a, b) {\n  return a + b;\n}\n</artifact>\nIt returns a + b.';
        expect(f(reply)).toBe('```javascript\nfunction add(a, b) {\n  return a + b;\n}\n```\nIt returns a + b.');
    });

    it('converts several artifacts and keeps prose between them', () => {
        expect(f('<artifact language="py">\nprint(1)\n</artifact>\nand\n<artifact language="go">x</artifact>'))
            .toBe('```py\nprint(1)\n```\nand\n```go\nx\n```');
    });

    it('leaves text without tags untouched, indentation included', () => {
        expect(f('    indented\nnext')).toBe('    indented\nnext');
    });

    it('drops every reasoning block, wherever it is', () => {
        expect(f('Sure.\n<thinking>r</thinking>\n<artifact language="js">x</artifact>')).toBe('Sure.\n```js\nx\n```');
        expect(f('<thinking type="x">r</thinking>ok <thinking>s</thinking>\n\ndone')).toBe('ok done');
    });

    it('matches whole tag names only', () => {
        expect(f('<thinking_notes>keep</thinking_notes> and <thinking>a</thinking>b'))
            .toBe('<thinking_notes>keep</thinking_notes> and b');
        expect(f('<artifacts><artifact language="js">x</artifact></artifacts>')).toBe('<artifacts>```js\nx\n```</artifacts>');
    });

    it('handles ">" inside quoted attributes', () => {
        expect(f('<artifact title="a > b" language="js">x</artifact>')).toBe('```js\nx\n```');
    });

    it('treats tags inside an artifact as code', () => {
        expect(f('<artifact language="js">\nconst t = "<thinking>x</thinking><artifact id=1>";\n</artifact>'))
            .toBe('```js\nconst t = "<thinking>x</thinking><artifact id=1>";\n```');
    });

    it('keeps prose that mentions the closing tag outside the code block', () => {
        expect(f('<artifact language="xml">x</artifact>\nClose tags with </artifact>.'))
            .toBe('```xml\nx\n```\nClose tags with </artifact>.');
    });

    it('keeps the code when reasoning is never closed', () => {
        expect(f('<thinking>plan\n<artifact language="py">print(1)</artifact>\nDone.')).toBe('```py\nprint(1)\n```\nDone.');
    });

    it('handles cut-off replies', () => {
        expect(f('<thinking>reasoning cut off')).toBe('');
        expect(f('Use <thinking> tags')).toBe('Use <thinking> tags');
        expect(f('see <artifact language="js">\ncode cut')).toBe('see <artifact language="js">\ncode cut');
    });

    it('stays linear-time on hostile output', () => {
        const n = 50000;
        const started = Date.now();
        f('<artifact a>'.repeat(n) + '<artifactX'.repeat(n) + '</artifact>' + '<thinking>'.repeat(n));
        f('<thinking>' + '<artifact a>'.repeat(n));
        f('<artifact "'.repeat(n) + '<thinking>x</thinking>'.repeat(n));
        f('<thinking>x</thinking><artifact>y</artifact>'.repeat(n));
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe('1min.ai error replies', () => {
    it('shows out-of-credits instead of raw JSON when the error arrives with a 2xx status', async () => {
        vi.stubEnv('AI_API_KEY', 'test-api-key');
        vi.spyOn(axios, 'post')
            .mockResolvedValueOnce({ data: { conversation: { uuid: 'c1' } } })
            .mockResolvedValueOnce({ data: { aiRecord: { aiRecordDetail: { resultObject: { code: 'INSUFFICIENT_CREDITS' } } } } })
            .mockRejectedValue(new Error('unexpected axios call')); // never reach the real API
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const editReply = vi.fn();
        await chat.execute({
            user: { id: 'credits-user' },
            options: {
                getSubcommand: () => 'ask',
                getString: (k) => (k === 'message' ? 'hi' : null),
                getBoolean: () => null
            },
            deferReply: vi.fn(),
            editReply
        });
        const content = editReply.mock.calls.at(-1)[0].content;
        expect(content).toMatch(/out of credits/i);
        expect(content).not.toContain('INSUFFICIENT_CREDITS');
    });
});
