import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vpic-test-'));
process.env.REPORTS_DIR = path.join(tmpRoot, 'reports');
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client-id';

const SAFE = { httpAgent: { safe: 'http' }, httpsAgent: { safe: 'https' } };
const VIN = '1HGCM82633A004352';
const BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

let cmd, axios, getSpy, cleanupSpy, filePaths;

beforeAll(() => {
    vi.spyOn(require('../../utils/ssrf.js'), 'getSafeAxiosConfig').mockReturnValue(SAFE);
    const temp = require('../../utils/temp.js');
    const realCleanup = temp.cleanupFile;
    vi.spyOn(temp, 'reportFilePath').mockImplementation((name, ext) => {
        const p = path.join(tmpRoot, `${name}_${filePaths.length}.${ext}`);
        filePaths.push(p);
        return p;
    });
    cleanupSpy = vi.spyOn(temp, 'cleanupFile').mockImplementation((p) => realCleanup(p, 0));
    axios = require('axios');
    getSpy = vi.spyOn(axios, 'get');
    cmd = require('../../commands/vpic.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
    filePaths = [];
    cleanupSpy.mockClear();
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
});

function makeInteraction(sub, opts = {}) {
    const replies = [];
    const fileContents = {};
    return {
        replies,
        fileContents,
        options: {
            getSubcommand: () => sub,
            getString: (k) => opts[k] ?? null,
            getInteger: (k) => opts[k] ?? null,
            getBoolean: (k) => opts[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (payload) => {
            replies.push(payload);
            for (const f of payload?.files ?? []) fileContents[f.name] = fs.readFileSync(f.attachment, 'utf8');
        })
    };
}
const last = (i) => i.replies.at(-1);
const edata = (i) => last(i).embeds[0].data;
const val = (i, name) => edata(i).fields.find((f) => f.name === name)?.value;

const basic = {
    Make: 'HONDA', Model: 'Accord', ModelYear: '2003', VehicleType: 'PASSENGER CAR', BodyClass: 'Coupe',
    DriveType: 'FWD', EngineCylinders: '6', EngineHP: '240', FuelTypePrimary: 'Gasoline',
    Manufacturer: 'HONDA MANUFACTURING OF ALABAMA, LLC', PlantCountry: 'UNITED STATES (USA)', TransmissionStyle: 'Automatic'
};
const extended = [
    { Variable: 'Trim', Value: 'EX' },
    { Variable: 'ABS Type', Value: null },
    { Variable: 'Displacement (CC)', Value: '3000' }
];
function stubDecode(basicResults = [basic], ext = extended) {
    getSpy.mockImplementation(async (url) => {
        if (url.includes('/DecodeVinValues/')) return { data: { Results: basicResults } };
        if (url.includes('/DecodeVin/')) return { data: { Results: ext } };
        throw new Error(`unexpected url ${url}`);
    });
}

describe('bob-vpic decode: input validation', () => {
    it.each([
        ['too short', '1HGCM8263'],
        ['too long', '1HGCM82633A0043521'],
        ['contains I', '1HGCM82633I004352'],
        ['contains O', '1HGCM82633O004352'],
        ['contains Q', '1HGCM82633Q004352'],
        ['has punctuation', '1HGCM82633A00435!'],
        ['is empty', '']
    ])('rejects a VIN that %s without any request', async (_why, vin) => {
        const i = makeInteraction('decode', { vin });
        await cmd.execute(i);
        expect(last(i)).toMatch(/valid Vehicle Identification Number/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('does not send whitespace from the VIN to the API', async () => {
        stubDecode();
        await cmd.execute(makeInteraction('decode', { vin: '1HGCM826 33A004352' }));
        expect(getSpy.mock.calls.length).toBeGreaterThan(0);
        for (const [url] of getSpy.mock.calls) expect(url).not.toMatch(/\s/);
    });
});

describe('bob-vpic decode: happy path', () => {
    it('shows the decoded vehicle in an embed', async () => {
        stubDecode();
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);

        expect(edata(i).title).toBe(`Vehicle Information for VIN: ${VIN}`);
        expect(val(i, 'Make')).toBe('HONDA');
        expect(val(i, 'Model')).toBe('Accord');
        expect(val(i, 'Year')).toBe('2003');
        expect(val(i, 'Engine')).toBe('6 cyl / 240 HP');
        expect(val(i, 'Manufactured In')).toBe('UNITED STATES (USA)');
    });

    it('adds selected extended fields and says "Not specified" for empty ones', async () => {
        stubDecode();
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);
        expect(val(i, 'Trim')).toBe('EX');
        expect(val(i, 'Displacement (CC)')).toBe('3000');
        expect(val(i, 'ABS Type')).toBe('Not specified');
    });

    it('falls back to Unknown for fields NHTSA leaves empty', async () => {
        stubDecode([{ Make: '', Model: '' }], []);
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);
        expect(val(i, 'Make')).toBe('Unknown');
        expect(val(i, 'Engine')).toBe('Unknown cyl / Unknown HP');
    });

    it('queries both NHTSA decode endpoints for the VIN with the safe agents', async () => {
        stubDecode();
        await cmd.execute(makeInteraction('decode', { vin: VIN }));
        expect(getSpy.mock.calls.map((c) => c[0])).toEqual([
            `${BASE}/DecodeVinValues/${VIN}?format=json`,
            `${BASE}/DecodeVin/${VIN}?format=json`
        ]);
        for (const [, config] of getSpy.mock.calls) {
            expect(config.httpAgent).toBe(SAFE.httpAgent);
            expect(config.httpsAgent).toBe(SAFE.httpsAgent);
        }
    });

    it('tells the user when NHTSA returns no results', async () => {
        stubDecode([], []);
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);
        expect(last(i)).toMatch(/No data found for the provided VIN/);
    });

    it('attaches the combined raw JSON and schedules its removal when raw is set', async () => {
        stubDecode();
        const i = makeInteraction('decode', { vin: VIN, raw: true });
        await cmd.execute(i);

        expect(last(i).content).toBe(`Raw vehicle data for VIN: ${VIN}`);
        const json = JSON.parse(i.fileContents[`vin_${VIN}.json`]);
        expect(json.basic.Make).toBe('HONDA');
        expect(json.extended).toHaveLength(3);
        expect(cleanupSpy).toHaveBeenCalledWith(filePaths[0], 5000);
        await vi.waitFor(() => expect(fs.existsSync(filePaths[0])).toBe(false));
    });
});

describe('bob-vpic: upstream failures', () => {
    const fail = (err) => getSpy.mockRejectedValue(err);

    it('explains a 404 without leaking the error message', async () => {
        fail(Object.assign(new Error('Request failed with status code 404 secret-a'), { response: { status: 404 } }));
        const i = makeInteraction('decode', { vin: VIN });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i)).toMatch(/could not be found/);
        expect(last(i)).not.toContain('secret-a');
    });

    it('asks the user to retry on a 429', async () => {
        fail(Object.assign(new Error('x'), { response: { status: 429 } }));
        const i = makeInteraction('makes');
        await cmd.execute(i);
        expect(last(i)).toMatch(/Too many requests/);
    });

    it('reports other HTTP statuses by code and status text only', async () => {
        fail(Object.assign(new Error('secret-b'), { response: { status: 500, statusText: 'Internal Server Error' } }));
        const i = makeInteraction('models', { make: 'Honda' });
        await cmd.execute(i);
        expect(last(i)).toBe('API error: 500 - Internal Server Error');
    });

    it('says the service did not respond on a timeout', async () => {
        fail(Object.assign(new Error('timeout of 10000ms exceeded secret-c'), { code: 'ECONNABORTED', request: {} }));
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);
        expect(last(i)).toMatch(/No response from the vehicle information service/);
        expect(last(i)).not.toContain('secret-c');
    });

    it('uses a generic message for any other error', async () => {
        fail(new Error('ECONNRESET 10.0.0.5 secret-d'));
        const i = makeInteraction('decode', { vin: VIN });
        await cmd.execute(i);
        expect(last(i)).toBe('An unexpected error occurred while processing your request.');
    });
});

