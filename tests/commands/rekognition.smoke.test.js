import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Offline by construction: vi.mock cannot intercept require() inside the CJS command, so
//  - the AWS SDK client is stubbed by spying on RekognitionClient.prototype.send,
//  - axios.get is spied on (the command calls it at call time),
//  - validateUrlNotInternal (destructured at load) is replaced before the first require,
//  - the command's hard-coded <repo>/temp directory is replaced by an in-memory file map.
let cmd;
let axios;
let ssrf;
let realValidate;
let RekognitionClient;
let send;

const TEMP = path.resolve(import.meta.dirname, '../../temp');
const inTemp = (p) => typeof p === 'string' && (p === TEMP || p.startsWith(TEMP + path.sep));
const vfs = new Map(); // absolute path -> { data: Buffer, mtime: number }
const realFs = {};

const validate = vi.fn(() => Promise.reject(new Error('unstubbed validateUrlNotInternal')));

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIATESTKEY');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-aws-secret');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    ssrf = require('../../utils/ssrf.js');
    realValidate = ssrf.validateUrlNotInternal;
    ssrf.validateUrlNotInternal = validate;
    axios = require('axios');
    ({ RekognitionClient } = require('@aws-sdk/client-rekognition'));
    for (const m of ['existsSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'readdirSync', 'statSync', 'unlinkSync']) {
        realFs[m] = fs[m].bind(fs);
    }
    cmd = require('../../commands/rekognition.js');
});

afterAll(() => {
    ssrf.validateUrlNotInternal = realValidate;
    vi.unstubAllEnvs();
});

