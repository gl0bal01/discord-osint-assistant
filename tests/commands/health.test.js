import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

let health;
let axios;
let tools;
let realIsToolAvailable;
const available = vi.fn(() => false); // stable reference: health.js destructures isToolAvailable once at load

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    tools = require('../../utils/tools.js');
    // vi.mock does not intercept CJS require(): swap before health.js destructures isToolAvailable
    realIsToolAvailable = tools.isToolAvailable;
    tools.isToolAvailable = available;
    health = require('../../commands/health.js');
});

afterEach(() => {
    available.mockReset().mockImplementation(() => false);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

afterAll(() => { tools.isToolAvailable = realIsToolAvailable; });

const makeClient = (over = {}) => ({
    isReady: () => true,
    presence: { status: 'online' },
    ws: { ping: 42 },
    guilds: { cache: { size: 3 } },
    users: { cache: { size: 120 } },
    commands: new Map([['a', {}], ['b', {}]]),
    uptime: 3_600_000 + 5 * 60_000,
    readyAt: new Date('2026-11-01T00:00:00Z'),
    ...over
});

function makeInteraction(options = {}, client = makeClient()) {
    return {
        client,
        options: { getBoolean: (k) => options[k] ?? null },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

async function run(options, client) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Keep the heap ratio deterministic so the memory check cannot flip the status
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 50 * 1048576, heapTotal: 100 * 1048576, rss: 1, external: 1, arrayBuffers: 1 });
    const interaction = makeInteraction(options, client);
    await expect(health.execute(interaction)).resolves.not.toThrow();
    const payload = interaction.editReply.mock.calls.at(-1)[0];
    const data = payload.embeds?.[0]?.data;
    const fields = Object.fromEntries((data?.fields ?? []).map((f) => [f.name, f.value]));
    return { interaction, payload, data, fields };
}

describe('bob-health basic status', () => {
    it('defers, then shows a healthy bot with its Discord connection details', async () => {
        const { interaction, data, fields } = await run({});
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(data.title).toBe('🏥 Discord OSINT Assistant - Health Status');
        expect(fields['📊 Overall Status']).toBe('🟢 **HEALTHY** (100/100)\n✅ No issues detected');
        const bot = fields['🤖 Discord Bot'];
        expect(bot).toContain('🟢 Connected');
        expect(bot).toContain('**Ping:** 42ms');
        expect(bot).toContain('**Guilds:** 3');
        expect(bot).toContain('**Uptime:** 1h 5m');
        expect(fields['💻 System']).toContain('**Memory:** 50MB / 100MB');
    });

    it('does not run API or tool checks, or show detailed info, unless asked', async () => {
        const { fields } = await run({});
        expect(Object.keys(fields)).toEqual(['📊 Overall Status', '💻 System', '🤖 Discord Bot']);
        expect(available).not.toHaveBeenCalled();
    });

    it('reports unhealthy when the Discord client is not ready', async () => {
        const { fields } = await run({}, makeClient({ isReady: () => false }));
        expect(fields['📊 Overall Status']).toBe('🔴 **UNHEALTHY** (25/100)\n⚠️ Issues: Discord not connected');
        expect(fields['🤖 Discord Bot']).toContain('🔴 Disconnected');
    });

    it('reports unhealthy instead of crashing when there is no client', async () => {
        const { fields } = await run({}, null);
        expect(fields['📊 Overall Status']).toContain('UNHEALTHY');
        expect(fields['🤖 Discord Bot']).toContain('🔴 Disconnected');
    });

    it('reports degraded when heap usage is above 90%', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const interaction = makeInteraction({});
        // run() installs its own memory stub, so go direct here
        vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 95, heapTotal: 100, rss: 1, external: 1, arrayBuffers: 1 });
        await health.execute(interaction);
        const fields = Object.fromEntries(interaction.editReply.mock.calls[0][0].embeds[0].data.fields.map((f) => [f.name, f.value]));
        expect(fields['📊 Overall Status']).toBe('🟡 **DEGRADED** (75/100)\n⚠️ Issues: High memory usage');
    });
});

describe('bob-health detailed', () => {
    it('adds CPU, load and temp-dir details when detailed is on', async () => {
        const { fields } = await run({ detailed: true });
        const detail = fields['⚙️ Detailed System Info'];
        expect(detail).toMatch(/\*\*CPU:\*\* \d+ cores/);
        expect(detail).toMatch(/\*\*Load Avg:\*\* \d+\.\d{2}, \d+\.\d{2}, \d+\.\d{2}/);
        expect(detail).toMatch(/\*\*Temp Dir:\*\* (✅ Available|❌ Missing)/);
    });

    it('does not print network interface addresses', async () => {
        const { data } = await run({ detailed: true });
        const addresses = Object.values(require('os').networkInterfaces()).flat().map((n) => n.address);
        const text = JSON.stringify(data);
        expect(addresses.filter((a) => text.includes(a))).toEqual([]);
    });
});

