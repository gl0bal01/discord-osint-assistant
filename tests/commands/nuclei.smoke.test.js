import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/process', () => ({
    safeSpawn: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
    safeSpawnToFile: vi.fn().mockResolvedValue({ stderr: '', code: 0 }),
    getSafeEnv: vi.fn().mockReturnValue({})
}));

// Mock fs.promises so readFile returns empty (no output file) by default
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            mkdir: vi.fn().mockResolvedValue(undefined),
            readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
            stat: vi.fn().mockResolvedValue({ size: 100 }),
            unlink: vi.fn().mockResolvedValue(undefined)
        }
    };
});

function makeInteraction({ options = {}, ...rest } = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        guild: { id: 'g1', name: 'guild' },
        member: { roles: { cache: { some: () => false } } },
        commandName: 'bob-nuclei',
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

describe('bob-nuclei smoke', () => {
    let cmd;

    beforeEach(() => {
        vi.resetModules();
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        cmd = require('../../commands/nuclei.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (cmd.shutdown) cmd.shutdown();
    });

    it('module exports data and execute', () => {
        expect(cmd.data).toBeDefined();
        expect(cmd.data.name).toBe('bob-nuclei');
        expect(typeof cmd.execute).toBe('function');
    });

    it('execute defers and completes with valid username', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: { username: 'testuser123' } });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalled();
    });

    it('rejects invalid username with error message', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: { username: '../../etc/passwd' } });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/invalid/i);
    });

    it('rejects invalid tags format', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: { username: 'testuser123', tags: 'good,bad tag!' } });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/invalid.*tag/i);
    });

    it('handles missing username gracefully', { timeout: 500 }, async () => {
        const interaction = makeInteraction({ options: {} });
        await cmd.execute(interaction);
        expect(interaction.editReply.mock.calls.length + interaction.reply.mock.calls.length).toBeGreaterThan(0);
    });
});
