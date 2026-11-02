import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Offline by construction: vi.mock cannot intercept require() inside the CJS command, so the
// shared modules are spied on instead. Functions the command destructures at load time
// (validateUrlNotInternal, reportFilePath, cleanupFile) are replaced BEFORE the first require.
let cmd;
let axios;
let dns;
let tls;
let workDir;
let reportsDir;
let realValidate;
let ssrf;
let n = 0;

const validate = vi.fn(() => Promise.reject(new Error('unstubbed validateUrlNotInternal')));

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redirect-work-'));
    reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redirect-reports-'));
    process.env.REPORTS_DIR = reportsDir;
    ssrf = require('../../utils/ssrf.js');
    realValidate = ssrf.validateUrlNotInternal;
    ssrf.validateUrlNotInternal = validate;
    const temp = require('../../utils/temp.js');
    vi.spyOn(temp, 'reportFilePath').mockImplementation((label, ext = 'txt') => path.join(workDir, `${label}_${++n}.${ext}`));
    axios = require('axios');
    dns = require('dns').promises;
    tls = require('tls');
    cmd = require('../../commands/redirect-chain.js');
});

afterAll(() => {
    ssrf.validateUrlNotInternal = realValidate;
    cmd.shutdown();
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(reportsDir, { recursive: true, force: true });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    validate.mockReset().mockImplementation(() => Promise.reject(new Error('unstubbed validateUrlNotInternal')));
    vi.restoreAllMocks();
});

