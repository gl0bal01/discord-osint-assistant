import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bcdetect-test-'));
process.env.REPORTS_DIR = path.join(tmpRoot, 'reports');
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client-id';

const BTC_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BTC_LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const ETH = '0x742d35Cc6634C0532925a3b8D3Ac0C4ad5d0B78a';
const DOGE = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';

let cmd, getSpy, saveSpy;

beforeAll(() => {
    const reports = require('../../utils/reports.js');
    const realSave = reports.saveReport;
    saveSpy = vi.spyOn(reports, 'saveReport').mockImplementation(realSave);
    getSpy = vi.spyOn(require('axios'), 'get');
    cmd = require('../../commands/blockchain-detect.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
    saveSpy.mockClear();
});

function makeInteraction({ address, detailed = null, all = null }) {
    const replies = [];
    const fileContents = {};
    return {
        replies,
        fileContents,
        options: {
            getString: (k) => (k === 'address' ? address : null),
            getBoolean: (k) => ({ detailed, 'all-matches': all })[k] ?? null
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(async (p) => {
            replies.push(p);
            for (const f of p?.files ?? []) fileContents[f.name] = f.attachment.toString('utf8');
        })
    };
}
const last = (i) => i.replies.at(-1);
const edata = (i) => last(i).embeds[0].data;
const field = (i, needle) => edata(i).fields.find((f) => f.name.includes(needle));

describe('bob-blockchain-detect: input validation', () => {
    it('declares the 200 character cap on the address option', () => {
        const opt = cmd.data.toJSON().options.find((o) => o.name === 'address');
        expect(opt.max_length).toBe(200);
    });

    it.each(['', 'short', '<>;|&`$()'])('rejects %j as too short and does no analysis', async (address) => {
        const i = makeInteraction({ address });
        await cmd.execute(i);
        expect(last(i).content).toMatch(/Invalid Address Format/);
        expect(last(i).embeds).toBeUndefined();
    });

    it('rejects an address longer than 200 characters', async () => {
        const i = makeInteraction({ address: 'a'.repeat(201) });
        await cmd.execute(i);
        expect(last(i).content).toMatch(/Address Too Long/);
    });

    it('never makes a network request', async () => {
        await cmd.execute(makeInteraction({ address: ETH }));
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('bob-blockchain-detect: detection', () => {
    it('identifies a bech32 address as Bitcoin with high confidence and a single-match view', async () => {
        const i = makeInteraction({ address: BTC_BECH32 });
        await cmd.execute(i);
        expect(field(i, 'Detected Blockchain').value).toBe('**Bitcoin** (BTC)');
        expect(field(i, 'Confidence').value).toBe('95%');
        expect(field(i, 'Block Explorer').value).toContain(`https://blockstream.info/address/${BTC_BECH32}`);
    });

    it('identifies a Dogecoin address', async () => {
        const i = makeInteraction({ address: DOGE });
        await cmd.execute(i);
        expect(field(i, 'Top Matches').value.startsWith('1. **Dogecoin** (DOGE) - 90%')).toBe(true);
    });

    it('lists Ethereum, BSC and Polygon for an EVM address and warns they are indistinguishable', async () => {
        const i = makeInteraction({ address: ETH });
        await cmd.execute(i);
        const top = field(i, 'Top Matches').value;
        for (const name of ['Ethereum', 'Binance Smart Chain', 'Polygon']) expect(top).toContain(name);
        expect(field(i, 'EVM Networks Detected').value).toMatch(/3 EVM-compatible networks/);
    });

    it('ranks Bitcoin first for a legacy address shared with Bitcoin Cash', async () => {
        const i = makeInteraction({ address: BTC_LEGACY });
        await cmd.execute(i);
        expect(field(i, 'Top Matches').value.startsWith('1. **Bitcoin** (BTC)')).toBe(true);
    });

    it('says no match was found for an unrecognised format', async () => {
        const i = makeInteraction({ address: 'not-a-real-address-123' });
        await cmd.execute(i);
        expect(field(i, 'No Matches Found')).toBeDefined();
    });

    it('sends no files unless detailed is requested', async () => {
        const i = makeInteraction({ address: ETH });
        await cmd.execute(i);
        expect(last(i).files).toBeUndefined();
        expect(saveSpy).not.toHaveBeenCalled();
    });
});

describe('bob-blockchain-detect: detailed report', () => {
    it('attaches a text report and archives a copy', async () => {
        const i = makeInteraction({ address: BTC_BECH32, detailed: true });
        await cmd.execute(i);

        expect(last(i).files).toHaveLength(1);
        const [name, text] = Object.entries(i.fileContents)[0];
        expect(name).toMatch(/^blockchain_detection_bc1qw508d6_\d+\.txt$/);
        expect(text).toContain(`# Address: ${BTC_BECH32}`);
        expect(text).toContain('### 1. Bitcoin (BTC)');
        expect(field(i, 'Technical Details').value).toContain(`**Length:** ${BTC_BECH32.length} characters`);
        expect(saveSpy).toHaveBeenCalledTimes(1);
        const saved = fs.readdirSync(process.env.REPORTS_DIR);
        expect(saved.some((f) => f.startsWith('blockchain-detect_'))).toBe(true);
    });

    it('gives a generic failure message, hiding the cause, when the report cannot be built', async () => {
        saveSpy.mockRejectedValueOnce(new Error('EACCES /srv/secret/reports'));
        const i = makeInteraction({ address: ETH, detailed: true });
        await expect(cmd.execute(i)).resolves.not.toThrow();
        expect(last(i).content).toMatch(/Detection Failed/);
        expect(last(i).content).not.toContain('/srv/secret');
    });
});

describe('bob-blockchain-detect: untrusted address text', () => {
    it('strips markdown/shell metacharacters so the address cannot break out of the code span', async () => {
        const i = makeInteraction({ address: '`x`[click](http://evil)<b>' + ETH });
        await cmd.execute(i);
        const desc = edata(i).description;
        expect(desc).toMatch(/^Analysis of address: `[^`]*`$/);
        expect(desc).not.toMatch(/[<>\[\]()]/);
    });

    it('keeps an @everyone address inside the embed, never in message content', async () => {
        const i = makeInteraction({ address: '@everyone-and-more-text' });
        await cmd.execute(i);
        expect(last(i).content).toBeUndefined();
        expect(edata(i).description).toContain('@everyone-and-more-text');
    });
});
