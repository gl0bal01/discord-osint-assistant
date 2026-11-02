import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const KEY = 'airportdb-secret-key-777';
let cmd;
let axios;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    cmd = require('../../commands/airport.js');
});

beforeEach(() => {
    vi.stubEnv('AIRPORTDB_API_KEY', KEY);
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
const embedOf = (p) => p.embeds[0].data ?? p.embeds[0];
const fieldsOf = (p) => Object.fromEntries(embedOf(p).fields.map((f) => [f.name, f.value]));

function httpErr(status) {
    return Object.assign(new Error(`Request failed with status code ${status} apiToken=${KEY}`), {
        response: { status, data: { message: KEY } }
    });
}

const heathrow = {
    icao_code: 'EGLL',
    iata_code: 'LHR',
    name: 'London Heathrow Airport',
    type: 'large_airport',
    latitude_deg: 51.4706,
    longitude_deg: -0.461941,
    elevation_ft: 83,
    municipality: 'London',
    iso_country: 'GB',
    home_link: 'http://www.heathrowairport.com/',
    wikipedia_link: 'https://en.wikipedia.org/wiki/Heathrow_Airport',
    runways: [{}, {}]
};

const tpList = [
    { code: 'JFK', name: 'John F Kennedy', city_code: 'NYC', country_code: 'US', time_zone: 'America/New_York', coordinates: { lat: 40.63, lon: -73.77 }, flightable: true },
    { code: 'LHR', name: 'Heathrow', city_code: 'LON', country_code: 'GB', time_zone: 'Europe/London', coordinates: { lat: 51.47, lon: -0.46 }, flightable: true }
];

describe('bob-airport definition', () => {
    it('offers optional icao and iata options', () => {
        const opts = cmd.data.toJSON().options;
        expect(opts.map((o) => o.name)).toEqual(['icao', 'iata']);
        expect(opts.every((o) => !o.required)).toBe(true);
    });
});

describe('bob-airport input validation', () => {
    it.each([
        ['neither code', {}],
        ['both codes', { icao: 'EGLL', iata: 'LHR' }]
    ])('rejects %s and makes no request', async (_n, opts) => {
        const i = makeInteraction(opts);
        await cmd.execute(i);
        expect(last(i)).toContain('either an ICAO code or an IATA code, but not both');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it.each(['../../admin', 'EG', 'EGLL1', 'EG/L', 'EGLL?x=1'])('rejects ICAO %j and makes no request', async (icao) => {
        const i = makeInteraction({ icao });
        await cmd.execute(i);
        expect(last(i)).toContain('Invalid ICAO code');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('upper-cases a lower-case ICAO before building the URL', async () => {
        axios.get.mockResolvedValue({ data: heathrow });
        await cmd.execute(makeInteraction({ icao: 'egll' }));
        expect(axios.get.mock.calls[0][0]).toBe('https://airportdb.io/api/v1/airport/EGLL');
    });

    it('finds an airport when the IATA code is typed in lower case', async () => {
        axios.get.mockResolvedValue({ data: tpList });
        const i = makeInteraction({ iata: 'lhr' });
        await cmd.execute(i);
        expect(embedOf(i.sent[0]).title).toBe('Heathrow (LHR)');
    });
});

describe('bob-airport missing API key', () => {
    it('reports a missing key for an ICAO search and makes no request', async () => {
        vi.stubEnv('AIRPORTDB_API_KEY', '');
        const i = makeInteraction({ icao: 'EGLL' });
        await cmd.execute(i);
        expect(last(i)).toContain('API token not found');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('still answers an IATA search from the public list without calling AirportDB', async () => {
        vi.stubEnv('AIRPORTDB_API_KEY', '');
        axios.get.mockResolvedValue({ data: tpList });
        const i = makeInteraction({ iata: 'LHR' });
        await cmd.execute(i);
        expect(embedOf(i.sent[0]).title).toBe('Heathrow (LHR)');
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(i.followUp).not.toHaveBeenCalled();
    });
});

describe('bob-airport happy path', () => {
    it('shows the AirportDB details for an ICAO search', async () => {
        axios.get.mockResolvedValue({ data: heathrow });
        const i = makeInteraction({ icao: 'EGLL' });
        await cmd.execute(i);
        expect(embedOf(i.sent[0]).title).toBe('London Heathrow Airport (EGLL)');
        const f = fieldsOf(i.sent[0]);
        expect(f['IATA Code']).toBe('LHR');
        expect(f.Location).toBe('London, GB');
        expect(f.Coordinates).toBe('51.4706, -0.461941');
        expect(f.Elevation).toBe('83 ft');
        expect(f.Runways).toBe('2');
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe('https://airportdb.io/api/v1/airport/EGLL');
        expect(cfg.params).toEqual({ apiToken: KEY });
    });

    it('uses N/A for missing ICAO fields', async () => {
        axios.get.mockResolvedValue({ data: { icao_code: 'ZZZZ', name: 'Tiny Strip' } });
        const i = makeInteraction({ icao: 'ZZZZ' });
        await cmd.execute(i);
        const f = fieldsOf(i.sent[0]);
        expect(f.Elevation).toBe('N/A');
        expect(f.Runways).toBe('N/A');
        expect(f['IATA Code']).toBe('N/A');
    });

    it('shows the basic airport and then AirportDB details for an IATA search', async () => {
        axios.get.mockImplementation(async (url) => {
            if (url.includes('travelpayouts')) return { data: tpList };
            if (url === 'https://airportdb.io/api/v1/airport/iata/LHR') return { data: heathrow };
            throw new Error('unexpected url');
        });
        const i = makeInteraction({ iata: 'LHR' });
        await cmd.execute(i);
        expect(embedOf(i.sent[0]).title).toBe('Heathrow (LHR)');
        expect(fieldsOf(i.sent[0])['Time Zone']).toBe('Europe/London');
        expect(fieldsOf(i.sent[0]).Coordinates).toBe('51.47, -0.46');
        expect(i.followUp.mock.calls[0][0].content).toBe('Additional details found:');
        expect(embedOf(i.sent[1]).title).toBe('London Heathrow Airport (EGLL)');
    });

    it('keeps the basic answer when the AirportDB enrichment fails', async () => {
        axios.get.mockImplementation(async (url) => {
            if (url.includes('travelpayouts')) return { data: tpList };
            throw httpErr(500);
        });
        const i = makeInteraction({ iata: 'LHR' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(i.sent).toHaveLength(1);
        expect(embedOf(i.sent[0]).title).toBe('Heathrow (LHR)');
        expect(everything(i)).not.toContain(KEY);
    });

    it('says so when the IATA code is unknown and does not query AirportDB', async () => {
        axios.get.mockResolvedValue({ data: tpList });
        const i = makeInteraction({ iata: 'ZZZ' });
        await cmd.execute(i);
        expect(last(i)).toBe('No airport found with IATA code: ZZZ');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

describe('bob-airport upstream failures', () => {
    it.each([[401], [404], [429], [500]])('answers ICAO HTTP %i generically without key or error.message', async (status) => {
        axios.get.mockRejectedValue(httpErr(status));
        const i = makeInteraction({ icao: 'EGLL' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toBe('Error fetching airport data. Please check the ICAO code and try again.');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('Request failed');
    });

    it('answers an ICAO timeout generically without the key', async () => {
        axios.get.mockRejectedValue(Object.assign(new Error(`timeout of 15000ms exceeded ${KEY}`), { code: 'ECONNABORTED' }));
        const i = makeInteraction({ icao: 'EGLL' });
        await cmd.execute(i);
        expect(last(i)).toContain('Error fetching airport data');
        expect(everything(i)).not.toContain(KEY);
        expect(everything(i)).not.toContain('timeout of');
    });

    it('answers an IATA list failure generically', async () => {
        axios.get.mockRejectedValue(httpErr(500));
        const i = makeInteraction({ iata: 'LHR' });
        await cmd.execute(i);
        expect(last(i)).toBe('Error fetching airport data. Please check the IATA code and try again.');
        expect(everything(i)).not.toContain(KEY);
    });

    it('answers a malformed IATA list entry generically instead of throwing', async () => {
        axios.get.mockResolvedValue({ data: [{ code: 'LHR', name: 'Heathrow' }] });
        const i = makeInteraction({ iata: 'LHR' });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toContain('Error fetching airport data');
    });
});

describe('bob-airport security', () => {
    it('sends the key as a param, not in the URL, and never echoes it', async () => {
        axios.get.mockResolvedValue({ data: heathrow });
        const i = makeInteraction({ icao: 'EGLL' });
        await cmd.execute(i);
        expect(axios.get.mock.calls[0][0]).not.toContain(KEY);
        expect(everything(i)).not.toContain(KEY);
    });

    it('never forwards an unlisted IATA value into a request URL', async () => {
        axios.get.mockResolvedValue({ data: tpList });
        await cmd.execute(makeInteraction({ iata: '../../admin' }));
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get.mock.calls[0][0]).toContain('travelpayouts');
    });
});
