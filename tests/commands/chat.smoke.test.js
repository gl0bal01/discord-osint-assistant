import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => {
    const mockPost = vi.fn().mockResolvedValue({
        status: 200,
        data: {
            aiRecord: {
                aiRecordDetail: {
                    resultObject: 'Mocked AI response text'
                }
            }
        },
        headers: {}
    });
    const mockGet = vi.fn().mockResolvedValue({ status: 200, data: '', headers: {} });
    return {
        default: { get: mockGet, post: mockPost, head: vi.fn() },
        get: mockGet,
        post: mockPost,
        head: vi.fn()
    };
});

vi.mock('../../utils/ssrf', () => ({
    validateUrlNotInternal: vi.fn().mockResolvedValue(undefined),
    getSafeAxiosConfig: vi.fn().mockReturnValue({})
}));

function makeInteraction({ options = {}, ...rest } = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        guild: { id: 'g1', name: 'guild' },
        member: { roles: { cache: { some: () => false } } },
        commandName: 'bob-chat',
        options: {
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getAttachment: (k) => options[k] ?? null,
            getSubcommand: () => options.__subcommand ?? 'ask',
            ...(options.__optionsExtra ?? {})
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        replied: false,
        deferred: false,
        ...rest
    };
}

describe('bob-chat smoke', () => {
    let cmd;

    beforeEach(() => {
        vi.resetModules();
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        process.env.AI_API_KEY = 'test-api-key';
        cmd = require('../../commands/chat.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (cmd.shutdown) cmd.shutdown();
    });

    it('module exports data and execute', () => {
        expect(cmd.data).toBeDefined();
        expect(cmd.data.name).toBe('bob-chat');
        expect(typeof cmd.execute).toBe('function');
    });

    it('execute defers reply on ask subcommand with message', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: { __subcommand: 'ask', message: 'Hello AI' }
        });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
    });

    it('returns error when AI_API_KEY is missing', { timeout: 500 }, async () => {
        delete process.env.AI_API_KEY;
        const interaction = makeInteraction({
            options: { __subcommand: 'ask', message: 'Hello AI' }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/api key|configuration/i);
    });

    it('reset subcommand clears context and replies', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: { __subcommand: 'reset', model: 'all' }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/reset/i);
    });

    it('handles transcribe subcommand requiring language for phone_call', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: {
                __subcommand: 'transcribe',
                'audio-url': '/uploads/test.mp3',
                'stt-model': 'phone_call'
                // language intentionally omitted
            }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/language/i);
    });
});
