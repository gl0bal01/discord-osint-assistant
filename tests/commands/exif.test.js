import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exif-test-'));
process.env.REPORTS_DIR = path.join(tmp, 'archive');
const SECRET = 'SECRET_INTERNAL_DETAIL';
const coded = (message, code) => Object.assign(new Error(message), { code });
const URL_OK = 'https://cdn.example.com/photos/IMG_0001.jpg';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

let cmd, axios, spawn, ssrf, imgFiles;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(): spy before the command destructures its imports
    spawn = vi.spyOn(require('../../utils/process.js'), 'safeSpawn');
    ssrf = vi.spyOn(require('../../utils/ssrf.js'), 'validateUrlNotInternal');
    let n = 0;
    imgFiles = [];
    fs.mkdirSync(path.join(tmp, 'out'), { recursive: true });
    vi.spyOn(require('../../utils/temp.js'), 'tempFilePath').mockImplementation((prefix, ext = 'txt') => {
        const f = path.join(tmp, 'out', `${prefix}_${n++}.${ext}`);
        imgFiles.push(f);
        return f;
    });
    axios = require('axios');
    cmd = require('../../commands/exif.js');
});

beforeEach(() => {
    imgFiles.length = 0;
    spawn.mockReset();
    spawn.mockRejectedValue(new Error('unstubbed safeSpawn'));
    ssrf.mockReset();
    ssrf.mockRejectedValue(new Error('unstubbed validateUrlNotInternal'));
    vi.spyOn(axios, 'get').mockReset();
    axios.get.mockRejectedValue(new Error('unstubbed axios.get'));
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

function makeInteraction(options = {}) {
    const i = {
        user: { id: 'u1', tag: 'user#0001' },
        deferred: false,
        options: {
            getString: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn(async () => { i.deferred = true; }),
        editReply: vi.fn().mockResolvedValue(undefined)
    };
    return i;
}

const lastReply = (i) => (i.editReply.mock.calls.at(-1) ?? i.reply.mock.calls.at(-1))[0];
const serveImage = (body = JPEG, headers = { 'content-type': 'image/jpeg' }) =>
    axios.get.mockResolvedValue({ headers, data: Readable.from([body]) });
const exiftool = (meta) => spawn.mockResolvedValue({ stdout: JSON.stringify([meta]), stderr: '', code: 0 });
const allowUrl = () => ssrf.mockResolvedValue(undefined);

const META = {
    SourceFile: '/tmp/x.jpg',
    ExifToolVersion: 12.76,
    Make: 'Canon',
    Model: 'Canon EOS 5D',
    ISO: 100,
    SerialNumber: '0123456789',
    Artist: 'Jane Roe',
    GPSLatitude: '48 deg 51\' 30.00" N',
    GPSLongitude: '2 deg 17\' 40.00" E',
    GoogleMapsUrl: 'https://maps.google.com/?q=48.85,2.29',
    OpenStreetMapsUrl: 'https://www.openstreetmap.org/?mlat=48.85&mlon=2.29'
};

describe('bob-exif input validation', () => {
    it.each(['not a url', 'ftp://example.com/a.jpg', 'javascript:alert(1)'])('rejects %j as an invalid URL', async (url) => {
        const i = makeInteraction({ url });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('Invalid URL Format');
        expect(ssrf).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('rejects plain http without fetching', async () => {
        const i = makeInteraction({ url: 'http://example.com/a.jpg' });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('URL Validation Failed');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('bob-exif SSRF protection', () => {
    it('checks the URL for internal targets before downloading', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK }));
        expect(ssrf).toHaveBeenCalledWith(URL_OK);
        expect(ssrf.mock.invocationCallOrder[0]).toBeLessThan(axios.get.mock.invocationCallOrder[0]);
    });

    it('refuses an internal URL without fetching or leaking the reason', async () => {
        ssrf.mockRejectedValue(new Error(`resolves to private IP ${SECRET}`));
        const i = makeInteraction({ url: 'https://internal.example.com/a.jpg' });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('URL Not Allowed');
        expect(lastReply(i).content).not.toContain(SECRET);
        expect(axios.get).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
    });

    it('downloads with the DNS-rebinding-safe agents', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK }));
        const cfg = axios.get.mock.calls[0][1];
        expect(cfg.httpsAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpsAgent);
        expect(cfg.httpAgent).toBe(require('../../utils/ssrf.js').getSafeAxiosConfig().httpAgent);
    });
});

describe('bob-exif extraction', () => {
    it('attaches the metadata and links GPS locations', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        const i = makeInteraction({ url: URL_OK });
        await cmd.execute(i);
        const reply = lastReply(i);
        expect(reply.content).toContain('GPS Data Found');
        expect(reply.content).toContain('[Google Maps](<https://maps.google.com/?q=48.85,2.29>)');
        expect(reply.content).toContain('[OpenStreetMap](<https://www.openstreetmap.org/?mlat=48.85&mlon=2.29>)');
        expect(reply.files[0].name).toBe('exif_metadata.txt');
        const body = reply.files[0].attachment.toString();
        expect(body).toContain('=== Camera Information ===');
        expect(body).toContain('Make: Canon');
        expect(body).toContain('SerialNumber: 0123456789');
    });

    it('redacts sensitive fields in privacy mode', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        const i = makeInteraction({ url: URL_OK, 'privacy-mode': true });
        await cmd.execute(i);
        const body = lastReply(i).files[0].attachment.toString();
        expect(body).toContain('SerialNumber: [REDACTED]');
        expect(body).toContain('Artist: [REDACTED]');
        expect(body).not.toContain('0123456789');
        expect(body).not.toContain('Jane Roe');
        expect(body).toContain('Make: Canon');
    });

    it('says when the image has no metadata', async () => {
        allowUrl();
        serveImage();
        exiftool({ SourceFile: '/tmp/x.jpg', ExifToolVersion: 12.76 });
        const i = makeInteraction({ url: URL_OK });
        await cmd.execute(i);
        expect(lastReply(i).files[0].attachment.toString()).toBe('No EXIF metadata found in the image.');
        expect(lastReply(i).content).not.toContain('GPS Data Found');
    });

    it('passes the local file, never the URL, to exiftool as separate argv elements', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK }));
        const [, args, opts] = spawn.mock.calls[0];
        expect(args.at(-1)).toBe(imgFiles[0]);
        expect(args).toContain('-json');
        expect(args.join(' ')).not.toContain('cdn.example.com');
        expect(opts.timeout).toBe(30_000);
    });

    it('limits exiftool to essential tag groups when detailed is false', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK, detailed: false }));
        expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-EXIF:*', '-GPS:*']));
    });

    it('extracts all tags by default', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK }));
        expect(spawn.mock.calls[0][1]).not.toContain('-EXIF:*');
    });

    it('stores the file extension of the URL on the temp file', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: 'https://cdn.example.com/a/pic.PNG' }));
        expect(imgFiles[0]).toMatch(/\.png$/);
    });
});