describe('bob-vpic makes', () => {
    const makes = Array.from({ length: 25 }, (_, n) => ({ Make_ID: n, Make_Name: `MAKE ${String(24 - n).padStart(2, '0')}` }));

    it('lists the first 20 makes alphabetically with page info', async () => {
        getSpy.mockResolvedValue({ data: { Results: [...makes] } });
        const i = makeInteraction('makes');
        await cmd.execute(i);

        expect(getSpy.mock.calls[0][0]).toBe(`${BASE}/GetAllMakes?format=json`);
        expect(edata(i).description).toBe('Found 25 vehicle makes');
        const list = val(i, 'Makes (Page 1 of 2)');
        expect(list.split('\n').filter(Boolean)).toHaveLength(20);
        expect(list.startsWith('1. MAKE 00\n2. MAKE 01\n')).toBe(true);
    });

    it('shows the remainder with continued numbering on page 2', async () => {
        getSpy.mockResolvedValue({ data: { Results: [...makes] } });
        const i = makeInteraction('makes', { page: 2 });
        await cmd.execute(i);
        const list = val(i, 'Makes (Page 2 of 2)');
        expect(list.split('\n').filter(Boolean)).toEqual(['21. MAKE 20', '22. MAKE 21', '23. MAKE 22', '24. MAKE 23', '25. MAKE 24']);
    });

    it('rejects a page beyond the last one', async () => {
        getSpy.mockResolvedValue({ data: { Results: [...makes] } });
        const i = makeInteraction('makes', { page: 3 });
        await cmd.execute(i);
        expect(last(i)).toBe('Invalid page number. There are only 2 pages of results.');
    });

    it.each([1899, 3000])('rejects year %i without any request', async (year) => {
        const i = makeInteraction('makes', { year });
        await cmd.execute(i);
        expect(last(i)).toMatch(/Invalid year/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('filters by year when one is given', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ MakeName: 'TESLA' }] } });
        const i = makeInteraction('makes', { year: 2020 });
        await cmd.execute(i);
        expect(getSpy.mock.calls[0][0]).toBe(`${BASE}/GetMakeForManufacturer/2020?format=json`);
        expect(edata(i).title).toBe('Vehicle Makes for 2020');
        expect(val(i, 'Makes (Page 1 of 1)')).toBe('1. TESLA\n');
    });

    it('tells the user when the API returns no result list', async () => {
        getSpy.mockResolvedValue({ data: {} });
        const i = makeInteraction('makes');
        await cmd.execute(i);
        expect(last(i)).toBe('No make data available from NHTSA API.');
    });

    it('attaches raw JSON when raw is set', async () => {
        getSpy.mockResolvedValue({ data: { Count: 1, Results: [{ Make_Name: 'ACURA' }] } });
        const i = makeInteraction('makes', { raw: true });
        await cmd.execute(i);
        expect(last(i).content).toBe('Raw vehicle make data');
        expect(JSON.parse(i.fileContents['vehicle_makes_all.json']).Count).toBe(1);
        await vi.waitFor(() => expect(fs.existsSync(filePaths[0])).toBe(false));
    });
});

