import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SlashCommandBuilder } from 'discord.js';

beforeAll(() => {
    // utils/config.js validates env at import time; some commands may transitively
    // require it. Set sentinel values so the test process does not exit(1).
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
});

const COMMANDS_DIR = resolve(__dirname, '..', '..', 'commands');
const commandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));

describe('command module contract', () => {
    it('discovers at least one command file', () => {
        expect(commandFiles.length).toBeGreaterThan(0);
    });

    it.each(commandFiles)('%s exports `data` (SlashCommandBuilder) and `execute` (async fn)', (file) => {
        const mod = require(join(COMMANDS_DIR, file));

        expect(mod.data, `${file}: missing \`data\` export`).toBeDefined();
        expect(mod.data, `${file}: \`data\` must be a SlashCommandBuilder`)
            .toBeInstanceOf(SlashCommandBuilder);
        expect(typeof mod.data.name, `${file}: data.name must be a string`).toBe('string');
        expect(mod.data.name.length, `${file}: data.name must be non-empty`).toBeGreaterThan(0);

        expect(typeof mod.execute, `${file}: \`execute\` must be a function`).toBe('function');

        if ('shutdown' in mod) {
            expect(typeof mod.shutdown, `${file}: \`shutdown\` must be a function if exported`)
                .toBe('function');
        }
    });

    it('command names are unique across modules', () => {
        const names = commandFiles.map((f) => require(join(COMMANDS_DIR, f)).data.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dupes, `duplicate command names: ${dupes.join(', ')}`).toEqual([]);
    });
});