function makeInteraction(options = {}) {
    return {
        options: {
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

const res = (status, headers = {}, data = '') => ({ status, headers, data });
const page = (headers = {}) => res(200, { 'content-type': 'text/html', server: 'nginx', ...headers }, '<html><script>1</script></html>');

// responses: map of url -> response or Error. Anything else rejects loudly.
function stubNetwork(responses, { tlsFails = true } = {}) {
    validate.mockResolvedValue(undefined);
    const get = vi.spyOn(axios, 'get').mockImplementation((url) => {
        const hit = responses[url];
        if (hit instanceof Error) return Promise.reject(hit);
        return hit ? Promise.resolve(hit) : Promise.reject(new Error(`unstubbed axios.get ${url}`));
    });
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns, 'reverse').mockResolvedValue(['example.com']);
    // tls.connect would open a real socket: fail the handshake instead
    vi.spyOn(tls, 'connect').mockImplementation(() => {
        const handlers = {};
        const socket = { on: (e, h) => { handlers[e] = h; return socket; }, setTimeout: () => {}, end: () => {} };
        if (tlsFails) queueMicrotask(() => handlers.error?.(new Error('offline')));
        return socket;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return { get, post };
}

async function run(options, { timers = false } = {}) {
    if (timers) vi.useFakeTimers({ toFake: ['setTimeout'] });
    const interaction = makeInteraction(options);
    await expect(cmd.execute(interaction)).resolves.not.toThrow();
    return { interaction, last: interaction.editReply.mock.calls.at(-1)[0] };
}

const fieldsOf = (embed) => Object.fromEntries((embed.data.fields ?? []).map((f) => [f.name, f.value]));

describe('bob-redirect-check module', () => {
    it('exports /bob-redirect-check with an execute handler', () => {
        expect(cmd.data.name).toBe('bob-redirect-check');
        expect(typeof cmd.execute).toBe('function');
    });
});

describe('bob-redirect-check input validation', () => {
    it.each(['not-a-url', 'ftp://example.com/file', 'javascript:alert(1)', ''])('rejects %j without any request', async (url) => {
        const { get } = stubNetwork({});
        const { last, interaction } = await run({ url });
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(last).toBe('Please provide a valid URL starting with http:// or https://');
        expect(get).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it('refuses internal targets through the SSRF check and makes no request', async () => {
        const { get } = stubNetwork({});
        validate.mockRejectedValue(new Error('private IP 192.168.1.1'));
        const { last } = await run({ url: 'http://192.168.1.1/' });
        expect(validate).toHaveBeenCalledWith('http://192.168.1.1/');
        expect(last).toBe('The provided URL is not allowed.');
        expect(get).not.toHaveBeenCalled();
    });

    it('re-checks every redirect target against the SSRF guard and stops at an internal one', async () => {
        const { get } = stubNetwork({
            'https://example.com/': res(302, { location: 'http://169.254.169.254/latest/meta-data' })
        });
        validate.mockImplementation((u) => (u.includes('169.254.169.254') ? Promise.reject(new Error('blocked')) : Promise.resolve()));
        const { last } = await run({ url: 'https://example.com/' });
        expect(validate).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data');
        expect(get).toHaveBeenCalledTimes(1);
        expect(last).toBe('An error occurred while processing your request. Please try again later.');
    });
});

describe('bob-redirect-check results', () => {
    it('shows a direct 200 response with server, content type and IP', async () => {
        stubNetwork({ 'https://example.com/': page() });
        const { last } = await run({ url: 'https://example.com/', deep: false });
        const embed = last.embeds[0];
        expect(embed.data.title).toBe('🔗 URL Redirect Analysis');
        expect(embed.data.description).toBe('Analysis for: `https://example.com/`');
        const fields = fieldsOf(embed);
        expect(fields['📊 Summary']).toContain('**Total redirects:** 0');
        expect(fields['📊 Summary']).toContain('**Final status:** 200');
        expect(fields['🎯 Final Destination']).toContain('✅ `200` https://example.com/');
        expect(fields['🎯 Final Destination']).toContain('🖥️ Server: nginx');
        expect(fields['🎯 Final Destination']).toContain('📄 Content: text/html');
        expect(fields['🎯 Final Destination']).toContain('🌐 IP: 93.184.216.34');
    });

    it('follows redirects manually and lists each hop', async () => {
        const { get } = stubNetwork({
            'http://example.com/': res(301, { location: 'https://example.com/', server: 'cdn' }),
            'https://example.com/': res(302, { location: '/home' }),
            'https://example.com/home': page()
        });
        const { last } = await run({ url: 'http://example.com/', deep: false });
        const fields = fieldsOf(last.embeds[0]);
        expect(get.mock.calls.map((c) => c[0])).toEqual(['http://example.com/', 'https://example.com/', 'https://example.com/home']);
        expect(get.mock.calls.every((c) => c[1].maxRedirects === 0)).toBe(true);
        expect(fields['📊 Summary']).toContain('**Total redirects:** 2');
        expect(fields['📊 Summary']).toContain('**HTTPS upgrade:** ✅ Yes');
        expect(fields['🔀 Redirect Chain']).toContain('`301`');
        expect(fields['🔀 Redirect Chain']).toContain('https://example.com/home');
    });

    it('sends every request through the SSRF-safe axios config', async () => {
        const { get } = stubNetwork({ 'https://example.com/': page() });
        await run({ url: 'https://example.com/', deep: false });
        for (const [, config] of get.mock.calls) {
            expect(config.httpAgent).toBeDefined();
            expect(config.httpsAgent).toBeDefined();
        }
    });

    it('flags a shortener chain, tracking parameters and a non-standard port in a security embed', async () => {
        stubNetwork({
            'https://bit.ly/x?utm_source=mail': res(301, { location: 'https://tinyurl.com/y' }),
            'https://tinyurl.com/y': res(301, { location: 'https://t.co/z' }),
            'https://t.co/z': res(301, { location: 'https://example.tk:8443/?fbclid=abc' }),
            'https://example.tk:8443/?fbclid=abc': page()
        });
        const { last } = await run({ url: 'https://bit.ly/x?utm_source=mail', deep: false });
        expect(last.embeds).toHaveLength(2);
        const security = fieldsOf(last.embeds[1]);
        expect(last.embeds[1].data.title).toBe('🔒 Security Analysis');
        expect(security['⚠️ Suspicious Indicators']).toContain('URL shortener chain detected');
        expect(security['⚠️ Suspicious Indicators']).toContain('Suspicious TLD detected');
        expect(security['⚠️ Suspicious Indicators']).toContain('Non-standard port detected');
        expect(security['👁️ Tracking Parameters Detected']).toContain('utm_source');
        expect(security['👁️ Tracking Parameters Detected']).toContain('fbclid');
        expect(fieldsOf(last.embeds[0])['📊 Summary']).toContain('**Risk level:** HIGH');
    });

    it('reports an error status from the final destination without failing', async () => {
        stubNetwork({ 'https://example.com/': res(404, { server: 'nginx' }) });
        const { last } = await run({ url: 'https://example.com/', deep: false });
        expect(fieldsOf(last.embeds[0])['🎯 Final Destination']).toContain('❌ `404`');
    });

    it('notes a change when the same URL is checked again with a different result', async () => {
        const url = 'https://changing.example.com/';
        stubNetwork({ [url]: page() });
        await run({ url, deep: false });
        vi.restoreAllMocks();
        stubNetwork({ [url]: res(503, {}) });
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const interaction = makeInteraction({ url, deep: false });
        const done = cmd.execute(interaction);
        await vi.advanceTimersByTimeAsync(10000); // retry back-off for 5xx
        await done;
        const last = interaction.editReply.mock.calls.at(-1)[0];
        const history = last.embeds.find((e) => e.data.title === '📈 Historical Changes Detected');
        expect(fieldsOf(history)['🔄 Changes']).toContain('Status code: 200 → 503');
    });
});

describe('bob-redirect-check exports and temp files', () => {
    it('attaches a JSON report and removes the temp file shortly afterwards', async () => {
        stubNetwork({ 'https://example.com/': page() });
        const { last } = await run({ url: 'https://example.com/', json: true, deep: false }, { timers: true });
        expect(last.content).toBe('✅ Redirect analysis complete for: https://example.com/');
        expect(last.files[0].name).toBe('redirect_analysis.json');
        const file = last.files[0].attachment;
        expect(file.startsWith(workDir)).toBe(true);
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(report.initial_url).toBe('https://example.com/');
        expect(report.final_destination.status).toBe('200');
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false)); // unlink is real async I/O
    });

    it('attaches a CSV export with one row per hop', async () => {
        stubNetwork({
            'http://example.com/': res(301, { location: 'https://example.com/' }),
            'https://example.com/': page()
        });
        const { last } = await run({ url: 'http://example.com/', export: 'csv', deep: false }, { timers: true });
        expect(last.content).toBe('📊 Export complete for: http://example.com/');
        expect(last.files[0].name).toBe('redirect_analysis.csv');
        const csv = fs.readFileSync(last.files[0].attachment, 'utf8');
        expect(csv.split('\n')[0]).toBe('Step,Status,URL,Time(ms),Server,Content-Type,Notes');
        expect(csv).toContain('Total Redirects,1');
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(fs.existsSync(last.files[0].attachment)).toBe(false));
    });

    it('attaches a Mermaid diagram export', async () => {
        stubNetwork({ 'https://example.com/': page() });
        const { last } = await run({ url: 'https://example.com/', export: 'mermaid', deep: false }, { timers: true });
        expect(last.files[0].name).toBe('redirect_diagram.mmd');
        expect(fs.readFileSync(last.files[0].attachment, 'utf8')).toMatch(/^graph TD\n/);
    });

    it('archives a durable copy of the export in the reports directory', async () => {
        stubNetwork({ 'https://archive.example.com/': page() });
        await run({ url: 'https://archive.example.com/', json: true, deep: false }, { timers: true });
        expect(fs.readdirSync(reportsDir).some((f) => f.startsWith('redirect_https___archive.example.com_'))).toBe(true);
    });
});

describe('bob-redirect-check upstream failures', () => {
    it('shows a generic message when the host cannot be resolved', async () => {
        stubNetwork({
            'https://nope.example/': Object.assign(new Error('getaddrinfo ENOTFOUND nope.example 10.1.1.1'), { code: 'ENOTFOUND' })
        });
        const { last } = await run({ url: 'https://nope.example/', deep: false });
        expect(last).toBe('An error occurred while processing your request. Please try again later.');
    });

    it('does not retry a name-resolution failure', async () => {
        const { get } = stubNetwork({
            'https://nope.example/': Object.assign(new Error('x'), { code: 'ENOTFOUND' })
        });
        await run({ url: 'https://nope.example/', deep: false });
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('retries a server error three times, then reports the status instead of failing', async () => {
        const { get } = stubNetwork({
            'https://flaky.example/': Object.assign(new Error('Request failed 500 secret'), { response: { status: 500 } })
        });
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const interaction = makeInteraction({ url: 'https://flaky.example/', deep: false });
        const done = cmd.execute(interaction);
        await vi.advanceTimersByTimeAsync(10000);
        await done;
        expect(get).toHaveBeenCalledTimes(3);
        const last = interaction.editReply.mock.calls.at(-1)[0];
        expect(fieldsOf(last.embeds[0])['🎯 Final Destination']).toContain('❌ `500`');
        expect(JSON.stringify(last)).not.toContain('secret');
    });

    it('gives up on an endless redirect loop with a generic message', async () => {
        const { get } = stubNetwork({
            'https://loop.example/': res(302, { location: 'https://loop.example/' })
        });
        const { last } = await run({ url: 'https://loop.example/', deep: false });
        expect(last).toBe('An error occurred while processing your request. Please try again later.');
        expect(get.mock.calls.length).toBeLessThanOrEqual(12);
    });

    it('only posts a webhook for suspicious URLs when one is configured', async () => {
        const { post } = stubNetwork({
            'https://bit.ly/a': res(301, { location: 'https://tinyurl.com/b' }),
            'https://tinyurl.com/b': res(301, { location: 'https://example.com/' }),
            'https://example.com/': page()
        });
        await run({ url: 'https://bit.ly/a', deep: false });
        expect(post).not.toHaveBeenCalled();

        vi.stubEnv('SECURITY_WEBHOOK_URL', 'https://hooks.example/abc');
        post.mockResolvedValue({ status: 204 });
        await run({ url: 'https://bit.ly/a', deep: false });
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe('https://hooks.example/abc');
        expect(post.mock.calls[0][1].embeds[0].title).toBe('⚠️ Suspicious URL Detected');
    });
});
