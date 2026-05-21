import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';

vi.mock('../../utils/process', () => ({
    safeSpawn: vi.fn().mockResolvedValue({ stdout: 'jwt_tool output', stderr: '', code: 0 }),
    safeSpawnToFile: vi.fn().mockImplementation(async (_cmd, _args, outputFile) => {
        // Write mock content to the output file so readFile succeeds
        const fs = require('fs').promises;
        await fs.writeFile(outputFile, 'JWT analysis results mock output');
        return { stderr: '', code: 0 };
    }),
    getSafeEnv: vi.fn().mockReturnValue({})
}));

// Mock fs sync methods used by jwt.js to check file existence and create dirs
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ size: 100 }),
        promises: {
            ...actual.promises,
            mkdir: vi.fn().mockResolvedValue(undefined),
            readFile: vi.fn().mockResolvedValue('JWT analysis results mock output'),
            readdir: vi.fn().mockResolvedValue([]),
            stat: vi.fn().mockResolvedValue({ mtime: { getTime: () => Date.now() } }),
            unlink: vi.fn().mockResolvedValue(undefined),
            writeFile: vi.fn().mockResolvedValue(undefined)
        }
    };
});

function makeInteraction({ options = {}, ...rest } = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        guild: { id: 'g1', name: 'guild' },
        member: { roles: { cache: { some: () => false } } },
        commandName: 'bob-jwt',
        options: {
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getAttachment: (k) => options[k] ?? null,
            getSubcommand: () => options.__subcommand ?? 'analyze',
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

const VALID_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc';

describe('bob-jwt smoke', () => {
    let cmd;

    beforeEach(() => {
        vi.resetModules();
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        cmd = require('../../commands/jwt.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (cmd.shutdown) cmd.shutdown();
    });

    it('module exports data and execute', () => {
        expect(cmd.data).toBeDefined();
        expect(cmd.data.name).toBe('bob-jwt');
        expect(typeof cmd.execute).toBe('function');
    });

    it('execute defers reply (ephemeral) for analyze with valid JWT', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: { __subcommand: 'analyze', token: VALID_JWT }
        });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalledWith(
            expect.objectContaining({ flags: MessageFlags.Ephemeral })
        );
    });

    it('rejects malformed token with error embed', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: { __subcommand: 'analyze', token: 'not-a-jwt' }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        // Should reply with embeds containing error
        const embeds = replyArg?.embeds ?? [];
        expect(embeds.length).toBeGreaterThan(0);
    });

    it('tamper subcommand validates missing value for modify action', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: {
                __subcommand: 'tamper',
                token: VALID_JWT,
                action: 'modify',
                claim: 'sub',
                secret: 'mysecret'
                // value intentionally missing
            }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const embeds = replyArg?.embeds ?? [];
        expect(embeds.length).toBeGreaterThan(0);
    });

    it('crack subcommand with valid token defers and replies', { timeout: 500 }, async () => {
        // The wordlist check uses existsSync; with our fs mock (existsSync → true) the command
        // proceeds to spawn jwt_tool. safeSpawnToFile writes mock output so we get a reply.
        const interaction = makeInteraction({
            options: { __subcommand: 'crack', token: VALID_JWT }
        });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalled();
    });
});
