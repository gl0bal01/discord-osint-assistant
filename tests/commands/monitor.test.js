import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CHANNEL_ID = '123456789012345678';
const SAFE = { httpAgent: { safe: 'http' }, httpsAgent: { safe: 'https' } };
const INTERNAL = /^(127\.|10\.|192\.168\.|169\.254\.|localhost$)/;

let cmd, axios, getSpy, validateSpy, channel, client;

function loadFresh() {
    delete require.cache[require.resolve('../../commands/monitor.js')];
    return require('../../commands/monitor.js');
}

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    process.env.MONITOR_CHANNEL_ID = CHANNEL_ID; // read at module load
    validateSpy = vi.spyOn(require('../../utils/ssrf.js'), 'validateUrlNotInternal');
    vi.spyOn(require('../../utils/ssrf.js'), 'getSafeAxiosConfig').mockReturnValue(SAFE);
    axios = require('axios');
    getSpy = vi.spyOn(axios, 'get');
    cmd = loadFresh();
});

afterAll(() => {
    cmd.shutdown();
    vi.restoreAllMocks();
});

beforeEach(() => {
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
    validateSpy.mockReset().mockImplementation(async (u) => {
        if (INTERNAL.test(new URL(u).hostname)) throw new Error('URL resolves to a private/internal IP address');
    });
    channel = {
        permissionsFor: vi.fn(() => ({ has: () => true })),
        send: vi.fn().mockResolvedValue(undefined)
    };
    client = { user: { id: 'bot' }, channels: { fetch: vi.fn(async () => channel) } };
});

afterEach(() => {
    cmd.shutdown(); // clears every interval so none leak across tests
    vi.useRealTimers();
});

function makeInteraction(sub, { url = null, interval = null, userId = 'u1' } = {}) {
    return {
        client,
        user: { id: userId },
        options: {
            getSubcommand: () => sub,
            getString: (k) => (k === 'url' ? url : null),
            getInteger: (k) => (k === 'interval' ? interval : null)
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}
const text = (i) => {
    const p = i.editReply.mock.calls.at(-1)[0];
    return typeof p === 'string' ? p : p.content;
};
const run = async (sub, opts) => {
    const i = makeInteraction(sub, opts);
    await cmd.execute(i);
    return i;
};
const start = (url, interval = 5, userId = 'u1') => run('start', { url, interval, userId });
const listText = async () => text(await run('list'));

describe('bob-monitor start: validation and SSRF', () => {
    it.each(['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/'])(
        'refuses %s, makes no request and does not register a monitor',
        async (url) => {
            const i = await start(url);
            expect(validateSpy).toHaveBeenCalledWith(url);
            expect(text(i)).toBe('The provided URL is not allowed or the monitor could not be started.');
            expect(getSpy).not.toHaveBeenCalled();
            expect(await listText()).toBe('No websites are currently being monitored');
        }
    );

    it('refuses a string that is not a URL', async () => {
        validateSpy.mockImplementation(async (u) => { new URL(u); });
        const i = await start('not a url');
        expect(text(i)).toMatch(/not allowed or the monitor could not be started/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('defers the reply as ephemeral', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        const i = await start('https://example.com/');
        expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it('explains the problem when MONITOR_CHANNEL_ID is not configured', async () => {
        const saved = process.env.MONITOR_CHANNEL_ID;
        delete process.env.MONITOR_CHANNEL_ID;
        const unconfigured = loadFresh();
        try {
            const i = makeInteraction('start', { url: 'https://example.com/', interval: 5 });
            await unconfigured.execute(i);
            expect(text(i)).toBe('Monitoring is not configured: MONITOR_CHANNEL_ID is unset.');
            expect(getSpy).not.toHaveBeenCalled();
        } finally {
            unconfigured.shutdown();
            process.env.MONITOR_CHANNEL_ID = saved;
        }
    });
});

describe('bob-monitor start: happy path', () => {
    it('validates then fetches the URL with the safe agents and confirms', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        const i = await start('https://example.com/page', 5);

        expect(text(i)).toBe(`Started monitoring https://example.com/page every 5 minutes. Results will be posted in <#${CHANNEL_ID}>`);
        expect(validateSpy.mock.invocationCallOrder[0]).toBeLessThan(getSpy.mock.invocationCallOrder[0]);
        const [url, config] = getSpy.mock.calls[0];
        expect(url).toBe('https://example.com/page');
        expect(config.httpAgent).toBe(SAFE.httpAgent);
        expect(config.httpsAgent).toBe(SAFE.httpsAgent);
        expect(config.responseType).toBe('text');
        expect(client.channels.fetch).toHaveBeenCalledWith(CHANNEL_ID);
    });

    it('lists the monitored URL', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/a');
        await start('https://example.com/b');
        expect(await listText()).toBe('Monitored websites:\nhttps://example.com/a\nhttps://example.com/b');
    });

    it('does not announce a change on the first check', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/');
        expect(channel.send).not.toHaveBeenCalled();
    });

    it('still starts when the first check fails, without leaking the error', async () => {
        getSpy.mockRejectedValue(new Error('ECONNRESET secret-host.internal'));
        const i = await start('https://example.com/');
        expect(text(i)).toMatch(/^Started monitoring/);
        expect(text(i)).not.toContain('secret-host.internal');
    });
});

describe('bob-monitor start: limits and failures', () => {
    it('refuses to monitor the same URL twice', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/');
        const i = await start('https://example.com/', 5, 'u2');
        expect(text(i)).toBe('Already monitoring https://example.com/');
    });

    it('enforces three monitors per user but still serves other users', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        for (const n of [1, 2, 3]) await start(`https://example.com/${n}`);
        const blocked = await start('https://example.com/4');
        expect(text(blocked)).toBe('You have reached the per-user monitor limit (3). Stop one of your monitors first.');
        const other = await start('https://example.com/4', 5, 'u2');
        expect(text(other)).toMatch(/^Started monitoring/);
        expect((await listText()).split('\n').filter((l) => l === 'https://example.com/4')).toHaveLength(1);
    });

    it('enforces the global limit of 20 monitors', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        for (let n = 0; n < 20; n++) await start(`https://example.com/${n}`, 5, `user${Math.floor(n / 3)}`);
        const i = await start('https://example.com/overflow', 5, 'fresh-user');
        expect(text(i)).toBe('Maximum monitoring limit (20) reached. Stop some monitors first.');
    });

    it('refuses and registers nothing when the bot cannot post in the channel', async () => {
        channel.permissionsFor.mockReturnValue({ has: () => false });
        const i = await start('https://example.com/');
        expect(text(i)).toBe("I don't have permission to send messages in the monitoring channel.");
        expect(getSpy).not.toHaveBeenCalled();
        expect(await listText()).toBe('No websites are currently being monitored');
    });

    it('gives a generic message, hiding the cause, when the channel lookup throws', async () => {
        client.channels.fetch.mockRejectedValue(new Error('Unknown Channel secret-guild-id'));
        const i = await start('https://example.com/');
        expect(text(i)).toBe('The provided URL is not allowed or the monitor could not be started.');
        expect(await listText()).toBe('No websites are currently being monitored');
    });
});