describe('bob-vpic models', () => {
    it('lists models alphabetically for a make', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ Model_Name: 'Pilot' }, { Model_Name: 'Accord' }, { Model_Name: 'Civic' }] } });
        const i = makeInteraction('models', { make: 'Honda' });
        await cmd.execute(i);
        expect(getSpy.mock.calls[0][0]).toBe(`${BASE}/GetModelsForMake/Honda?format=json`);
        expect(edata(i).title).toBe('Honda Models');
        expect(edata(i).description).toBe('Found 3 models for Honda');
        expect(val(i, 'Models')).toBe('Accord\nCivic\nPilot');
    });

    it('splits more than 20 models into continued fields', async () => {
        const Results = Array.from({ length: 45 }, (_, n) => ({ Model_Name: `M${String(n).padStart(2, '0')}` }));
        getSpy.mockResolvedValue({ data: { Results } });
        const i = makeInteraction('models', { make: 'Honda' });
        await cmd.execute(i);
        expect(edata(i).fields.map((f) => f.name)).toEqual(['Models', 'Models (continued)', 'Models (continued)']);
    });

    it('url-encodes the make so user input cannot alter the request path', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ Model_Name: 'Defender' }] } });
        await cmd.execute(makeInteraction('models', { make: 'Land Rover/../x?y=1#z' }));
        expect(getSpy.mock.calls[0][0]).toBe(`${BASE}/GetModelsForMake/Land%20Rover%2F..%2Fx%3Fy%3D1%23z?format=json`);
    });

    it('uses the make+year endpoint when a year is given', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ Model_Name: 'Civic' }] } });
        const i = makeInteraction('models', { make: 'Honda', year: 2015 });
        await cmd.execute(i);
        expect(getSpy.mock.calls[0][0]).toBe(`${BASE}/GetModelsForMakeYear/make/Honda/modelyear/2015?format=json`);
        expect(edata(i).title).toBe('Honda Models for 2015');
    });

    it('rejects an out-of-range year without any request', async () => {
        const i = makeInteraction('models', { make: 'Honda', year: 1800 });
        await cmd.execute(i);
        expect(last(i)).toMatch(/Invalid year/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('tells the user when no models are found', async () => {
        getSpy.mockResolvedValue({ data: { Results: [] } });
        const i = makeInteraction('models', { make: 'Nonexistent' });
        await cmd.execute(i);
        expect(last(i)).toMatch(/^No models found for make: Nonexistent/);
    });

    it('keeps API-supplied model names inside embeds, never in message content', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ Model_Name: '@everyone' }] } });
        const i = makeInteraction('models', { make: 'Honda' });
        await cmd.execute(i);
        expect(last(i).content).toBeUndefined();
        expect(val(i, 'Models')).toBe('@everyone');
    });

    it('names the raw export after the make with spaces replaced', async () => {
        getSpy.mockResolvedValue({ data: { Results: [{ Model_Name: 'Defender' }] } });
        const i = makeInteraction('models', { make: 'Land Rover', raw: true });
        await cmd.execute(i);
        expect(Object.keys(i.fileContents)).toEqual(['vehicle_models_Land_Rover_all.json']);
        expect(last(i).content).toBe('Raw vehicle model data for Land Rover');
        await vi.waitFor(() => expect(fs.existsSync(filePaths[0])).toBe(false));
    });
});
