import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghunt-creds-'));
const credsPath = path.join(tmp, 'ghunt', 'creds.m');
const token = Buffer.from(JSON.stringify({ cookies: {} })).toString('base64');
let ghunt;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    process.env.GHUNT_CREDS_PATH = credsPath;
    ghunt = require('../../commands/ghunt.js');
});

afterAll(() => {
    delete process.env.GHUNT_CREDS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
});

function loginAs(perm) {
    return {
        options: { getString: (k) => ({ type: 'login', token })[k] ?? null, getBoolean: () => null },
        memberPermissions: { has: (p) => p === perm },
        reply: vi.fn(),
        deferReply: vi.fn(),
        editReply: vi.fn()
    };
}

describe('bob-ghunt login', () => {
    it('refuses non-administrators and writes no credentials', async () => {
        const interaction = loginAs(PermissionFlagsBits.ManageGuild);
        await ghunt.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].content).toMatch(/administrator/i);
        expect(fs.existsSync(credsPath)).toBe(false);
    });

    it('lets administrators save credentials, owner-only', async () => {
        await ghunt.execute(loginAs(PermissionFlagsBits.Administrator));
        expect(fs.readFileSync(credsPath, 'utf8')).toBe(token);
        expect(fs.statSync(path.dirname(credsPath)).mode & 0o777).toBe(0o700);
    });
});
