import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

let health;
let axios;
let proc;
let realSafeSpawn;
const unstubbed = () => Promise.reject(new Error('unstubbed safeSpawn'));
const spawn = vi.fn(unstubbed); // stable reference: health.js destructures safeSpawn once at load

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    proc = require('../../utils/process.js');
    // vi.mock does not intercept CJS require(): spy before health.js destructures safeSpawn
    realSafeSpawn = proc.safeSpawn;
    proc.safeSpawn = spawn;
    health = require('../../commands/health.js');
});

afterEach(() => {
    spawn.mockReset().mockImplementation(unstubbed);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

afterAll(() => { proc.safeSpawn = realSafeSpawn; });

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
        expect(spawn).not.toHaveBeenCalled();
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
        expect(config.httpAgent).toBeDefined();
        expect(config.httpsAgent).toBeDefined();
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
    it('shows versions of available tools and degrades overall when one is missing', async () => {
        vi.stubEnv('SHERLOCK_PATH', '/opt/private/bin/sherlock');
        spawn.mockImplementation(async (bin) => {
            if (bin === 'exiftool') return { stdout: '12.76\n', stderr: '' };
            if (bin === 'nuclei') return { stdout: '', stderr: 'Nuclei Engine Version: v3.1.0' };
            throw new Error(`Failed to start process: ${bin} ENOENT`);
        });
        const { fields, data } = await run({ 'check-tools': true });
        expect(fields['🔧 External Tools']).toBe('🟢 ExifTool v12.76\n🔴 Sherlock\n🟢 Nuclei v3.1.0');
        expect(fields['📊 Overall Status']).toBe('🟡 **DEGRADED** (75/100)\n⚠️ Issues: 1 tool(s) unavailable');
        expect(JSON.stringify(data)).not.toMatch(/ENOENT|\/opt\/private/);
    });

    it('runs each tool with an argv array and the configured path', async () => {
        vi.stubEnv('NUCLEI_PATH', '/usr/local/bin/nuclei-custom');
        spawn.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
        await run({ 'check-tools': true });
        const calls = spawn.mock.calls.map(([bin, args]) => [bin, args]);
        expect(calls).toEqual([
            ['exiftool', ['-ver']],
            ['sherlock', ['--version']],
            ['/usr/local/bin/nuclei-custom', ['-version']]
        ]);
    });

    it('stays healthy when every tool responds', async () => {
        spawn.mockResolvedValue({ stdout: 'version 2.5.1', stderr: '' });
        const { fields } = await run({ 'check-tools': true });
        expect(fields['🔧 External Tools']).toBe('🟢 ExifTool v2.5.1\n🟢 Sherlock v2.5.1\n🟢 Nuclei v2.5.1');
        expect(fields['📊 Overall Status']).toContain('HEALTHY');
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
