import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';

let cmd;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    cmd = require('../../commands/flight-number.js');
});

afterEach(() => vi.restoreAllMocks());

const makeInteraction = (flight) => ({
    options: { getString: (k) => (k === 'flight' ? flight : null) },
    reply: vi.fn().mockResolvedValue(undefined)
});

async function run(flight) {
    const interaction = makeInteraction(flight);
    await expect(cmd.execute(interaction)).resolves.not.toThrow();
    return interaction.reply.mock.calls[0][0];
}

describe('bob-flight-number input validation', () => {
    it.each(['', null, 'BA', '234', 'BA12345', 'BAAA1', 'BA-234', 'BA234/../../x', 'BA 23 4x', 'https://evil.test/BA234'])(
        'rejects %j with guidance and no embed',
        async (input) => {
            const reply = await run(input);
            expect(reply.content).toMatch(/valid flight number/i);
            expect(reply.embeds).toBeUndefined();
        }
    );

    it('accepts alphanumeric IATA airline codes such as U21234', async () => {
        expect((await run('U21234')).embeds[0].data.title).toBe('Flight Tracking: U21234');
        expect((await run('w6 1234')).embeds[0].data.title).toBe('Flight Tracking: W61234');
    });

    it.each(['12345', '1234', '123A456', '1'])('rejects %j (no letter in the airline code)', async (input) => {
        expect((await run(input)).embeds).toBeUndefined();
    });
});

describe('bob-flight-number success output', () => {
    it('builds one embed with five provider links for a standard flight number', async () => {
        const reply = await run('BA234');
        const { title, description, fields } = reply.embeds[0].data;
        expect(title).toBe('Flight Tracking: BA234');
        expect(description).toMatch(/links below/i);
        expect(Object.fromEntries(fields.map((f) => [f.name, f.value]))).toEqual({
            AirNavRadar: 'https://www.airnavradar.com/data/flights/BA234',
            FlightAware: 'https://fr.flightaware.com/live/flight/BA234',
            Flightera: 'https://www.flightera.net/en/flight/BA234',
            'AirportInfo Live': 'https://airportinfo.live/flight/ba234',
            FlightRadar24: 'https://www.flightradar24.com/data/flights/ba234'
        });
    });

    it('normalizes case and inner spaces', async () => {
        const reply = await run('  dl 1234 ');
        expect(reply.embeds[0].data.title).toBe('Flight Tracking: DL1234');
    });

    it('accepts three-letter airline codes', async () => {
        const reply = await run('EZY1');
        expect(reply.embeds[0].data.title).toBe('Flight Tracking: EZY1');
    });
});

describe('bob-flight-number error handling', () => {
    it('sends a generic ephemeral message when the first reply fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const interaction = makeInteraction('BA234');
        interaction.reply.mockRejectedValueOnce(new Error('internal-secret-detail'));
        await expect(cmd.execute(interaction)).resolves.not.toThrow();
        const payload = interaction.reply.mock.calls[1][0];
        expect(payload.content).toMatch(/error occurred/i);
        expect(payload.content).not.toContain('internal-secret-detail');
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
    });
});