beforeEach(() => {
    vfs.clear();
    validate.mockResolvedValue(undefined);
    send = vi.spyOn(RekognitionClient.prototype, 'send').mockRejectedValue(new Error('unstubbed Rekognition send'));
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('unstubbed axios.get'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('unstubbed axios.post'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => (p === TEMP ? true : inTemp(p) ? vfs.has(p) : realFs.existsSync(p)));
    vi.spyOn(fs, 'mkdirSync').mockImplementation((p, ...a) => (inTemp(p) ? undefined : realFs.mkdirSync(p, ...a)));
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, d, ...a) => {
        if (!inTemp(p)) return realFs.writeFileSync(p, d, ...a);
        vfs.set(p, { data: Buffer.from(d), mtime: Date.now() });
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => {
        if (!inTemp(p)) return realFs.readFileSync(p, ...a);
        if (!vfs.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return vfs.get(p).data;
    });
    vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...a) =>
        p === TEMP ? [...vfs.keys()].map((k) => path.basename(k)) : realFs.readdirSync(p, ...a));
    vi.spyOn(fs, 'statSync').mockImplementation((p, ...a) =>
        inTemp(p) ? { mtime: new Date(vfs.get(p).mtime) } : realFs.statSync(p, ...a));
    vi.spyOn(fs, 'unlinkSync').mockImplementation((p) => (inTemp(p) ? vfs.delete(p) : realFs.unlinkSync(p)));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const attachment = (over = {}) => ({
    url: 'https://cdn.discordapp.com/attachments/1/2/face.jpg',
    name: 'face.jpg',
    size: 1024,
    contentType: 'image/jpeg',
    ...over
});

function makeInteraction(options = {}) {
    return {
        options: {
            getSubcommand: () => options.__subcommand ?? 'analyze',
            getString: (k) => options[k] ?? null,
            getNumber: (k) => options[k] ?? null,
            getAttachment: (k) => options[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
}

// Fake setTimeout and Date so the command's delayed cleanup runs on demand, with realistic file ages
async function run(options) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const interaction = makeInteraction(options);
    await expect(cmd.execute(interaction)).resolves.not.toThrow();
    const last = interaction.editReply.mock.calls.at(-1)[0];
    const embed = typeof last === 'object' ? last.embeds?.[0]?.data : undefined;
    const fields = Object.fromEntries((embed?.fields ?? []).map((f) => [f.name, f.value]));
    return { interaction, last, embed, fields };
}

const downloadOk = (data = JPEG, type = 'image/jpeg') => axios.get.mockResolvedValue({ data, headers: { 'content-type': type } });
const AWS_RESULTS = {
    DetectLabelsCommand: { Labels: [{ Name: 'Face', Confidence: 88.25 }, { Name: 'Person', Confidence: 99.5 }] },
    DetectTextCommand: { TextDetections: [{ Type: 'LINE', DetectedText: 'STOP' }, { Type: 'WORD', DetectedText: 'STOP' }] },
    DetectFacesCommand: { FaceDetails: [{ Gender: { Value: 'Female', Confidence: 97.1 }, AgeRange: { Low: 25, High: 35 }, Emotions: [{ Type: 'CALM', Confidence: 90 }] }] },
    DetectModerationLabelsCommand: { ModerationLabels: [{ Name: 'Suggestive', Confidence: 71.2 }] },
    RecognizeCelebritiesCommand: { CelebrityFaces: [{ Name: 'Jane Roe', MatchConfidence: 99.1 }] },
    CompareFacesCommand: { FaceMatches: [{ Similarity: 95.54 }], UnmatchedFaces: [] }
};
const awsReturns = (overrides = {}) =>
    send.mockImplementation((command) => Promise.resolve({ ...AWS_RESULTS, ...overrides }[command.constructor.name]));
const sentCommands = () => send.mock.calls.map(([c]) => c.constructor.name);
const GENERIC = 'An error occurred while processing your request.';

describe('bob-rekognition module', () => {
    it('exports /bob-rekognition with analyze and compare subcommands', () => {
        expect(cmd.data.name).toBe('bob-rekognition');
        expect(cmd.data.toJSON().options.map((o) => o.name)).toEqual(['analyze', 'compare']);
    });
});

describe('bob-rekognition input validation', () => {
    it('refuses to run without AWS credentials and never calls AWS', async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', '');
        const { last, interaction } = await run({ image: attachment() });
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(last).toMatch(/AWS credentials are not properly configured/);
        expect(send).not.toHaveBeenCalled();
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIATESTKEY');
    });

    it('asks for an image or URL when analyze gets neither', async () => {
        const { last } = await run({});
        expect(last).toBe('Please provide either an image URL or upload an image.');
        expect(send).not.toHaveBeenCalled();
    });

    it('rejects an attachment that is not an image without downloading it', async () => {
        const { last } = await run({ image: attachment({ contentType: 'application/pdf', name: 'a.pdf' }) });
        expect(last).toMatch(/not an image/);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects a non-http image URL before any request', async () => {
        const { last } = await run({ url: 'ftp://example.com/a.jpg' });
        expect(last).toBe('Please provide a valid image URL starting with http:// or https://');
        expect(validate).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('refuses an internal image URL through the SSRF check and hides the reason', async () => {
        validate.mockRejectedValue(new Error('resolves to 10.0.0.5'));
        const { last } = await run({ url: 'http://10.0.0.5/a.jpg' });
        expect(validate).toHaveBeenCalledWith('http://10.0.0.5/a.jpg');
        expect(axios.get).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(last).toBe(GENERIC);
    });
});

describe('bob-rekognition analyze', () => {
    it('sends the downloaded attachment bytes to DetectLabels and reports the top labels', async () => {
        downloadOk();
        awsReturns();
        const { last, embed, fields } = await run({ image: attachment(), features: 'labels' });
        expect(sentCommands()).toEqual(['DetectLabelsCommand']);
        const input = send.mock.calls[0][0].input;
        expect(Buffer.compare(input.Image.Bytes, JPEG)).toBe(0);
        expect(input.MinConfidence).toBe(70);
        expect(embed.title).toBe('AWS Rekognition Analysis Results');
        expect(embed.description).toBe('Analysis of uploaded image (face.jpg)');
        expect(fields['🏷️ Top Labels']).toBe('Person (99.5%), Face (88.3%)');
        expect(last.content).toBe('AWS Rekognition analysis complete!');
        expect(last.files.map((f) => f.name)).toEqual(['rekognition_analysis.json', 'face.jpg']);
    });

    it('downloads the attachment through the SSRF-safe axios config', async () => {
        downloadOk();
        awsReturns();
        await run({ image: attachment(), features: 'labels' });
        const [url, config] = axios.get.mock.calls[0];
        expect(url).toBe('https://cdn.discordapp.com/attachments/1/2/face.jpg');
        expect(config.httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
        expect(config.httpsAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpsAgent);
        expect(config.responseType).toBe('arraybuffer');
    });

    it('runs all five detectors by default and summarizes each result', async () => {
        downloadOk();
        awsReturns();
        const { fields, embed } = await run({ image: attachment() });
        expect(sentCommands().sort()).toEqual([
            'DetectFacesCommand', 'DetectLabelsCommand', 'DetectModerationLabelsCommand',
            'DetectTextCommand', 'RecognizeCelebritiesCommand'
        ]);
        expect(embed.title).toBe('AWS Rekognition Analysis Results');
        expect(fields['📝 Detected Text']).toBe('STOP');
        expect(fields['😀 Faces Detected (1)']).toBe('Face 1: Female (97.1%), Age 25-35, CALM (90.0%)');
        expect(fields['🌟 Celebrities Detected']).toBe('Jane Roe (99.1%)');
        expect(fields['⚠️ Moderation Labels']).toBe('Suggestive (71.2%)');
    });

    it('validates a URL, downloads it and analyzes the image', async () => {
        downloadOk();
        awsReturns();
        const { fields, last } = await run({ url: 'https://example.com/pic.png', features: 'labels' });
        expect(validate).toHaveBeenCalledWith('https://example.com/pic.png');
        expect(axios.get.mock.calls[0][0]).toBe('https://example.com/pic.png');
        expect(axios.get.mock.calls[0][1].httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
        expect(fields['🏷️ Top Labels']).toContain('Person (99.5%)');
        expect(last.files[1].name).toMatch(/^image_[0-9a-f]{16}\.png$/);
    });

    it('treats a URL that does not return an image as an error', async () => {
        downloadOk(Buffer.from('<html>'), 'text/html');
        const { last } = await run({ url: 'https://example.com/page' });
        expect(last).toBe(GENERIC);
        expect(send).not.toHaveBeenCalled();
    });

    it('hides download failures behind the generic message', async () => {
        axios.get.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.9 AKIATESTKEY'));
        const { last } = await run({ image: attachment() });
        expect(last).toBe(GENERIC);
        expect(send).not.toHaveBeenCalled();
    });

    it('writes the attachment under temp/ even when its name tries to traverse', async () => {
        downloadOk();
        awsReturns();
        await run({ image: attachment({ name: '../../evil.jpg' }), features: 'labels' });
        const written = fs.writeFileSync.mock.calls.map(([p]) => p).filter(inTemp);
        expect(written.length).toBeGreaterThan(0);
        expect(written.every((p) => path.dirname(p) === TEMP)).toBe(true);
    });

    it('gives concurrent uploads of the same filename different temp paths', async () => {
        downloadOk();
        awsReturns();
        await run({ image: attachment({ name: 'face.jpg' }), features: 'labels' });
        await run({ image: attachment({ name: 'face.jpg' }), features: 'labels' });
        const originals = fs.writeFileSync.mock.calls.map(([p]) => p).filter((p) => inTemp(p) && path.basename(p).startsWith('original_'));
        expect(originals).toHaveLength(2);
        expect(originals[0]).not.toBe(originals[1]);
        expect(path.basename(originals[0])).toMatch(/^original_[0-9a-f]{8}_face\.jpg$/);
    });

    it.each([
        ['InvalidImageFormatException', /invalid format/],
        ['InvalidParameterException', /Invalid parameter/],
        ['ImageTooLargeException', /too large/],
        ['AccessDeniedException', /access denied/]
    ])('explains AWS %s in plain words', async (code, pattern) => {
        downloadOk();
        send.mockRejectedValue(Object.assign(new Error(`${code}: raw AWS text AKIATESTKEY`), { code }));
        const { last } = await run({ image: attachment(), features: 'labels' });
        expect(last).toMatch(pattern);
        expect(last).not.toMatch(/raw AWS text|AKIATESTKEY/);
    });

    it('hides unknown AWS errors behind the generic message', async () => {
        downloadOk();
        send.mockRejectedValue(new Error('ThrottlingException at arn:aws:iam::123456789012:user/bot'));
        const { last } = await run({ image: attachment(), features: 'labels' });
        expect(last).toBe(GENERIC);
    });
});

describe('bob-rekognition compare', () => {
    const compareOpts = (extra = {}) => ({
        __subcommand: 'compare',
        source_image: attachment({ name: 'a.jpg' }),
        target_image: attachment({ name: 'b.jpg' }),
        ...extra
    });

    it.each([
        ['source', { source_image: null }, /source image/],
        ['target', { target_image: null }, /target image/]
    ])('asks for the %s image when it is missing', async (_which, extra, pattern) => {
        const { last } = await run(compareOpts(extra));
        expect(last).toMatch(pattern);
        expect(send).not.toHaveBeenCalled();
    });

    it.each([-1, 101])('rejects a similarity threshold of %i', async (similarity) => {
        const { last } = await run(compareOpts({ similarity }));
        expect(last).toBe('Similarity threshold must be between 0 and 100.');
        expect(send).not.toHaveBeenCalled();
    });

    it('compares the two images at the requested threshold and lists the matches', async () => {
        downloadOk();
        awsReturns();
        const { embed, fields, last } = await run(compareOpts({ similarity: 90 }));
        expect(send.mock.calls[0][0].constructor.name).toBe('CompareFacesCommand');
        expect(send.mock.calls[0][0].input.SimilarityThreshold).toBe(90);
        expect(embed.title).toBe('Face Comparison Results');
        expect(embed.description).toContain('90% similarity threshold');
        expect(fields['✅ Matched Faces (1)']).toBe('Match 1: 95.5% similarity');
        expect(last.content).toBe('Face comparison complete!');
        expect(last.files.map((f) => f.name)).toEqual(['face_comparison_report.json', 'source_a.jpg', 'target_b.jpg']);
    });

    it('defaults to an 80% threshold', async () => {
        downloadOk();
        awsReturns();
        await run(compareOpts());
        expect(send.mock.calls[0][0].input.SimilarityThreshold).toBe(80);
    });

    it('says when no faces matched and counts unmatched faces', async () => {
        downloadOk();
        awsReturns({ CompareFacesCommand: { FaceMatches: [], UnmatchedFaces: [{}, {}] } });
        const { fields } = await run(compareOpts());
        expect(fields['❌ No Matching Faces']).toMatch(/No faces matched/);
        expect(fields['ℹ️ Unmatched Faces (2)']).toBe('2 faces in the target image did not match the source face.');
    });

    it('validates and downloads URL inputs for both images', async () => {
        downloadOk();
        awsReturns();
        await run({ __subcommand: 'compare', source_url: 'https://example.com/s.jpg', target_url: 'https://example.com/t.jpg' });
        expect(validate.mock.calls.map((c) => c[0])).toEqual(['https://example.com/s.jpg', 'https://example.com/t.jpg']);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('explains when AWS finds no face in an image', async () => {
        downloadOk();
        send.mockRejectedValue(Object.assign(new Error('There are no face in the image'), { code: 'InvalidParameterException' }));
        const { last } = await run(compareOpts());
        expect(last).toMatch(/No faces detected in one or both/);
    });

    it('honors a similarity threshold of 0', async () => {
        downloadOk();
        awsReturns();
        await run(compareOpts({ similarity: 0 }));
        expect(send.mock.calls[0][0].input.SimilarityThreshold).toBe(0);
    });
});

describe('bob-rekognition temp file cleanup', () => {
    it('deletes this command\'s stale files after the delay and leaves unrelated files alone', async () => {
        downloadOk();
        awsReturns();
        const old = Date.now() - 60_000;
        vfs.set(path.join(TEMP, 'rekognition_old.json'), { data: Buffer.from('{}'), mtime: old });
        vfs.set(path.join(TEMP, 'original_old.jpg'), { data: Buffer.from('x'), mtime: old });
        vfs.set(path.join(TEMP, 'notes.txt'), { data: Buffer.from('keep'), mtime: old });
        await run({ image: attachment(), features: 'labels' });
        await vi.advanceTimersByTimeAsync(5000);
        const left = [...vfs.keys()].map((p) => path.basename(p));
        expect(left).not.toContain('rekognition_old.json');
        expect(left).not.toContain('original_old.jpg');
        expect(left).toContain('notes.txt');
    });

    it('removes the image and report it created for this run', async () => {
        downloadOk();
        awsReturns();
        await run({ image: attachment(), features: 'labels' });
        expect(fs.writeFileSync.mock.calls.filter(([p]) => inTemp(p)).length).toBeGreaterThan(1);
        await vi.advanceTimersByTimeAsync(5000);
        expect([...vfs.keys()].map((p) => path.basename(p))).toEqual([]);
    });
});
