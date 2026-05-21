import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => {
    const mockGet = vi.fn().mockResolvedValue({
        status: 200,
        data: '<html></html>',
        headers: { 'content-type': 'text/html', server: 'nginx' }
    });
    return {
        default: {
            get: mockGet,
            post: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
            head: vi.fn().mockResolvedValue({ status: 200, headers: {} })
        },
        get: mockGet,
        post: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
        head: vi.fn().mockResolvedValue({ status: 200, headers: {} })
    };
});

vi.mock('../../utils/ssrf', () => ({
    validateUrlNotInternal: vi.fn().mockResolvedValue(undefined),
    getSafeAxiosConfig: vi.fn().mockReturnValue({})
}));

// Mock dns to avoid real network lookups
vi.mock('dns', () => ({
    promises: {
        resolve4: vi.fn().mockResolvedValue(['1.2.3.4']),
        reverse: vi.fn().mockResolvedValue(['example.com'])
    }
}));

// Mock tls to avoid real TLS connections
vi.mock('tls', () => ({
    connect: vi.fn().mockImplementation((_opts, cb) => {
        const socket = {
            getPeerCertificate: vi.fn().mockReturnValue(null),
            end: vi.fn(),
            on: vi.fn(),
            setTimeout: vi.fn()
        };
        setTimeout(() => cb && cb(), 0);
        return socket;
    })
}));

function makeInteraction({ options = {}, ...rest } = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        guild: { id: 'g1', name: 'guild' },
        member: { roles: { cache: { some: () => false } } },
        commandName: 'bob-redirect-check',
        options: {
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getAttachment: (k) => options[k] ?? null,
            getSubcommand: () => options.__subcommand ?? null,
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

describe('bob-redirect-check smoke', () => {
    let cmd;

    beforeEach(() => {
        vi.resetModules();
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        cmd = require('../../commands/redirect-chain.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (cmd.shutdown) cmd.shutdown();
    });

    it('module exports data and execute', () => {
        expect(cmd.data).toBeDefined();
        expect(cmd.data.name).toBe('bob-redirect-check');
        expect(typeof cmd.execute).toBe('function');
    });

    it('execute defers and completes with valid URL (no redirect chain)', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: { url: 'https://example.com/' } });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalled();
    });

    it('rejects malformed URL without making network calls', { timeout: 500 }, async () => {
        const { default: axios } = await import('axios');
        const interaction = makeInteraction({ options: { url: 'not-a-url' } });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/valid url|not allowed/i);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects internal/private URL via ssrf guard', { timeout: 500 }, async () => {
        const { validateUrlNotInternal } = await import('../../utils/ssrf');
        validateUrlNotInternal.mockRejectedValueOnce(new Error('Private IP'));
        const interaction = makeInteraction({ options: { url: 'http://192.168.1.1/' } });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/not allowed/i);
    });

    it('handles missing url option gracefully', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: {} });
        await cmd.execute(interaction);
        expect(interaction.editReply.mock.calls.length + interaction.reply.mock.calls.length).toBeGreaterThan(0);
    });
});
