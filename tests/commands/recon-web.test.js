import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let recon;
let axios;
let ssrf;
let realValidate;
// Stable reference: recon-web.js destructures validateUrlNotInternal once, at load
const validate = vi.fn(() => Promise.reject(new Error('unstubbed validateUrlNotInternal')));
let reportsDir;
const leakedDirs = []; // favicon temp dirs the command failed to remove; swept in afterAll
const mkdtemps = [];

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-reports-'));
    process.env.REPORTS_DIR = reportsDir;
    // vi.mock does not intercept CJS require(): spy before recon-web destructures the import
    ssrf = require('../../utils/ssrf.js');
    realValidate = ssrf.validateUrlNotInternal;
    ssrf.validateUrlNotInternal = validate;
    axios = require('axios');
    recon = require('../../commands/recon-web.js');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    validate.mockReset().mockImplementation(() => Promise.reject(new Error('unstubbed validateUrlNotInternal')));
    vi.restoreAllMocks();
});

afterAll(() => {
    ssrf.validateUrlNotInternal = realValidate;
    vi.restoreAllMocks();
    fs.rmSync(reportsDir, { recursive: true, force: true });
    for (const d of mkdtemps) fs.rmSync(d, { recursive: true, force: true });
});

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const HTML_WITH_ICON = '<html><head><link rel="icon" href="/fav.png"></head></html>';

