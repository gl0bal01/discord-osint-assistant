import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AWS SDK before requiring the command
vi.mock('@aws-sdk/client-rekognition', () => {
    const mockSend = vi.fn().mockResolvedValue({
        Labels: [{ Name: 'Person', Confidence: 99.5 }],
        TextDetections: [],
        FaceDetails: [],
        ModerationLabels: [],
        CelebrityFaces: [],
        FaceMatches: [],
        UnmatchedFaces: []
    });
    const MockClient = vi.fn().mockImplementation(() => ({ send: mockSend }));
    return {
        RekognitionClient: MockClient,
        DetectLabelsCommand: vi.fn().mockImplementation((p) => ({ input: p })),
        DetectTextCommand: vi.fn().mockImplementation((p) => ({ input: p })),
        DetectFacesCommand: vi.fn().mockImplementation((p) => ({ input: p })),
        DetectModerationLabelsCommand: vi.fn().mockImplementation((p) => ({ input: p })),
        RecognizeCelebritiesCommand: vi.fn().mockImplementation((p) => ({ input: p })),
        CompareFacesCommand: vi.fn().mockImplementation((p) => ({ input: p }))
    };
});

vi.mock('axios', () => {
    const mockGet = vi.fn().mockResolvedValue({
        status: 200,
        data: Buffer.from('fake-image-data'),
        headers: { 'content-type': 'image/jpeg' }
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

// Mock fs sync methods (rekognition.js uses sync fs throughout)
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([]),
        statSync: vi.fn().mockReturnValue({ mtime: { getTime: () => Date.now() } }),
        readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-image-data')),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
        promises: {
            ...actual.promises,
            mkdir: vi.fn().mockResolvedValue(undefined)
        }
    };
});

function makeInteraction({ options = {}, ...rest } = {}) {
    return {
        user: { id: 'u1', tag: 'user#0001' },
        guild: { id: 'g1', name: 'guild' },
        member: { roles: { cache: { some: () => false } } },
        commandName: 'bob-rekognition',
        options: {
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getNumber: (k) => options[k] ?? null,
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

const MOCK_ATTACHMENT = {
    url: 'https://cdn.discordapp.com/attachments/123/456/example.jpg',
    name: 'example.jpg',
    size: 1024,
    contentType: 'image/jpeg'
};

describe('bob-rekognition smoke', () => {
    let cmd;

    beforeEach(() => {
        vi.resetModules();
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
        process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
        process.env.AWS_REGION = 'us-east-1';
        cmd = require('../../commands/rekognition.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (cmd.shutdown) cmd.shutdown();
    });

    it('module exports data and execute', () => {
        expect(cmd.data).toBeDefined();
        expect(cmd.data.name).toBe('bob-rekognition');
        expect(typeof cmd.execute).toBe('function');
    });

    it('execute defers reply for analyze with image attachment', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: {
                __subcommand: 'analyze',
                image: MOCK_ATTACHMENT,
                features: 'labels'
            }
        });
        await cmd.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalled();
    });

    it('returns error when AWS credentials are missing', { timeout: 500 }, async () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        const interaction = makeInteraction({
            options: { __subcommand: 'analyze', image: MOCK_ATTACHMENT }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/aws|credential/i);
    });

    it('rejects analyze with no image and no url', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: { __subcommand: 'analyze' }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/provide|image|url/i);
    });

    it('compare subcommand errors with no source image', { timeout: 500 }, async () => {
        const interaction = makeInteraction({
            options: {
                __subcommand: 'compare',
                target_image: MOCK_ATTACHMENT
                // source intentionally missing
            }
        });
        await cmd.execute(interaction);
        expect(interaction.editReply).toHaveBeenCalled();
        const replyArg = interaction.editReply.mock.calls[0][0];
        const content = typeof replyArg === 'string' ? replyArg : replyArg?.content ?? '';
        expect(content).toMatch(/source|provide/i);
    });
});