describe('bob-health check-apis', () => {
    it('probes only configured APIs, without credentials, through the SSRF-safe config', async () => {
        vi.stubEnv('DNSDUMPSTER_TOKEN', 'dns-secret-token');
        vi.stubEnv('WHOXY_API_KEY', '');
        vi.stubEnv('HOSTIO_API_KEY', '');
        const head = vi.spyOn(axios, 'head').mockResolvedValue({ status: 200 });
        const { fields, data } = await run({ 'check-apis': true });
        expect(head).toHaveBeenCalledTimes(1);
        const [url, config] = head.mock.calls[0];
        expect(url).toBe('https://api.dnsdumpster.com');
        expect(config.httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
        expect(config.httpsAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpsAgent);
        expect(JSON.stringify(head.mock.calls[0])).not.toContain('dns-secret-token');
        expect(fields['🌐 External APIs']).toBe('🟢 DNSDumpster\n🟡 Whoxy\n🟡 Host.io');
        expect(JSON.stringify(data)).not.toContain('dns-secret-token');
    });

    it('marks a configured but unreachable API as degraded without failing the command', async () => {
        vi.stubEnv('WHOXY_API_KEY', 'whoxy-key');
        vi.stubEnv('DNSDUMPSTER_TOKEN', '');
        vi.stubEnv('HOSTIO_API_KEY', '');
        vi.spyOn(axios, 'head').mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:443'));
        const { fields, data } = await run({ 'check-apis': true });
        expect(fields['🌐 External APIs']).toBe('🟡 DNSDumpster\n🟡 Whoxy\n🟡 Host.io');
        expect(fields['📊 Overall Status']).toContain('HEALTHY');
        expect(JSON.stringify(data)).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
    });
});

describe('bob-health check-tools', () => {
    const CLI = ['exif', 'ghunt', 'jwt', 'linkook', 'maigret', 'nuclei', 'sherlock', 'xeuledoc'];

    it('lists every CLI-backed command, a missing tool as hidden rather than unhealthy', async () => {
        vi.stubEnv('SHERLOCK_PATH', '/opt/private/bin/sherlock');
        available.mockImplementation((candidates) => candidates.some((c) => /nuclei|jwt_tool/.test(c)));
        const { fields, data } = await run({ 'check-tools': true });
        expect(fields['🔧 External Tools']).toBe([
            '⚪ exiftool: not installed, /bob-exif hidden',
            '⚪ ghunt: not installed, /bob-ghunt hidden',
            '🟢 jwt_tool: /bob-jwt',
            '⚪ linkook: not installed, /bob-linkook hidden',
            '⚪ maigret: not installed, /bob-maigret hidden',
            '🟢 nuclei: /bob-nuclei',
            '⚪ sherlock: not installed, /bob-sherlock hidden',
            '⚪ xeuledoc: not installed, /bob-xeuledoc hidden'
        ].join('\n'));
        expect(fields['📊 Overall Status']).toBe('🟢 **HEALTHY** (100/100)\n✅ No issues detected');
        expect(JSON.stringify(data)).not.toContain('/opt/private');
    });

    it('asks the same question bootstrap does: each command\'s own requiresTool', async () => {
        await run({ 'check-tools': true });
        expect(available.mock.calls.map(([c]) => c)).toEqual(CLI.map((f) => require(`../../commands/${f}.js`).requiresTool));
    });

    it('shows every tool green when all are installed', async () => {
        available.mockReturnValue(true);
        const { fields } = await run({ 'check-tools': true });
        expect(fields['🔧 External Tools'].split('\n')).toHaveLength(CLI.length);
        expect(fields['🔧 External Tools']).not.toContain('⚪');
    });
});

describe('bob-health error handling', () => {
    it('replies with a generic failure message that hides the internal error', async () => {
        const client = makeClient({ isReady: () => { throw new Error('internal-secret-detail'); } });
        const { payload } = await run({}, client);
        expect(payload.content).toMatch(/Health Check Failed/);
        expect(payload.content).not.toContain('internal-secret-detail');
        expect(payload.embeds).toBeUndefined();
    });
});