function makeInteraction(options) {
    return {
        options: { getString: (k) => options[k] ?? null },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

// routes: array of [predicate(url), handler]; anything unrouted rejects loudly
function stubGet(routes) {
    return vi.spyOn(axios, 'get').mockImplementation((url) => {
        const hit = routes.find(([match]) => match(String(url)));
        return hit ? hit[1](url) : Promise.reject(new Error(`unstubbed axios.get ${url}`));
    });
}
const is = (s) => (u) => u.includes(s);

async function run(options, { timers = false } = {}) {
    if (timers) vi.useFakeTimers({ toFake: ['setTimeout'] });
    validate.mockResolvedValue(undefined);
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
    const interaction = makeInteraction({ domain: 'example.com', ...options });
    await expect(recon.execute(interaction)).resolves.not.toThrow();
    const last = interaction.editReply.mock.calls.at(-1)[0];
    const embed = last?.embeds?.[0]?.data;
    const fields = Object.fromEntries((embed?.fields ?? []).map((f) => [f.name, f.value]));
    const buttons = (last?.components?.[0]?.components ?? []).map((b) => [b.data.label, b.data.url]);
    return { interaction, last, embed, fields, buttons };
}

describe('bob-web-recon validation and SSRF', () => {
    it.each(['not a domain', 'http://example.com', 'example', '', 'a..b.com', 'example.com/path'])(
        'rejects %j as a domain without any network call',
        async (domain) => {
            const get = stubGet([]);
            const { last } = await run({ domain, service: 'wayback' });
            expect(last).toBe('Please provide a valid domain name (e.g., example.com)');
            expect(get).not.toHaveBeenCalled();
            expect(validate).not.toHaveBeenCalled();
        }
    );

    it('refuses domains that resolve to internal addresses and makes no request', async () => {
        const get = stubGet([]);
        validate.mockRejectedValue(new Error('resolves to 10.0.0.1'));
        const interaction = makeInteraction({ domain: 'internal.example.com', service: 'wayback' });
        await recon.execute(interaction);
        expect(validate).toHaveBeenCalledWith('https://internal.example.com');
        const reply = interaction.editReply.mock.calls.at(-1)[0];
        expect(reply).toBe('The provided URL is not allowed.');
        expect(reply).not.toContain('10.0.0.1');
        expect(get).not.toHaveBeenCalled();
    });

    it('runs the SSRF pre-check before contacting the target for every service', async () => {
        stubGet([[is('web.archive.org'), () => Promise.resolve({ data: '' })]]);
        await run({ service: 'wayback' });
        expect(validate).toHaveBeenCalledWith('https://example.com');
    });
});

describe('bob-web-recon link-only services', () => {
    it('gives a CertSpotter link and button without calling any API', async () => {
        const get = stubGet([]);
        const { last, embed, fields, buttons } = await run({ service: 'certspotter' });
        expect(get).not.toHaveBeenCalled();
        expect(last.content).toBe('Reconnaissance results for example.com:');
        expect(embed.title).toBe('Reconnaissance for example.com');
        expect(embed.description).toBe('Reconnaissance completed for example.com');
        const url = 'https://api.certspotter.com/v1/issuances?domain=example.com&include_subdomains=true&expand=dns_names&expand=issuer&expand=cert';
        expect(fields.CertSpotter).toBe(`[View certificates issued for example.com](${url})`);
        expect(buttons).toEqual([['CertSpotter', url]]);
    });

    it('gives a VirusTotal link and button', async () => {
        const { fields, buttons } = await run({ service: 'virustotal' });
        const url = 'https://www.virustotal.com/gui/domain/example.com';
        expect(fields.VirusTotal).toBe(`[View security analysis for example.com](${url})`);
        expect(buttons).toEqual([['VirusTotal', url]]);
    });
});

describe('bob-web-recon wayback', () => {
    const ARCHIVE = 'https://web.archive.org/web/*/example.com/*';

    it('counts archived URLs and lists up to five samples', async () => {
        const urls = Array.from({ length: 8 }, (_, n) => `http://example.com/page${n}`);
        stubGet([[is('web.archive.org/cdx'), () => Promise.resolve({ data: urls.join('\n') + '\n' })]]);
        const { fields, buttons } = await run({ service: 'wayback' });
        expect(fields['Wayback Machine']).toBe(`Found 8 archived URLs\n[View archive history](${ARCHIVE})`);
        expect(fields['Sample Archived URLs'].split('\n')).toEqual(urls.slice(0, 5).map((u) => `• ${u}`));
        expect(buttons).toEqual([['Wayback Machine', ARCHIVE]]);
    });

    it('truncates very long archived URLs to 70 characters', async () => {
        const long = 'http://example.com/' + 'a'.repeat(200);
        stubGet([[is('web.archive.org/cdx'), () => Promise.resolve({ data: long })]]);
        const { fields } = await run({ service: 'wayback' });
        expect(fields['Sample Archived URLs']).toBe(`• ${long.slice(0, 67)}...`);
    });

    it('says so when the archive has nothing', async () => {
        stubGet([[is('web.archive.org/cdx'), () => Promise.resolve({ data: '\n' })]]);
        const { fields } = await run({ service: 'wayback' });
        expect(fields['Wayback Machine']).toBe('No archived URLs found');
        expect(fields['Sample Archived URLs']).toBeUndefined();
    });

    it('queries the archive for the domain through the SSRF-safe axios config', async () => {
        const get = stubGet([[is('web.archive.org/cdx'), () => Promise.resolve({ data: '' })]]);
        await run({ service: 'wayback' });
        const [url, config] = get.mock.calls[0];
        expect(url).toBe('https://web.archive.org/cdx/search/cdx?fl=original&collapse=urlkey&url=*.example.com');
        expect(config.httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
        expect(config.httpsAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpsAgent);
    });

    it('shows a generic error field instead of the upstream error text', async () => {
        stubGet([[is('web.archive.org'), () => Promise.reject(new Error('ECONNRESET 10.9.8.7 secret-token'))]]);
        const { fields, embed, last } = await run({ service: 'wayback' });
        expect(fields['Wayback Machine']).toBe('Error fetching archive data');
        expect(JSON.stringify(embed)).not.toMatch(/ECONNRESET|10\.9\.8\.7|secret-token/);
        expect(last.content).toBe('Reconnaissance results for example.com:');
    });
});

describe('bob-web-recon shodan favicon', () => {
    const faviconRoutes = (over = {}) => [
        [(u) => u === 'https://example.com', () => Promise.resolve({ data: over.html ?? HTML_WITH_ICON })],
        [is('/fav.png'), () => over.icon ?? Promise.resolve({ data: PNG, headers: { 'content-type': 'image/png' } })],
        [is('/favicon.ico'), () => over.icon ?? Promise.resolve({ data: PNG, headers: { 'content-type': 'image/x-icon' } })]
    ];

    // Records the temp dirs the command creates so tests can check they are removed
    function trackTempDirs() {
        const real = fs.mkdtempSync;
        const created = [];
        vi.spyOn(fs, 'mkdtempSync').mockImplementation((...a) => {
            const d = real(...a);
            created.push(d);
            mkdtemps.push(d);
            return d;
        });
        return created;
    }

    it('fetches the page, resolves the declared icon, and reports a Shodan favicon search', async () => {
        const get = stubGet(faviconRoutes());
        const { fields, last } = await run({ service: 'shodan' }, { timers: true });
        expect(get.mock.calls.map((c) => c[0])).toEqual(['https://example.com', 'https://example.com/fav.png']);
        expect(fields['Shodan Favicon Hash']).toMatch(/^`-?[0-9a-f]+`$/);
        expect(fields['Shodan Search']).toMatch(
            /^\[Find sites with matching favicon\]\(https:\/\/www\.shodan\.io\/search\?query=http\.favicon\.hash%3A-?[0-9a-f]+\)$/
        );
        expect(last.files).toHaveLength(1);
        expect(last.files[0].name).toBe('favicon-example.com.png');
        expect(last.embeds[0].data.thumbnail.url).toBe('attachment://favicon-example.com.png');
    });

    it('falls back to /favicon.ico when the page declares no icon', async () => {
        const get = stubGet(faviconRoutes({ html: '<html></html>' }));
        const { last } = await run({ service: 'shodan' }, { timers: true });
        expect(get.mock.calls[1][0]).toBe('https://example.com/favicon.ico');
        expect(last.files[0].name).toBe('favicon-example.com.ico');
    });

    it('sends both requests through the SSRF-safe axios config', async () => {
        const get = stubGet(faviconRoutes());
        await run({ service: 'shodan' }, { timers: true });
        for (const [, config] of get.mock.calls) {
            expect(config.httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
            expect(config.httpsAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpsAgent);
        }
    });

    it('uses a whitelisted file extension whatever content type the server claims', async () => {
        stubGet(faviconRoutes({ icon: Promise.resolve({ data: PNG, headers: { 'content-type': 'image/../../evil' } }) }));
        const { last } = await run({ service: 'shodan' }, { timers: true });
        expect(last.files[0].name).toBe('favicon-example.com.ico');
    });

    it('archives a durable copy of the favicon in the reports directory', async () => {
        stubGet(faviconRoutes());
        await run({ service: 'shodan' }, { timers: true });
        expect(fs.readdirSync(reportsDir).some((f) => /^recon_example\.com_.*\.png$/.test(f))).toBe(true);
    });

    it('removes the favicon temp directory shortly after the reply', async () => {
        const created = trackTempDirs();
        stubGet(faviconRoutes());
        await run({ service: 'shodan' }, { timers: true });
        expect(created).toHaveLength(1);
        expect(fs.existsSync(created[0])).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(fs.existsSync(created[0])).toBe(false);
    });

    it('explains when the favicon URL is not an image', async () => {
        stubGet(faviconRoutes({ icon: Promise.resolve({ data: Buffer.from('<html>'), headers: { 'content-type': 'text/html' } }) }));
        const { fields, last } = await run({ service: 'shodan' }, { timers: true });
        expect(fields['Shodan Favicon']).toBe('Unable to process favicon: The resource at https://example.com/fav.png is not an image.');
        expect(last.files).toBeUndefined();
    });

    it('reports a generic failure without the upstream error text', async () => {
        stubGet([[() => true, () => Promise.reject(new Error('ETIMEDOUT 10.9.8.7 secret-token'))]]);
        const { fields, embed } = await run({ service: 'shodan' }, { timers: true });
        expect(fields['Shodan Favicon']).toBe('Failed to extract and hash the favicon.');
        expect(JSON.stringify(embed)).not.toMatch(/ETIMEDOUT|10\.9\.8\.7|secret-token/);
    });

    it('removes the favicon temp directory when the favicon is not an image', async () => {
        const created = trackTempDirs();
        stubGet(faviconRoutes({ icon: Promise.resolve({ data: Buffer.from('<html>'), headers: { 'content-type': 'text/html' } }) }));
        await run({ service: 'shodan' }, { timers: true });
        await vi.advanceTimersByTimeAsync(60000);
        expect(created.filter((d) => fs.existsSync(d))).toEqual([]);
    });

    it('removes the favicon temp directory when fetching the page fails', async () => {
        const created = trackTempDirs();
        stubGet([[() => true, () => Promise.reject(new Error('down'))]]);
        await run({ service: 'shodan' }, { timers: true });
        await vi.advanceTimersByTimeAsync(60000);
        expect(created.filter((d) => fs.existsSync(d))).toEqual([]);
    });

    it('searches Shodan with the signed decimal mmh3 hash of the newline-wrapped base64 favicon', async () => {
        const mmh = require('murmurhash');
        stubGet(faviconRoutes());
        const { fields } = await run({ service: 'shodan' }, { timers: true });
        const expected = mmh.v3(PNG.toString('base64') + '\n') | 0;
        expect(fields['Shodan Favicon Hash']).toBe(`\`${expected}\``);
    });
});

describe('bob-web-recon all services', () => {
    const routes = (over = {}) => [
        [is('crt.sh'), over.crt ?? (() => Promise.resolve({ data: [] }))],
        [is('web.archive.org'), () => Promise.resolve({ data: 'http://example.com/a' })],
        [(u) => u === 'https://example.com', () => Promise.resolve({ data: HTML_WITH_ICON })],
        [is('/fav.png'), () => Promise.resolve({ data: PNG, headers: { 'content-type': 'image/png' } })]
    ];

    it('reports every service in one embed with a button per link', async () => {
        stubGet(routes());
        const { fields, buttons } = await run({}, { timers: true });
        expect(Object.keys(fields)).toEqual(expect.arrayContaining([
            'CertSpotter', 'VirusTotal', 'crt.sh', 'Wayback Machine', 'Shodan Favicon Hash'
        ]));
        expect(fields['crt.sh']).toBe('No certificates found');
        expect(buttons.map(([label]) => label)).toEqual(['CertSpotter', 'VirusTotal', 'Wayback Machine', 'Shodan Favicon']);
    });

    it('defaults to all services when none is chosen', async () => {
        stubGet(routes());
        const { fields } = await run({ service: null }, { timers: true });
        expect(fields.VirusTotal).toBeDefined();
        expect(fields['Wayback Machine']).toBeDefined();
    });

    it('keeps the other services when one upstream fails', async () => {
        stubGet(routes({ crt: () => Promise.reject(new Error('crt.sh 502 secret-token')) }));
        const { fields, embed } = await run({}, { timers: true });
        expect(fields['crt.sh']).toBe('Error fetching certificate data');
        expect(fields['Wayback Machine']).toMatch(/^Found 1 archived URLs/);
        expect(JSON.stringify(embed)).not.toContain('secret-token');
    });
});

describe('bob-web-recon unexpected errors', () => {
    it('replies with a generic message that hides the internal error', async () => {
        stubGet([]);
        validate.mockResolvedValue(undefined);
        const interaction = makeInteraction({ domain: 'example.com', service: 'certspotter' });
        interaction.editReply.mockRejectedValueOnce(new Error('discord-internal-detail'));
        await expect(recon.execute(interaction)).resolves.not.toThrow();
        const reply = interaction.editReply.mock.calls.at(-1)[0];
        expect(reply).toBe('An unexpected error occurred while processing your request. Please try again later.');
        expect(reply).not.toContain('discord-internal-detail');
    });
});
