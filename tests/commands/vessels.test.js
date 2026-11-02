import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EmbedBuilder } = require('discord.js');

let cmd, getSpy;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    getSpy = vi.spyOn(require('axios'), 'get');
    cmd = require('../../commands/vessels.js');
});

afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
    // the command is link-only; any HTTP call is a regression
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
});

function makeInteraction(sub, opts = {}) {
    return {
        options: {
            getSubcommand: () => sub,
            getString: (k) => opts[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}
const reply = (i) => i.editReply.mock.calls.at(-1)[0];
const fields = (i) => Object.fromEntries(reply(i).embeds[0].data.fields.map((f) => [f.name, f.value]));

describe('bob-vessel name length', () => {
    it('caps the option at 100 characters and keeps a long name inside the embed title limit', async () => {
        const opt = cmd.data.toJSON().options.find((o) => o.name === 'name').options[0];
        expect(opt.max_length).toBe(100);
        const i = makeInteraction('name', { vessel: 'A'.repeat(300) });
        await cmd.execute(i);
        expect(reply(i).embeds[0].data.title.length).toBeLessThanOrEqual(256);
    });
});

describe('bob-vessel imo', () => {
    it.each(['123456', '12345678', 'abcdefg', ''])('rejects %j as an invalid IMO number', async (number) => {
        const i = makeInteraction('imo', { number });
        await cmd.execute(i);
        expect(reply(i)).toMatch(/valid IMO number \(7 digits/);
    });

    it('builds tracking links for a valid IMO number', async () => {
        const i = makeInteraction('imo', { number: '9395044' });
        await cmd.execute(i);

        const e = reply(i).embeds[0].data;
        expect(e.title).toBe('Vessel Tracking: IMO 9395044');
        const f = fields(i);
        expect(f.MarineTraffic).toBe('https://www.marinetraffic.com/en/ais/details/ships/imo:9395044');
        expect(f.VesselFinder).toBe('https://www.vesselfinder.com/vessels/details/9395044');
        expect(f['Additional Resources']).toContain('IMONumber=9395044');
    });

    it('strips separators so links only ever contain the 7 digits', async () => {
        const i = makeInteraction('imo', { number: 'IMO 93-95-044' });
        await cmd.execute(i);
        for (const url of Object.values(fields(i)).filter((v) => v.startsWith('http'))) {
            expect(url).toMatch(/9395044/);
            expect(url).not.toMatch(/IMO%20|93-95/);
        }
    });

    it('makes no HTTP request', async () => {
        await cmd.execute(makeInteraction('imo', { number: '9395044' }));
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('bob-vessel name', () => {
    it.each(['', 'ab', '  a  '])('rejects the too-short name %j', async (vessel) => {
        const i = makeInteraction('name', { vessel });
        await cmd.execute(i);
        expect(reply(i)).toBe('Please provide a vessel name with at least 3 characters.');
    });

    it('builds search links for a vessel name', async () => {
        const i = makeInteraction('name', { vessel: 'Ever Given' });
        await cmd.execute(i);
        expect(reply(i).embeds[0].data.title).toBe('Vessel Search: "Ever Given"');
        const f = fields(i);
        expect(f.MarineTraffic).toBe('https://www.marinetraffic.com/en/ais/index/search/all/keyword:Ever%20Given');
        expect(f.VesselFinder).toBe('https://www.vesselfinder.com/vessels?name=Ever%20Given');
    });

    it('url-encodes the name so it cannot inject query parameters or a new host', async () => {
        const i = makeInteraction('name', { vessel: 'x&admin=1#@evil.com/' });
        await cmd.execute(i);
        const f = fields(i);
        expect(f.VesselFinder).toBe('https://www.vesselfinder.com/vessels?name=x%26admin%3D1%23%40evil.com%2F');
        expect(f.MarineTraffic).not.toMatch(/keyword:[^%]*[&#@/]/);
    });

    it('keeps the user-supplied name inside the embed and out of the message content', async () => {
        const i = makeInteraction('name', { vessel: '@everyone ship' });
        await cmd.execute(i);
        expect(reply(i).content).toBeUndefined();
    });

    it('answers with a generic message, without the underlying error, when building the reply fails', async () => {
        const spy = vi.spyOn(EmbedBuilder.prototype, 'setTitle').mockImplementationOnce(() => { throw new Error('SECRET_INTERNAL_DETAIL'); });
        const i = makeInteraction('name', { vessel: 'Ever Given' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        spy.mockRestore();
        expect(JSON.stringify(reply(i))).not.toContain('SECRET_INTERNAL_DETAIL');
        expect(reply(i)).toBe('An error occurred while processing your request. Please try again later.');
    });
});