describe('bob-exif failures', () => {
    it('refuses content that is not an image and does not run exiftool', async () => {
        allowUrl();
        serveImage(Buffer.from('<html>not an image</html>'), { 'content-type': 'text/html' });
        const i = makeInteraction({ url: URL_OK });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('Invalid Image File');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('refuses an empty download', async () => {
        allowUrl();
        serveImage(Buffer.alloc(0));
        const i = makeInteraction({ url: URL_OK });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastReply(i).content).toContain('EXIF Extraction Failed');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('refuses an advertised size over 50MB', async () => {
        allowUrl();
        serveImage(JPEG, { 'content-type': 'image/jpeg', 'content-length': String(60 * 1024 * 1024) });
        const i = makeInteraction({ url: URL_OK });
        await cmd.execute(i);
        expect(lastReply(i).content).toContain('too large');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('shows a download message without the underlying error', async () => {
        allowUrl();
        axios.get.mockRejectedValue(new axios.AxiosError(
            `Request failed with status code 404 ${SECRET}`, 'ERR_BAD_REQUEST', {}, {}, { status: 404, data: SECRET }
        ));
        const i = makeInteraction({ url: URL_OK });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastReply(i).content).toContain('Failed to download image');
        expect(lastReply(i).content).not.toContain(SECRET);
    });

    it('passes a signed URL with & ; ( ) $ \' to axios unchanged', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        const signed = "https://cdn.example.com/p/a.jpg?X-Amz=a&b=(1);c=$d&e='f'";
        await cmd.execute(makeInteraction({ url: signed }));
        expect(ssrf).toHaveBeenCalledWith(signed);
        expect(axios.get.mock.calls[0][0]).toBe(signed);
    });

    it('tells the user exiftool is missing, without the underlying error', async () => {
        allowUrl();
        serveImage();
        spawn.mockRejectedValue(coded(`Failed to start process: spawn exiftool ENOENT ${SECRET}`, 'ENOENT'));
        const i = makeInteraction({ url: URL_OK });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastReply(i).content).toContain('ExifTool is not installed');
        expect(lastReply(i).content).not.toContain(SECRET);
    });

    it('shows a generic message when exiftool prints something unparsable', async () => {
        allowUrl();
        serveImage();
        spawn.mockResolvedValue({ stdout: `Error: ${SECRET}`, stderr: '', code: 1 });
        const i = makeInteraction({ url: URL_OK });
        await expect(cmd.execute(i)).resolves.toBeUndefined();
        expect(lastReply(i).content).toContain('EXIF Extraction Failed');
        expect(lastReply(i).content).not.toContain(SECRET);
    });
    it('tells the user when exiftool times out', async () => {
        allowUrl();
        serveImage();
        spawn.mockRejectedValue(coded('Process timed out after 30 seconds', 'ETIMEDOUT'));
        const i = makeInteraction({ url: URL_OK });
        await cmd.execute(i);
        expect(lastReply(i).content).toMatch(/timed out/i);
    });
});

describe('bob-exif cleanup', () => {
    it('removes the downloaded image after a successful run', async () => {
        allowUrl();
        serveImage();
        exiftool(META);
        await cmd.execute(makeInteraction({ url: URL_OK }));
        expect(imgFiles).toHaveLength(1);
        expect(fs.existsSync(imgFiles[0])).toBe(false);
    });

    it('removes the downloaded image when it is not an image', async () => {
        allowUrl();
        serveImage(Buffer.from('<html>not an image</html>'));
        await cmd.execute(makeInteraction({ url: URL_OK }));
        expect(fs.existsSync(imgFiles[0])).toBe(false);
    });
    it('removes the downloaded image when exiftool fails', async () => {
        allowUrl();
        serveImage();
        spawn.mockRejectedValue(coded('Failed to start process: spawn exiftool ENOENT', 'ENOENT'));
        await cmd.execute(makeInteraction({ url: URL_OK }));
        expect(fs.existsSync(imgFiles[0])).toBe(false);
    });
});