describe('bob-monitor polling', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));

    it('posts to the channel when the page content changes', async () => {
        getSpy.mockResolvedValueOnce({ data: 'v1' }).mockResolvedValue({ data: 'v2' });
        await start('https://example.com/', 5);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(channel.send).toHaveBeenCalledWith('Changes detected on https://example.com/');
    });

    it('stays quiet while the content is unchanged', async () => {
        getSpy.mockResolvedValue({ data: 'same' });
        await start('https://example.com/', 5);
        await vi.advanceTimersByTimeAsync(15 * 60000);
        expect(getSpy).toHaveBeenCalledTimes(4);
        expect(channel.send).not.toHaveBeenCalled();
    });

    it('re-validates the URL on every poll and stops notifying if it turns internal', async () => {
        getSpy.mockResolvedValueOnce({ data: 'v1' }).mockResolvedValue({ data: 'v2' });
        await start('https://example.com/', 5);
        validateSpy.mockRejectedValue(new Error('URL resolves to a private/internal IP address'));
        getSpy.mockClear();
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(getSpy).not.toHaveBeenCalled();
        expect(channel.send).not.toHaveBeenCalled();
    });

    it('keeps running after a failed poll', async () => {
        getSpy.mockResolvedValueOnce({ data: 'v1' })
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue({ data: 'v2' });
        await start('https://example.com/', 5);
        await vi.advanceTimersByTimeAsync(10 * 60000);
        expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it('does not relay @everyone from a monitored URL into the channel message', async () => {
        getSpy.mockResolvedValueOnce({ data: 'v1' }).mockResolvedValue({ data: 'v2' });
        await start('https://example.com/@everyone', 5);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(channel.send.mock.calls[0][0]).not.toMatch(/@everyone/);
    });

    it('stop cancels the interval', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/', 5);
        const i = await run('stop', { url: 'https://example.com/' });
        expect(text(i)).toBe('Stopped monitoring https://example.com/');
        getSpy.mockClear();
        await vi.advanceTimersByTimeAsync(30 * 60000);
        expect(getSpy).not.toHaveBeenCalled();
        expect(await listText()).toBe('No websites are currently being monitored');
    });

    it('shutdown cancels every interval', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/a', 5);
        await start('https://example.com/b', 5);
        cmd.shutdown();
        getSpy.mockClear();
        await vi.advanceTimersByTimeAsync(30 * 60000);
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('bob-monitor stop, stopall and list', () => {
    it('says so when stopping a URL that is not monitored', async () => {
        const i = await run('stop', { url: 'https://example.com/nope' });
        expect(text(i)).toBe('Not monitoring https://example.com/nope');
    });

    it('stopall removes every monitor', async () => {
        getSpy.mockResolvedValue({ data: 'v1' });
        await start('https://example.com/a');
        await start('https://example.com/b', 5, 'u2');
        const i = await run('stopall');
        expect(text(i)).toBe('Stopped monitoring all websites');
        expect(await listText()).toBe('No websites are currently being monitored');
    });

    it('lists nothing when no site is monitored', async () => {
        expect(await listText()).toBe('No websites are currently being monitored');
    });
});
