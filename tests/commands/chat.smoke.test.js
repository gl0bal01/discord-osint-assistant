import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';

// Offline by construction: vi.mock cannot intercept require() inside the CJS command, so the
// shared axios instance is spied on instead (chat.js calls axios.post at call time).
let cmd;
let axios;
let post;
let n = 0;

const API_KEY = 'sk-test-chat-key';

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    cmd = require('../../commands/chat.js');
});

afterAll(() => cmd.shutdown());

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

// A fresh user id per interaction keeps the module-level conversation map from leaking between tests
function makeInteraction(options = {}, userId = `chat-user-${++n}`) {
    return {
        user: { id: userId },
        options: {
            getSubcommand: () => options.__subcommand,
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

// Every call rejects unless queued, so an unexpected request fails the test instead of reaching 1min.ai
function stubAxios(responses = []) {
    post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
    for (const r of responses) {
        if (r instanceof Error || r?.__reject) post.mockRejectedValueOnce(r instanceof Error ? r : r.__reject);
        else post.mockResolvedValueOnce(r);
    }
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

const conv = (uuid = 'conv-1') => ({ data: { conversation: { uuid } } });
const reply = (result) => ({ data: { aiRecord: { aiRecordDetail: { resultObject: result } } } });
const httpError = (status, data = {}) =>
    Object.assign(new Error(`Request failed with status code ${status} (key ${API_KEY})`), { response: { status, data } });

async function run(options, responses, userId) {
    vi.stubEnv('AI_API_KEY', API_KEY);
    stubAxios(responses);
    const interaction = makeInteraction(options, userId);
    await expect(cmd.execute(interaction)).resolves.not.toThrow();
    return { interaction, last: interaction.editReply.mock.calls.at(-1)[0] };
}

const SUBCOMMANDS = {
    ask: { __subcommand: 'ask', message: 'who owns example.com?' },
    code: { __subcommand: 'code', request: 'parse whois output' },
    analyze: { __subcommand: 'analyze', data: 'ip,host\n1.2.3.4,a' },
    transcribe: { __subcommand: 'transcribe', 'audio-url': 'audio/call.mp3' }
};

describe('bob-chat module', () => {
    it('exports the five subcommands under /bob-chat', () => {
        expect(cmd.data.name).toBe('bob-chat');
        expect(cmd.data.toJSON().options.map((o) => o.name)).toEqual(['ask', 'code', 'analyze', 'transcribe', 'reset']);
    });
});

describe('bob-chat configuration', () => {
    it('refuses to run without AI_API_KEY and makes no request', async () => {
        vi.stubEnv('AI_API_KEY', '');
        stubAxios();
        const interaction = makeInteraction(SUBCOMMANDS.ask);
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(interaction.editReply.mock.calls[0][0].content).toMatch(/Configuration Error/);
        expect(post).not.toHaveBeenCalled();
    });
});

describe('bob-chat ask', () => {
    it('creates a conversation, sends the contextualized prompt and shows the model reply', async () => {
        const { last } = await run({ ...SUBCOMMANDS.ask, context: 'osint' }, [conv('c-ask'), reply(['The owner is X.'])]);
        expect(last.content).toBe('🤖 **Chat Response from Claude Haiku 5.5**\n\nThe owner is X.');

        const [createUrl, createBody, createCfg] = post.mock.calls[0];
        expect(createUrl).toBe('https://api.1min.ai/api/conversations');
        expect(createBody).toMatchObject({ type: 'UNIFY_CHAT_WITH_AI', model: 'us.anthropic.claude-haiku-5-5' });
        expect(createCfg.headers['API-KEY']).toBe(API_KEY);

        const [chatUrl, chatBody] = post.mock.calls[1];
        expect(chatUrl).toBe('https://api.1min.ai/api/chat-with-ai');
        expect(chatBody.promptObject).toMatchObject({
            prompt: 'As an OSINT analysis expert, please help with: who owns example.com?',
            conversationId: 'c-ask'
        });
    });

    it('reuses the conversation on a second question from the same user', async () => {
        vi.stubEnv('AI_API_KEY', API_KEY);
        stubAxios([conv('c-keep'), reply('one'), reply('two')]);
        const first = makeInteraction(SUBCOMMANDS.ask, 'same-user');
        const second = makeInteraction(SUBCOMMANDS.ask, 'same-user');
        await cmd.execute(first);
        await cmd.execute(second);
        expect(post.mock.calls.filter(([url]) => url.endsWith('/conversations'))).toHaveLength(1);
        expect(post.mock.calls[2][1].promptObject.conversationId).toBe('c-keep');
        expect(second.editReply.mock.calls[0][0].content).toContain('two');
    });

    it('enables web search for Perplexity Sonar models', async () => {
        await run({ ...SUBCOMMANDS.ask, model: 'sonar-pro' }, [conv(), reply('web answer')]);
        expect(post.mock.calls[1][1].promptObject.settings.webSearchSettings).toMatchObject({ webSearch: true });
    });

    it('neutralizes @everyone, @here and role pings in the model reply', async () => {
        const { last } = await run(SUBCOMMANDS.ask, [conv(), reply('@everyone @here <@&123456> hi')]);
        expect(last.content).not.toMatch(/@everyone|@here|<@&/i);
        expect(last.content).toContain('hi');
    });

    it('attaches long replies as a file and neutralizes mentions in the preview', async () => {
        const { last } = await run(SUBCOMMANDS.ask, [conv(), reply('@everyone ' + 'x'.repeat(3000))]);
        expect(last.content).toContain('Response too long for Discord message');
        expect(last.content).not.toMatch(/@everyone/i);
        expect(last.content.length).toBeLessThan(1000);
        expect(last.files).toHaveLength(1);
        expect(last.files[0].name).toMatch(/^ai_response_chat_response_\d+\.txt$/);
    });
});

describe('bob-chat code', () => {
    it('turns 1min.ai artifacts into Discord code blocks', async () => {
        const body = '<thinking>plan</thinking>\n<artifact language="python">\nprint(1)\n</artifact>\nDone.';
        const { last } = await run(SUBCOMMANDS.code, [conv('c-code'), reply([body])]);
        expect(last.content).toBe('🤖 **Code Generation from Claude Sonnet 5.5**\n\n```python\nprint(1)\n```\nDone.');
        expect(post.mock.calls[0][1].type).toBe('CODE_GENERATOR');
        expect(post.mock.calls[1][0]).toBe('https://api.1min.ai/api/features');
        expect(post.mock.calls[1][1].promptObject.prompt).toContain('generate python code');
    });

    it('starts a new conversation when new-context is set', async () => {
        vi.stubEnv('AI_API_KEY', API_KEY);
        stubAxios([conv('a'), reply('1'), conv('b'), reply('2')]);
        const opts = { ...SUBCOMMANDS.code, 'new-context': true };
        await cmd.execute(makeInteraction(opts, 'code-user'));
        await cmd.execute(makeInteraction(opts, 'code-user'));
        expect(post.mock.calls.filter(([url]) => url.endsWith('/conversations'))).toHaveLength(2);
    });
});

describe('bob-chat analyze', () => {
    it('sends the data inside the analysis prompt and labels the reply', async () => {
        const { last } = await run({ ...SUBCOMMANDS.analyze, 'analysis-type': 'threat' }, [conv(), reply('Looks benign.')]);
        expect(last.content).toBe('🤖 **OSINT Analysis from Claude Sonnet 5.5**\n\nLooks benign.');
        const prompt = post.mock.calls[1][1].promptObject.prompt;
        expect(prompt).toContain('assess the threat level');
        expect(prompt).toContain('1.2.3.4,a');
    });
});

describe('bob-chat transcribe', () => {
    it('posts a Qwen3 job and shows the transcript', async () => {
        const { last } = await run({ ...SUBCOMMANDS.transcribe, language: 'EN', 'enable-itn': true }, [reply(['hello world'])]);
        expect(last.content).toBe('🤖 **Speech to Text from qwen3-asr-flash**\n\nhello world');
        expect(post.mock.calls[0][1]).toEqual({
            type: 'SPEECH_TO_TEXT',
            model: 'qwen3-asr-flash',
            promptObject: { audioUrl: 'audio/call.mp3', enable_itn: true, language: 'en' }
        });
    });

    it('posts a phone-call job when the language code is valid', async () => {
        const { last } = await run({ ...SUBCOMMANDS.transcribe, 'stt-model': 'phone_call', language: 'en-US' }, [reply('hi')]);
        expect(post.mock.calls[0][1].promptObject).toEqual({ audioUrl: 'audio/call.mp3', language: 'en-US' });
        expect(last.content).toContain('Phone Call Speech to Text');
    });

    it.each([
        ['phone_call without a language', { 'stt-model': 'phone_call' }, /Missing Language Code/],
        ['phone_call with a bare language', { 'stt-model': 'phone_call', language: 'en' }, /Invalid Phone Call Language Code/],
        ['qwen3 with an unsupported language', { language: 'xx' }, /Invalid Qwen3 Language Code/]
    ])('rejects %s without calling the API', async (_label, extra, pattern) => {
        const { last } = await run({ ...SUBCOMMANDS.transcribe, ...extra }, []);
        expect(last.content).toMatch(pattern);
        expect(post).not.toHaveBeenCalled();
    });

    it('neutralizes mentions when echoing a rejected language code', async () => {
        const { last } = await run({ ...SUBCOMMANDS.transcribe, 'stt-model': 'phone_call', language: '@everyone' }, []);
        expect(last.content).toMatch(/Invalid Phone Call Language Code/);
        expect(last.content).not.toMatch(/@everyone/i);
    });
});

describe('bob-chat reset', () => {
    it('reports zero cleared contexts for a user with none', async () => {
        const { last } = await run({ __subcommand: 'reset' }, []);
        expect(last.content).toContain('Context Reset Complete');
        expect(last.content).toContain('**Cleared:** 0 conversation context(s)');
    });

    it('clears all contexts and the next question starts a new conversation', async () => {
        vi.stubEnv('AI_API_KEY', API_KEY);
        stubAxios([conv('c1'), reply('a'), conv('c2'), reply('b')]);
        await cmd.execute(makeInteraction(SUBCOMMANDS.ask, 'reset-user'));
        const reset = makeInteraction({ __subcommand: 'reset', model: 'all' }, 'reset-user');
        await cmd.execute(reset);
        expect(reset.editReply.mock.calls[0][0].content).toContain('**Cleared:** 1 conversation context(s)');
        expect(reset.editReply.mock.calls[0][0].content).toContain('All contexts');
        await cmd.execute(makeInteraction(SUBCOMMANDS.ask, 'reset-user'));
        expect(post.mock.calls.filter(([url]) => url.endsWith('/conversations'))).toHaveLength(2);
    });

    it('clears only chat contexts when asked to', async () => {
        vi.stubEnv('AI_API_KEY', API_KEY);
        stubAxios([conv('c1'), reply('a'), conv('k1'), reply('b')]);
        await cmd.execute(makeInteraction(SUBCOMMANDS.ask, 'partial-user'));
        await cmd.execute(makeInteraction(SUBCOMMANDS.code, 'partial-user'));
        const chatReset = makeInteraction({ __subcommand: 'reset', model: 'chat' }, 'partial-user');
        await cmd.execute(chatReset);
        expect(chatReset.editReply.mock.calls[0][0].content).toContain('**Cleared:** 1');
        const codeReset = makeInteraction({ __subcommand: 'reset', model: 'code' }, 'partial-user');
        await cmd.execute(codeReset);
        expect(codeReset.editReply.mock.calls[0][0].content).toContain('**Cleared:** 1');
    });
});

describe('bob-chat upstream errors', () => {
    const failFirstPost = (error) => [{ __reject: error }];

    // the first POST fails: the conversation step, or the job itself for transcribe
    it.each(Object.keys(SUBCOMMANDS))('%s: 401 API_KEY_INACTIVE shows an authentication error only', async (name) => {
        const { last } = await run(SUBCOMMANDS[name], failFirstPost(httpError(401, { errorCode: 'API_KEY_INACTIVE' })));
        const label = name[0].toUpperCase() + name.slice(1);
        expect(last.content).toContain(`❌ **AI ${label} Failed**`);
        expect(last.content).toContain('Authentication Error');
        expect(last.content).not.toMatch(/API_KEY_INACTIVE|Request failed|sk-test/);
    });

    it.each(Object.keys(SUBCOMMANDS))('%s: INSUFFICIENT_CREDITS in an HTTP error shows out-of-credits', async (name) => {
        const { last } = await run(SUBCOMMANDS[name], failFirstPost(httpError(402, { errorCode: 'INSUFFICIENT_CREDITS' })));
        expect(last.content).toContain('Out of Credits');
        expect(last.content).not.toContain('INSUFFICIENT_CREDITS');
    });

    it.each(Object.keys(SUBCOMMANDS))('%s: INSUFFICIENT_CREDITS in a 2xx body shows out-of-credits', async (name) => {
        const body = { data: { aiRecord: { aiRecordDetail: { resultObject: { code: 'INSUFFICIENT_CREDITS' } } } } };
        const responses = name === 'transcribe' ? [body] : [conv(), body];
        const { last } = await run(SUBCOMMANDS[name], responses);
        expect(last.content).toContain('Out of Credits');
        expect(last.content).not.toContain('INSUFFICIENT_CREDITS');
    });

    it.each([
        [403, /Authentication Error/],
        [429, /Rate Limit Exceeded/],
        [500, /Service Unavailable/],
        [503, /Service Unavailable/],
        [418, /API Error \(418\)/]
    ])('maps HTTP %i to a readable message without the raw error', async (status, pattern) => {
        const { last } = await run(SUBCOMMANDS.ask, failFirstPost(httpError(status, { message: 'internal detail' })));
        expect(last.content).toMatch(pattern);
        expect(last.content).not.toMatch(/Request failed|internal detail|sk-test/);
    });

    it.each([
        ['ECONNABORTED', /Timeout Error/],
        ['ENOTFOUND', /Network Error/],
        ['ECONNREFUSED', /Network Error/]
    ])('maps %s to a readable message', async (code, pattern) => {
        const { last } = await run(SUBCOMMANDS.ask, failFirstPost(Object.assign(new Error('x'), { code })));
        expect(last.content).toMatch(pattern);
    });

    it('hides unexpected errors behind a generic message', async () => {
        const { last } = await run(SUBCOMMANDS.ask, failFirstPost(new Error(`boom at 10.0.0.9 key=${API_KEY}`)));
        expect(last.content).toContain('Unexpected Error');
        expect(last.content).not.toMatch(/boom|10\.0\.0\.9|sk-test/);
    });

    it('treats an empty model reply as an unexpected error', async () => {
        const { last } = await run(SUBCOMMANDS.ask, [conv(), reply([])]);
        expect(last.content).toContain('Unexpected Error');
    });

    it('does not retry or call any other endpoint after a failure', async () => {
        await run(SUBCOMMANDS.ask, failFirstPost(httpError(500)));
        expect(post).toHaveBeenCalledTimes(1);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('sets ephemeral flags on error replies', async () => {
        const { last } = await run(SUBCOMMANDS.ask, failFirstPost(httpError(500)));
        expect(last.flags).toBe(MessageFlags.Ephemeral);
    });
});
