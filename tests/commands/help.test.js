import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MessageFlags } from 'discord.js';

let help;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    help = require('../../commands/help.js');
});

const cmd = (name, description) => [name, { data: { name, description } }];

function makeInteraction(entries) {
    return {
        client: { commands: new Map(entries) },
        reply: vi.fn().mockResolvedValue(undefined)
    };
}

async function run(entries) {
    const interaction = makeInteraction(entries);
    await expect(help.execute(interaction)).resolves.not.toThrow();
    return interaction.reply.mock.calls[0][0];
}

const isEphemeral = (p) => p.ephemeral === true || ((p.flags ?? 0) & MessageFlags.Ephemeral) !== 0;

describe('bob-help', () => {
    it('lists every command, sorted by name, with the total in the title', async () => {
        const reply = await run([cmd('bob-zeta', 'Last one'), cmd('bob-alpha', 'First one'), cmd('bob-mid', 'Middle one')]);
        const [embed] = reply.embeds;
        expect(embed.data.title).toBe('Available Commands (3)');
        expect(embed.data.description).toBe(
            '`/bob-alpha` — First one\n`/bob-mid` — Middle one\n`/bob-zeta` — Last one'
        );
    });

    it('replies privately', async () => {
        const reply = await run([cmd('bob-alpha', 'First one')]);
        expect(isEphemeral(reply)).toBe(true);
    });

    it('marks permission-restricted commands with a lock and explains it in the footer', async () => {
        const reply = await run([cmd('bob-nuclei', 'Scanner'), cmd('bob-dns', 'Lookup')]);
        const { description, footer } = reply.embeds[0].data;
        expect(description).toContain('🔒 `/bob-nuclei` — Scanner');
        expect(description.startsWith('`/bob-dns` — Lookup\n')).toBe(true);
        expect(description).not.toContain('🔒 `/bob-dns`');
        expect(footer.text).toMatch(/elevated permission/);
    });

    it('does not treat Object.prototype names as restricted', async () => {
        const reply = await run([cmd('constructor', 'Odd name')]);
        expect(reply.embeds[0].data.description).toBe('`/constructor` — Odd name');
    });

    it('still lists a command that has no description', async () => {
        const reply = await run([cmd('bob-quiet', undefined)]);
        expect(reply.embeds[0].data.description).toBe('`/bob-quiet` — ');
    });

    it('splits a long list over several embeds under the description limit, titling only the first', async () => {
        const entries = Array.from({ length: 80 }, (_, n) => cmd(`bob-cmd${String(n).padStart(3, '0')}`, 'x'.repeat(100)));
        const reply = await run(entries);
        expect(reply.embeds.length).toBeGreaterThan(1);
        expect(reply.embeds[0].data.title).toBe('Available Commands (80)');
        expect(reply.embeds.slice(1).every((e) => e.data.title === undefined)).toBe(true);
        expect(reply.embeds.every((e) => e.data.description.length <= 4096)).toBe(true);
        const all = reply.embeds.map((e) => e.data.description).join('\n');
        expect(all.split('\n')).toHaveLength(80);
    });
});
