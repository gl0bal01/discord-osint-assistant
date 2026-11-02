import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const KEY = 'aviationstack-secret-key-555';
let cmd;
let axios;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    cmd = require('../../commands/aviation.js');
});

beforeEach(() => {
    vi.stubEnv('AVIATIONSTACK_API_KEY', KEY);
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

function makeInteraction(opts = {}) {
    const sent = [];
    const rec = async (p) => { sent.push(p); };
    return {
        sent,
        options: { getString: (k) => opts[k] ?? null },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(rec),
        followUp: vi.fn(rec),
        reply: vi.fn(rec)
    };
}

const textOf = (p) => (typeof p === 'string' ? p : p?.content ?? '');
const last = (i) => textOf(i.sent.at(-1));
const everything = (i) => JSON.stringify(i.sent);
const embedOf = (p) => p.embeds[0].data;

function httpErr(status) {
    return Object.assign(new Error(`Request failed with status code ${status} access_key=${KEY}`), {
        response: { status, data: { error: { info: KEY } } }
    });
}

const flight = (over = {}) => ({
    flight_status: 'active',
    departure: { airport: 'Heathrow', iata: 'LHR', scheduled: '2026-11-03T08:00:00+00:00', delay: 12 },
    arrival: { airport: 'John F Kennedy', iata: 'JFK', scheduled: '2026-11-03T11:00:00+00:00', delay: null },
    airline: { name: 'British Airways' },
    flight: { iata: 'BA117' },
    aircraft: { registration: 'G-XWBA' },
    ...over
});

describe('bob-flight definition', () => {
    it('offers optional flight_number, airline and airport options', () => {
        const opts = cmd.data.toJSON().options;
        expect(opts.map((o) => o.name)).toEqual(['flight_number', 'airline', 'airport']);
        expect(opts.every((o) => !o.required)).toBe(true);
    });
});

describe('bob-flight input validation', () => {
    it('asks for at least one parameter and makes no request', async () => {
        const i = makeInteraction();
        await cmd.execute(i);
        expect(last(i)).toContain('at least one parameter');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it.each([
        [{ flight_number: 'BA 117!' }, 'Invalid flight number'],
        [{ flight_number: 'B' }, 'Invalid flight number'],
        [{ flight_number: 'BA' }, 'Invalid flight number'],
        [{ flight_number: '12345' }, 'Invalid flight number'],
        [{ flight_number: 'BA117&access_key=evil' }, 'Invalid flight number'],
        [{ airline: 'B' }, 'Invalid airline code'],
        [{ airline: 'BAAA' }, 'Invalid airline code'],
        [{ airline: '12' }, 'Invalid airline code'],
        [{ airport: 'LH' }, 'Invalid airport code'],
        [{ airport: 'LHR1' }, 'Invalid airport code']
    ])('rejects %j and makes no request', async (opts, msg) => {
        const i = makeInteraction(opts);
        await cmd.execute(i);
        expect(last(i)).toContain(msg);
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-flight missing API key', () => {
    it('reports a configuration error and makes no request', async () => {
        vi.stubEnv('AVIATIONSTACK_API_KEY', '');
        const i = makeInteraction({ flight_number: 'BA117' });
        await cmd.execute(i);
        expect(last(i)).toContain('API configuration error');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-flight happy path', () => {
    it('shows airline, flight, route, status and delay in an embed', async () => {
        axios.get.mockResolvedValue({ data: { data: [flight()] } });
        const i = makeInteraction({ flight_number: 'BA117' });
        await cmd.execute(i);
        const e = embedOf(i.sent.at(-1));
        expect(e.title).toBe('British Airways Flight BA117');
        expect(e.description).toBe('Status: active');
        const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
        expect(f.Departure).toBe('Heathrow (LHR)');
        expect(f.Arrival).toBe('John F Kennedy (JFK)');
        expect(f.Aircraft).toBe('G-XWBA');
        expect(f['Departure Delay']).toBe('12 minutes');
        expect(f['Arrival Delay']).toBeUndefined();
    });

    it('uses N/A placeholders when the flight record is sparse', async () => {
        axios.get.mockResolvedValue({ data: { data: [{}] } });
        const i = makeInteraction({ airline: 'BA' });
        await cmd.execute(i);
        const e = embedOf(i.sent.at(-1));
        expect(e.title).toBe('Unknown Airline Flight Unknown');
        expect(e.fields.find((x) => x.name === 'Departure').value).toBe('N/A (N/A)');
    });

    it.each([
        ['117', { flight_number: '117' }],
        ['ba117', { flight_iata: 'BA117' }],
        ['BAW117', { flight_icao: 'BAW117' }],
        ['u2123', { flight_iata: 'U2123' }]
    ])('maps flight %j to the matching AviationStack param', async (input, expected) => {
        axios.get.mockResolvedValue({ data: { data: [flight()] } });
        await cmd.execute(makeInteraction({ flight_number: input }));
        expect(axios.get.mock.calls[0][1].params).toEqual({ access_key: KEY, limit: 5, ...expected });
    });

    it('normalises codes to upper case and caps results at five', async () => {
        axios.get.mockResolvedValue({ data: { data: [flight()] } });
        await cmd.execute(makeInteraction({ airline: 'ba', airport: 'lhr' }));
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://api.aviationstack.com/v1/flights');
        expect(cfg.params).toEqual({ access_key: KEY, limit: 5, airline_iata: 'BA', dep_iata: 'LHR' });
    });

    it('shows the first flight in the reply and the rest as follow-ups', async () => {
        axios.get.mockResolvedValue({ data: { data: [flight(), flight(), flight()] } });
        const i = makeInteraction({ airport: 'LHR' });
        await cmd.execute(i);
        expect(i.sent[0].content).toBe('Found 3 flights. Showing the first 3:');
        expect(i.followUp).toHaveBeenCalledTimes(2);
    });

    it('limits output to five flights', async () => {
        axios.get.mockResolvedValue({ data: { data: Array.from({ length: 8 }, () => flight()) } });
        const i = makeInteraction({ airport: 'LHR' });
        await cmd.execute(i);
        expect(i.sent[0].content).toContain('Showing the first 5');
        expect(i.followUp).toHaveBeenCalledTimes(4);
    });

    it('says so when no flights match', async () => {
        axios.get.mockResolvedValue({ data: { data: [] } });
        const i = makeInteraction({ flight_number: 'ZZ999' });
        await cmd.execute(i);
        expect(last(i)).toBe('No flights found matching your criteria.');
    });

    it('gives a generic message when the API body carries an error object', async () => {
        axios.get.mockResolvedValue({ data: { error: { code: 'usage_limit_reached', info: KEY } } });
        const i = makeInteraction({ flight_number: 'BA117' });
        await cmd.execute(i);
        expect(last(i)).toContain('aviation API returned an error');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('usage_limit_reached');
    });
});

describe('bob-flight upstream failures', () => {
    it.each([
        [401, 'Authentication error'],
        [404, 'No flights found'],
        [429, 'Rate limit exceeded'],
        [500, 'aviation API returned an error']
    ])('answers HTTP %i appropriately without the key or error.message', async (status, expected) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction({ flight_number: 'BA117' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain(expected);
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
    });

    it('answers a timeout with a generic message and no key', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`timeout of 10000ms exceeded ${KEY}`), { code: 'ECONNABORTED' }));
        const i = makeInteraction({ flight_number: 'BA117' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain('Please try again later');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('timeout of');
    });

    it('says the service could not be reached when no response came back', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { request: {} }));
        const i = makeInteraction({ flight_number: 'BA117' });
        await cmd.execute(i);
        expect(last(i)).toContain('Could not connect to flight data service');
        expect(everything(i)).not.toContain(KEY);
    });
});

describe('bob-flight security', () => {
    it('sends the key only as a request param and never echoes it', async () => {
        axios.get.mockResolvedValue({ data: { data: [flight()] } });
        const i = makeInteraction({ flight_number: 'BA117' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][0]).not.toContain(KEY);
        expect(everything(i)).not.toContain(KEY);
    });

    it('keeps user input out of the URL (params only)', async () => {
        axios.get.mockResolvedValue({ data: { data: [] } });
        await cmd.execute(makeInteraction({ flight_number: 'BA117' }));
        expect(axios.get.mock.calls[0][0]).toBe('https://api.aviationstack.com/v1/flights');
        expect(axios.get.mock.calls[0][1].params.flight_iata).toBe('BA117');
    });
});
