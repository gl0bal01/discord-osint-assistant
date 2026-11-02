import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';

let cmd;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    cmd = require('../../commands/generate-usernames.js');
});

afterEach(() => vi.restoreAllMocks());

function makeInteraction(options = {}) {
    return {
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        reply: vi.fn().mockResolvedValue(undefined)
    };
}

async function run(options) {
    const interaction = makeInteraction(options);
    await expect(cmd.execute(interaction)).resolves.not.toThrow();
    const payload = interaction.reply.mock.calls[0][0];
    const names = payload.files
        ? payload.files[0].attachment.toString('utf8').split('\n').filter((l) => l && !l.startsWith('#'))
        : [];
    return { payload, names };
}

describe('bob-generate-usernames input validation', () => {
    it.each([
        ['both names are only stripped characters', { firstname: '<>$', lastname: '`;|' }],
        ['the first name is blank', { firstname: '   ', lastname: 'Doe' }],
        ['the last name is missing', { firstname: 'John' }]
    ])('rejects the request when %s', async (_label, opts) => {
        const { payload } = await run(opts);
        expect(payload.content).toMatch(/Invalid Input/);
        expect(payload.files).toBeUndefined();
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
    });

    it('removes shell metacharacters and dot-dot sequences from names', async () => {
        const { payload, names } = await run({ firstname: 'Jo`hn;$(x)', lastname: 'D..oe' });
        expect(payload.content).toContain('For:** Johnx Doe');
        expect(names).toContain('johnx.doe');
        expect(names.join('')).not.toMatch(/[`;$()\\]|\.\./);
    });
});

describe('bob-generate-usernames output', () => {
    it('lists the common patterns for John Doe in a private message with a full attachment', async () => {
        const { payload, names } = await run({ firstname: 'John', lastname: 'Doe' });
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.content).toContain('Username Variations Generated');
        expect(payload.content).toContain('For:** John Doe');
        expect(payload.content).toContain(`Total Variations:** ${names.length}`);
        expect(payload.content).toContain('Complete list attached');
        expect(payload.files[0].name).toMatch(/^usernames_John_Doe_\d+\.txt$/);
        for (const expected of ['john.doe', 'doe_john', 'jdoe', 'John_Doe', 'j-d', 'johndoe', 'JOHNDOE']) {
            expect(names).toContain(expected);
        }
    });

    it('shows only 20 samples in the message but every variation in the file', async () => {
        const { payload, names } = await run({ firstname: 'John', lastname: 'Doe' });
        const shown = payload.content.split('```')[1].trim().split('\n');
        expect(shown).toHaveLength(20);
        expect(names.length).toBeGreaterThan(20);
    });

    it('uses only the given separators', async () => {
        const { names } = await run({ firstname: 'John', lastname: 'Doe', separators: '#' });
        expect(names).toContain('john#doe');
        expect(names).not.toContain('john.doe');
        expect(names).not.toContain('john_doe');
    });

    it('wraps every variation in the prefix and suffix', async () => {
        const { names } = await run({ firstname: 'John', lastname: 'Doe', prefix: 'x', suffix: '1990' });
        expect(names).toContain('xjohn.doe1990');
        expect(names.every((n) => n.toLowerCase().startsWith('x') && n.endsWith('1990'))).toBe(true);
    });

    it('emits only lower case names when case variations are off', async () => {
        const { names } = await run({ firstname: 'John', lastname: 'Doe', 'case-variations': false });
        expect(names).toContain('john.doe');
        expect(names.every((n) => n === n.toLowerCase())).toBe(true);
    });

    it('adds numbered variants only when include-numbers is on', async () => {
        const plain = await run({ firstname: 'John', lastname: 'Doe' });
        const numbered = await run({ firstname: 'John', lastname: 'Doe', 'include-numbers': true });
        expect(plain.names).not.toContain('john.doe123');
        expect(numbered.names).toContain('john.doe123');
        expect(numbered.names).toContain('123john.doe');
        expect(numbered.names.length).toBeGreaterThan(plain.names.length);
    });

    it('removes spaces inside names', async () => {
        const { names } = await run({ firstname: 'Mary Ann', lastname: 'Van Der Berg' });
        expect(names).toContain('maryann.vanderberg');
    });

    it('accepts a regex metacharacter in the prefix with include-numbers', async () => {
        const { payload } = await run({ firstname: 'John', lastname: 'Doe', prefix: '+', 'include-numbers': true });
        expect(payload.content).toContain('Username Variations Generated');
    });

    it('keeps the sample list inside a single code block when separators contain backticks', async () => {
        const { payload } = await run({ firstname: 'John', lastname: 'Doe', separators: '```' });
        expect(payload.content.match(/```/g)).toHaveLength(2);
    });
});

describe('bob-generate-usernames error handling', () => {
    it('replies with a generic private message when generation throws', async () => {
        // The first Buffer.from in the attachment builder is the only place generation can be forced to fail
        vi.spyOn(Buffer, 'from').mockImplementationOnce(() => { throw new Error('internal-secret-detail'); });
        const interaction = makeInteraction({ firstname: 'John', lastname: 'Doe' });
        await expect(cmd.execute(interaction)).resolves.not.toThrow();
        const payload = interaction.reply.mock.calls.at(-1)[0];
        expect(payload.content).toMatch(/Generation Failed/);
        expect(payload.content).not.toContain('internal-secret-detail');
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
    });
});
