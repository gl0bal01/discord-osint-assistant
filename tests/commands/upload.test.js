import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

let upload;
let axios;
let ssrf;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    axios = require('axios');
    ssrf = require('../../utils/ssrf.js');
    upload = require('../../commands/upload.js');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

const API_KEY = 'sk-test-upload-key';
const MB = 1024 * 1024;

const attachment = (over = {}) => ({
    url: 'https://cdn.discordapp.com/attachments/1/2/call.mp3',
    name: 'call.mp3',
    size: 2048,
    contentType: 'audio/mpeg',
    ...over
});

function makeInteraction(file) {
    return {
        options: { getAttachment: (k) => (k === 'file' ? file : null) },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

// Every axios method rejects unless a test stubs it, so an unexpected call fails loudly
function stubAxios({ get, post } = {}) {
    const unstubbed = (m) => () => Promise.reject(new Error(`unstubbed axios.${m}`));
    return {
        get: vi.spyOn(axios, 'get').mockImplementation(get ?? unstubbed('get')),
        post: vi.spyOn(axios, 'post').mockImplementation(post ?? unstubbed('post')),
        head: vi.spyOn(axios, 'head').mockImplementation(unstubbed('head'))
    };
}

const goodUpload = {
    data: {
        asset: { originalname: 'call.mp3', size: 2048, location: 'https://asset.1min.ai/call.mp3' },
        fileContent: { path: 'audio/call-123.mp3', uuid: 'uuid-123' }
    }
};
const okDownload = () => Promise.resolve({ data: new ArrayBuffer(2048) });

async function run(file, { get = okDownload, post = () => Promise.resolve(goodUpload) } = {}) {
    vi.stubEnv('AI_API_KEY', API_KEY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const spies = stubAxios({ get, post });
    const interaction = makeInteraction(file);
    await expect(upload.execute(interaction)).resolves.not.toThrow();
    return { interaction, spies, last: interaction.editReply.mock.calls.at(-1)[0] };
}

const errorText = (r) => (typeof r === 'string' ? r : r.content);

describe('bob-upload preconditions', () => {
    it('reports a configuration error when AI_API_KEY is missing', async () => {
        vi.stubEnv('AI_API_KEY', '');
        const spies = stubAxios();
        const interaction = makeInteraction(attachment());
        await upload.execute(interaction);
        expect(errorText(interaction.editReply.mock.calls[0][0])).toMatch(/Configuration Error/);
        expect(spies.get).not.toHaveBeenCalled();
        expect(spies.post).not.toHaveBeenCalled();
    });

    it('asks for a file when none is attached', async () => {
        const { last, spies } = await run(null);
        expect(errorText(last)).toMatch(/Missing File/);
        expect(spies.get).not.toHaveBeenCalled();
    });

    it('rejects files over 50 MB before downloading and shows their size', async () => {
        const { last, spies } = await run(attachment({ size: 50 * MB + 1 }));
        expect(errorText(last)).toMatch(/File Too Large/);
        expect(errorText(last)).toContain('50.00 MB');
        expect(spies.get).not.toHaveBeenCalled();
    });

    it('accepts a file of exactly 50 MB', async () => {
        const { last } = await run(attachment({ size: 50 * MB }));
        expect(last.embeds[0].data.title).toBe('✅ Asset Uploaded');
    });
});

describe('bob-upload success', () => {
    it('shows the asset path, uuid and link returned by 1min.ai', async () => {
        const { last } = await run(attachment());
        const { title, fields } = last.embeds[0].data;
        expect(title).toBe('✅ Asset Uploaded');
        const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
        expect(byName['📁 File Name']).toBe('call.mp3');
        expect(byName['📦 Size']).toBe(`${(2048).toLocaleString()} bytes`);
        expect(byName['🆔 UUID']).toBe('uuid-123');
        expect(byName['🔑 Asset Path']).toBe('`audio/call-123.mp3`');
        expect(byName['🔗 Direct URL']).toBe('https://asset.1min.ai/call.mp3');
        expect(last.content).toBeNull();
    });

    it('omits the direct URL when the API does not return a location', async () => {
        const { last } = await run(attachment(), {
            post: () => Promise.resolve({ data: { asset: { originalname: 'a.mp3' }, fileContent: { path: 'p/a.mp3' } } })
        });
        expect(last.embeds[0].data.fields.map((f) => f.name)).not.toContain('🔗 Direct URL');
    });

    it('sends the API key and the file as multipart to the 1min.ai asset endpoint', async () => {
        const { spies } = await run(attachment());
        const [url, form, config] = spies.post.mock.calls[0];
        expect(url).toBe('https://api.1min.ai/api/assets');
        expect(config.headers['API-KEY']).toBe(API_KEY);
        expect(config.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
        const body = form.getBuffer().toString('latin1');
        expect(body).toContain('name="asset"');
        expect(body).toContain('filename="call.mp3"');
        expect(body).toContain('Content-Type: audio/mpeg');
    });

    it('sanitizes the filename sent upstream', async () => {
        const { spies } = await run(attachment({ name: '../../etc/pass wd;rm.mp3' }));
        const filename = /filename="([^"]*)"/.exec(spies.post.mock.calls[0][1].getBuffer().toString('latin1'))[1];
        expect(filename).not.toMatch(/[/\;\s]|\.\./);
        expect(filename.endsWith('.mp3')).toBe(true);
    });

    it('downloads the attachment through the SSRF-safe axios config', async () => {
        const { spies } = await run(attachment());
        const config = spies.get.mock.calls[0][1];
        const safe = ssrf.getSafeAxiosConfig();
        expect(config.httpAgent?.constructor).toBe(safe.httpAgent.constructor);
        expect(config.httpsAgent?.constructor).toBe(safe.httpsAgent.constructor);
        expect(config.maxContentLength).toBe(50 * MB);
    });

    it('does not send the API key to the attachment host', async () => {
        const { spies } = await run(attachment());
        expect(JSON.stringify(spies.get.mock.calls[0])).not.toContain(API_KEY);
    });
});

describe('bob-upload upstream failures', () => {
    const apiError = (status, data = {}) =>
        Object.assign(new Error(`Request failed with status code ${status} (key ${API_KEY})`), { response: { status, data } });

    it.each([
        [401, /Unauthorized/],
        [413, /Payload Too Large/],
        [429, /Rate Limited/],
        [400, /Bad Request/],
        [503, /API Error \(503\)/]
    ])('maps HTTP %i to a readable message', async (status, pattern) => {
        const { last } = await run(attachment(), { post: () => Promise.reject(apiError(status)) });
        expect(last.content).toMatch(/Upload Failed/);
        expect(last.content).toMatch(pattern);
        expect(last.content).not.toContain(API_KEY);
        expect(last.content).not.toContain('Request failed with status code');
    });

    it.each([
        ['ECONNABORTED', /Timeout/],
        ['ENOTFOUND', /Network Error/],
        ['ECONNREFUSED', /Network Error/]
    ])('maps %s to a readable message', async (code, pattern) => {
        const { last } = await run(attachment(), { post: () => Promise.reject(Object.assign(new Error('x'), { code })) });
        expect(last.content).toMatch(pattern);
    });

    it('reports a failed download as an upload failure without posting', async () => {
        const { last, spies } = await run(attachment(), { get: () => Promise.reject(apiError(404)) });
        expect(last.content).toMatch(/Upload Failed/);
        expect(spies.post).not.toHaveBeenCalled();
    });

    it('does not expose the internal error message for unexpected failures', async () => {
        const { last } = await run(attachment(), {
            post: () => Promise.reject(new Error(`socket hang up at 10.0.0.5 key=${API_KEY}`))
        });
        expect(last.content).toMatch(/Upload Failed/);
        expect(last.content).not.toContain(API_KEY);
        expect(last.content).not.toContain('10.0.0.5');
    });

    it('neutralizes mass mentions in error text relayed from the API', async () => {
        const { last } = await run(attachment(), {
            post: () => Promise.reject(apiError(400, { message: '@everyone bad file' }))
        });
        expect(last.content).not.toMatch(/@everyone/i);
    });

    it('does not expose internal response-validation errors when the API reply is malformed', async () => {
        const { last } = await run(attachment(), { post: () => Promise.resolve({ data: {} }) });
        expect(last.content).toMatch(/Upload Failed/);
        expect(last.content).not.toMatch(/fileContent\.path/);
    });
});
