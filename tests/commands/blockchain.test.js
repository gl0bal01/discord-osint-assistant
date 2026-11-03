import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('fs');

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client-id';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blockchain-test-'));
process.env.REPORTS_DIR = path.join(tmpRoot, 'reports');

const SAFE = { httpAgent: { safe: 'http' }, httpsAgent: { safe: 'https' } };
const REPO_TEMP = path.join(__dirname, '..', '..', 'temp');

const BTC_ADDR = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const ETH_ADDR = '0x742d35Cc6634C0532925a3b8D3Ac0C4ad5d0B78a';
const LTC_ADDR = 'LQ3CWuifM8HcdMhPfCsSKPePX4X47VvxCo';
const DOGE_ADDR = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
const ZEC_ADDR = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs';
const TXID = 'a'.repeat(64);
const HASH = '0'.repeat(20) + 'b'.repeat(44);

let cmd, getSpy, archiveSpy, cleanupSpy, written;

beforeAll(() => {
    process.env.ETHERSCAN_API_KEY = 'k-eth';
    vi.spyOn(require('../../utils/ssrf.js'), 'getSafeAxiosConfig').mockReturnValue(SAFE);
    archiveSpy = vi.spyOn(require('../../utils/reports.js'), 'archiveReport');
    cleanupSpy = vi.spyOn(require('../../utils/temp.js'), 'cleanupFile');
    // The command builds its own path under the repo's temp/. Keep every write out of the repo.
    const realWrite = fs.writeFileSync;
    const realMkdir = fs.mkdirSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data, ...rest) => {
        if (String(p).startsWith(REPO_TEMP)) { written.set(String(p), String(data)); return undefined; }
        return realWrite(p, data, ...rest);
    });
    vi.spyOn(fs, 'mkdirSync').mockImplementation((p, ...rest) => {
        if (String(p) === REPO_TEMP) return undefined;
        return realMkdir(p, ...rest);
    });
    getSpy = vi.spyOn(require('axios'), 'get');
    cmd = require('../../commands/blockchain.js');
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
    written = new Map();
    getSpy.mockReset().mockRejectedValue(new Error('unstubbed axios.get'));
    archiveSpy.mockReset().mockResolvedValue(null);
    cleanupSpy.mockReset().mockResolvedValue(undefined);
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
        editReply: vi.fn(async (p) => {
            replies.push(p);
            for (const f of p?.files ?? []) fileContents[f.name] = written.get(f.attachment);
        })
    };
}
const last = (i) => i.replies.at(-1);
const edata = (i) => last(i).embeds[0].data;
const field = (i, name) => edata(i).fields.find((f) => f.name === name)?.value;
const run = async (sub, opts) => {
    const i = makeInteraction(sub, opts);
    await expect(cmd.execute(i)).resolves.not.toThrow();
    return i;
};
const hex = (n) => `0x${n.toString(16)}`;

describe('bob-blockchain: routing and validation', () => {
    it('rejects an unsupported blockchain without any request', async () => {
        const i = await run('address', { blockchain: 'xyz', address: ETH_ADDR });
        expect(last(i)).toBe("Error: Unsupported blockchain 'xyz'.");
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('rejects testnet for a chain without a testnet and names the supported ones', async () => {
        const i = await run('address', { blockchain: 'zec', address: ZEC_ADDR, network: 'testnet' });
        expect(last(i)).toMatch(/^Testnet is not available for Zcash\. Supported testnets: Ethereum.*Bitcoin/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['btc', ETH_ADDR],
        ['btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf0O'],
        ['eth', '0x742d35Cc6634C0532925a3b8D3Ac0C4ad5d0B78'],
        ['eth', `0x${'g'.repeat(40)}`],
        ['ltc', BTC_ADDR],
        ['doge', BTC_ADDR],
        ['dash', DOGE_ADDR],
        ['zec', BTC_ADDR],
        ['bsc', BTC_ADDR],
        ['matic', 'not-an-address']
    ])('rejects an invalid %s address and makes no request', async (blockchain, address) => {
        const i = await run('address', { blockchain, address });
        expect(last(i)).toMatch(/^Invalid .* address format\. Please check your input\.$/);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('rejects a mainnet Bitcoin address when testnet is selected', async () => {
        const i = await run('address', { blockchain: 'btc', address: BTC_ADDR, network: 'testnet' });
        expect(last(i)).toBe('Invalid Bitcoin (Bitcoin Testnet) address format. Please check your input.');
        expect(getSpy).not.toHaveBeenCalled();
    });

    it.each(['abc', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${TXID}/../x`])(
        'rejects transaction id %j without any request',
        async (txid) => {
            const i = await run('transaction', { blockchain: 'btc', txid });
            expect(last(i)).toBe('Invalid Bitcoin transaction ID format. Please check your input.');
            expect(getSpy).not.toHaveBeenCalled();
        }
    );

    it('trace rejects a non-EVM address without any request', async () => {
        const i = await run('trace', { address: BTC_ADDR, chain: '1' });
        expect(last(i)).toBe('Invalid EVM address. Expected `0x` + 40 hex characters.');
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('does not forward a block value with path or query characters to the provider', async () => {
        getSpy.mockResolvedValue({ data: { height: 1 } });
        const i = await run('block', { blockchain: 'btc', block: '1/../../rawaddr/x?y=1#z' });
        expect(last(i)).toMatch(/^Invalid Bitcoin block\./);
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('bob-blockchain address lookups', () => {
    it('shows a Bitcoin address summary', async () => {
        getSpy.mockResolvedValue({ data: { final_balance: 150000000, total_received: 500000000, total_sent: 350000000, n_tx: 12 } });
        const i = await run('address', { blockchain: 'btc', address: BTC_ADDR });

        expect(getSpy.mock.calls[0][0]).toBe(`https://blockchain.info/rawaddr/${BTC_ADDR}`);
        expect(edata(i).title).toBe('Bitcoin Address Information');
        expect(edata(i).url).toBe(`https://www.blockchain.com/explorer/addresses/btc/${BTC_ADDR}`);
        expect(field(i, 'Balance')).toBe('1.50000000 BTC');
        expect(field(i, 'Total Received')).toBe('5.00000000 BTC');
        expect(field(i, 'Total Sent')).toBe('3.50000000 BTC');
        expect(field(i, 'Transaction Count')).toBe('12');
    });

    it('shows an Ethereum balance using the configured API key', async () => {
        getSpy.mockResolvedValue({ data: { status: '1', message: 'OK', result: '1500000000000000000' } });
        const i = await run('address', { blockchain: 'eth', address: ETH_ADDR });

        const [url, config] = getSpy.mock.calls[0];
        expect(url).toBe('https://api.etherscan.io/v2/api');
        expect(config.params).toMatchObject({ chainid: '1', module: 'account', action: 'balance', address: ETH_ADDR, apikey: 'k-eth' });
        expect(field(i, 'Balance')).toBe('1.50000000 ETH');
    });

    it('explains when a chain needs a paid Etherscan plan, and when no key is set', async () => {
        getSpy.mockResolvedValue({ data: { status: '0', message: 'NOTOK', result: 'Free API access is not supported for this chain. Please upgrade' } });
        let i = await run('address', { blockchain: 'bsc', address: ETH_ADDR });
        expect(last(i)).toMatch(/paid Etherscan API plan/);
        expect(last(i)).not.toMatch(/upgrade/i);

        const key = process.env.ETHERSCAN_API_KEY;
        delete process.env.ETHERSCAN_API_KEY;
        try {
            getSpy.mockClear();
            i = await run('address', { blockchain: 'eth', address: ETH_ADDR });
            expect(last(i)).toMatch(/ETHERSCAN_API_KEY/);
            expect(getSpy).not.toHaveBeenCalled();
        } finally {
            process.env.ETHERSCAN_API_KEY = key;
        }
    });

    it('does not present an Etherscan rate-limit error as an empty wallet', async () => {
        getSpy.mockResolvedValue({ data: { status: '0', message: 'NOTOK', result: 'Max rate limit reached' } });
        const i = await run('address', { blockchain: 'eth', address: ETH_ADDR });
        expect(last(i).embeds).toBeUndefined();
    });

    it.each([
        ['bsc', '56', 'BNB', 'BscScan.com'],
        ['matic', '137', 'MATIC', 'PolygonScan.com']
    ])('queries %s through Etherscan API V2 (chainid %s)', async (blockchain, chainid, symbol, source) => {
        getSpy.mockResolvedValue({ data: { status: '1', result: '2000000000000000000' } });
        const i = await run('address', { blockchain, address: ETH_ADDR });
        expect(getSpy.mock.calls[0][0]).toBe('https://api.etherscan.io/v2/api');
        expect(getSpy.mock.calls[0][1].params).toMatchObject({ chainid, apikey: 'k-eth' });
        expect(field(i, 'Balance')).toBe(`2.00000000 ${symbol}`);
        expect(edata(i).footer.text).toContain(source);
    });

    it('shows a Litecoin address from Blockchair', async () => {
        getSpy.mockResolvedValue({
            data: { data: { [LTC_ADDR]: { address: { balance: 250000000, received: 900000000, spent: 650000000, transaction_count: 7 } } } }
        });
        const i = await run('address', { blockchain: 'ltc', address: LTC_ADDR });
        expect(getSpy.mock.calls[0][0]).toBe(`https://api.blockchair.com/litecoin/dashboards/address/${LTC_ADDR}`);
        expect(field(i, 'Balance')).toBe('2.5 LTC');
        expect(field(i, 'Transaction Count')).toBe('7');
    });

    it('shows a Dogecoin balance from DogeChain', async () => {
        getSpy.mockResolvedValue({ data: { success: 1, balance: '12.5' } });
        const i = await run('address', { blockchain: 'doge', address: DOGE_ADDR });
        expect(getSpy.mock.calls[0][0]).toBe(`https://dogechain.info/api/v1/address/balance/${DOGE_ADDR}`);
        expect(field(i, 'Balance')).toBe('12.50000000 DOGE');
    });

    it('shows a Zcash address from zcha.in', async () => {
        getSpy.mockResolvedValue({ data: { balance: 3.25, totalRecv: 10, totalSent: 6.75, totalTx: 4 } });
        const i = await run('address', { blockchain: 'zec', address: ZEC_ADDR });
        expect(field(i, 'Balance')).toBe('3.25000000 ZEC');
        expect(field(i, 'Transaction Count')).toBe('4');
    });

    it('tells the user when the provider returns no data', async () => {
        getSpy.mockResolvedValue({ data: null });
        const i = await run('address', { blockchain: 'btc', address: BTC_ADDR });
        expect(last(i)).toBe(`No data found for Bitcoin address: ${BTC_ADDR}`);
    });

    it('queries the Bitcoin testnet via Blockchair and labels the network', async () => {
        const tb = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
        getSpy.mockResolvedValue({
            data: { data: { [tb]: { address: { balance: 100000000, received: 100000000, spent: 0, transaction_count: 1 } } } }
        });
        const i = await run('address', { blockchain: 'btc', address: tb, network: 'testnet' });
        expect(getSpy.mock.calls[0][0]).toBe(`https://api.blockchair.com/bitcoin/testnet/dashboards/address/${tb}`);
        expect(edata(i).title).toBe('Bitcoin (Bitcoin Testnet) Address Information');
        expect(edata(i).url).toBe(`https://blockchair.com/bitcoin/testnet/address/${tb}`);
        expect(field(i, 'Balance')).toBe('1 BTC');
    });

    it('queries Sepolia for an Ethereum testnet address', async () => {
        getSpy.mockResolvedValue({ data: { status: '1', result: '1000000000000000000' } });
        const i = await run('address', { blockchain: 'eth', address: ETH_ADDR, network: 'testnet' });
        expect(getSpy.mock.calls[0][0]).toBe('https://api.etherscan.io/v2/api');
        expect(getSpy.mock.calls[0][1].params.chainid).toBe('11155111');
        expect(edata(i).title).toBe('Ethereum (Sepolia) Address Information');
        expect(edata(i).url).toBe(`https://sepolia.etherscan.io/address/${ETH_ADDR}`);
    });

    it('attaches the raw JSON, archives it and schedules its cleanup when full is set', async () => {
        const data = { final_balance: 1, total_received: 1, total_sent: 0, n_tx: 1 };
        getSpy.mockResolvedValue({ data });
        const i = await run('address', { blockchain: 'btc', address: BTC_ADDR, full: true });

        expect(last(i).content).toBe(`Full data for Bitcoin address: ${BTC_ADDR}`);
        const file = last(i).files[0];
        expect(file.name).toBe('btc_mainnet_address_1A1zP1eP.json');
        expect(JSON.parse(i.fileContents[file.name])).toEqual(data);
        const [filePath] = [...written.keys()];
        expect(filePath.startsWith(REPO_TEMP)).toBe(true); // intercepted, not written
        expect(archiveSpy).toHaveBeenCalledWith(filePath, `blockchain_mainnet_${BTC_ADDR}`, 'json');
        expect(cleanupSpy).toHaveBeenCalledWith(filePath, 5000);
    });
});

describe('bob-blockchain transaction lookups', () => {
    it('shows a Bitcoin transaction', async () => {
        getSpy.mockResolvedValue({
            data: {
                hash: TXID, block_height: 800000, time: 1700000000, fee: 10000,
                inputs: [{ prev_out: { addr: '1InAddr' } }, { prev_out: {} }],
                out: [{ value: 100000000, addr: '1OutA' }, { value: 50000000, addr: '1OutB' }]
            }
        });
        const i = await run('transaction', { blockchain: 'btc', txid: TXID });

        expect(getSpy.mock.calls[0][0]).toBe(`https://blockchain.info/rawtx/${TXID}`);
        expect(edata(i).title).toBe('Bitcoin Transaction Information');
        expect(edata(i).url).toBe(`https://www.blockchain.com/explorer/transactions/btc/${TXID}`);
        expect(field(i, 'Status')).toBe('Confirmed');
        expect(field(i, 'Block')).toBe('800000');
        expect(field(i, 'Amount')).toBe('1.50000000 BTC');
        expect(field(i, 'Fee')).toBe('0.00010000 BTC');
        expect(field(i, 'From')).toBe('1InAddr\nUnknown');
        expect(field(i, 'To')).toBe('1OutA\n1OutB');
    });

    it('marks an unconfirmed Bitcoin transaction as pending', async () => {
        getSpy.mockResolvedValue({ data: { hash: TXID, fee: 1, out: [] } });
        const i = await run('transaction', { blockchain: 'btc', txid: TXID });
        expect(field(i, 'Status')).toBe('Pending');
        expect(field(i, 'Block')).toBe('Pending');
    });

    it('shows an Ethereum transaction with value and fee decoded from hex', async () => {
        getSpy.mockResolvedValue({
            data: { result: { hash: `0x${TXID}`, blockNumber: hex(68943), value: hex(10 ** 18), gas: hex(21000), gasPrice: hex(20e9), from: ETH_ADDR, to: '0xTo' } }
        });
        const i = await run('transaction', { blockchain: 'eth', txid: TXID });

        const [url, config] = getSpy.mock.calls[0];
        expect(url).toBe('https://api.etherscan.io/v2/api');
        expect(config.params).toMatchObject({ chainid: '1', module: 'proxy', action: 'eth_getTransactionByHash', txhash: TXID });
        expect(field(i, 'Block')).toBe('68943');
        expect(field(i, 'Amount')).toBe('1.00000000 ETH');
        expect(field(i, 'Fee')).toBe('0.00042000 ETH');
        expect(field(i, 'From')).toBe(ETH_ADDR);
    });

    it('accepts a 0x-prefixed hash, as explorers display it', async () => {
        getSpy.mockResolvedValue({ data: { result: { hash: `0x${TXID}`, blockNumber: hex(1), value: hex(0), from: 'a', to: 'b' } } });
        await run('transaction', { blockchain: 'eth', txid: ` 0x${TXID} ` });
        expect(getSpy.mock.calls[0][1].params.txhash).toBe(TXID);
    });

    it('shows a Litecoin transaction from Blockchair', async () => {
        getSpy.mockResolvedValue({
            data: { data: { [TXID]: { transaction: { block_id: 2500000, time: 1700000000, output_total: 150000000, fee: 10000 }, inputs: [{ recipient: 'Lin' }], outputs: [{ recipient: 'Lout' }] } } }
        });
        const i = await run('transaction', { blockchain: 'ltc', txid: TXID });
        expect(getSpy.mock.calls[0][0]).toBe(`https://api.blockchair.com/litecoin/dashboards/transaction/${TXID}`);
        expect(field(i, 'Amount')).toBe('1.50000000 LTC');
        expect(field(i, 'To')).toBe('Lout');
        expect(edata(i).url).toBe(`https://blockchair.com/litecoin/transaction/${TXID}`);
    });

    it('queries Sepolia for an Ethereum testnet transaction and links the testnet explorer', async () => {
        getSpy.mockResolvedValue({ data: { result: { hash: `0x${TXID}`, blockNumber: hex(5), value: hex(0), from: 'a', to: 'b' } } });
        const i = await run('transaction', { blockchain: 'eth', txid: TXID, network: 'testnet' });
        expect(getSpy.mock.calls[0][0]).toBe('https://api.etherscan.io/v2/api');
        expect(getSpy.mock.calls[0][1].params.chainid).toBe('11155111');
        expect(edata(i).url).toBe(`https://sepolia.etherscan.io/tx/0x${TXID}`);
    });

    it('tells the user when the provider returns no data', async () => {
        getSpy.mockResolvedValue({ data: null });
        const i = await run('transaction', { blockchain: 'ltc', txid: TXID });
        expect(last(i)).toBe(`No data found for Litecoin transaction: ${TXID}`);
    });

    it('attaches the raw JSON when full is set', async () => {
        getSpy.mockResolvedValue({ data: { hash: TXID } });
        const i = await run('transaction', { blockchain: 'btc', txid: TXID, full: true });
        expect(last(i).files[0].name).toBe(`btc_mainnet_tx_${TXID.slice(0, 8)}.json`);
        expect(archiveSpy).toHaveBeenCalledWith(expect.stringContaining('btc_mainnet_tx_'), `blockchain_mainnet_${TXID}`, 'json');
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
});

describe('bob-blockchain block lookups', () => {
    const btcBlock = { height: 800000, hash: HASH, time: 1700000000, n_tx: 3000, size: 1500000, difficulty: 5e13, tx: [{ inputs: [{ script: '03' }] }] };

    it('looks up a Bitcoin block by height', async () => {
        getSpy.mockResolvedValue({ data: { blocks: [btcBlock] } });
        const i = await run('block', { blockchain: 'btc', block: '800000' });
        expect(getSpy.mock.calls[0][0]).toBe('https://blockchain.info/block-height/800000?format=json');
        expect(edata(i).title).toBe('Bitcoin Block Information');
        expect(field(i, 'Height')).toBe('800000');
        expect(field(i, 'Hash')).toBe(HASH);
        expect(field(i, 'Transactions')).toBe('3000');
        expect(field(i, 'Size')).toBe('1464.84 KB');
    });

    it('looks up a Bitcoin block by hash', async () => {
        getSpy.mockResolvedValue({ data: btcBlock });
        const i = await run('block', { blockchain: 'btc', block: HASH });
        expect(getSpy.mock.calls[0][0]).toBe(`https://blockchain.info/rawblock/${HASH}`);
        expect(edata(i).description).toBe(`Block hash: \`${HASH}\``);
    });

    it('extracts the miner tag from the Bitcoin coinbase script', async () => {
        const tag = Buffer.from('/Foundry USA Pool/').toString('hex');
        getSpy.mockResolvedValue({ data: { ...btcBlock, tx: [{ inputs: [{ script: `03a1b2c3${tag}` }] }] } });
        const i = await run('block', { blockchain: 'btc', block: HASH });
        expect(field(i, 'Miner')).toContain('Foundry USA Pool');
    });

    it('looks up an Ethereum block by height with a hex tag', async () => {
        getSpy.mockResolvedValue({
            data: { result: { number: hex(68943), hash: `0x${HASH}`, timestamp: hex(1700000000), transactions: [1, 2, 3], size: hex(1024), difficulty: hex(0), miner: '0xMiner', gasUsed: hex(21000), gasLimit: hex(30000000) } }
        });
        const i = await run('block', { blockchain: 'eth', block: '68943' });
        expect(getSpy.mock.calls[0][1].params).toMatchObject({ module: 'proxy', action: 'eth_getBlockByNumber', tag: hex(68943), apikey: 'k-eth' });
        expect(field(i, 'Height')).toBe('68943');
        expect(field(i, 'Transactions')).toBe('3');
        expect(field(i, 'Miner')).toBe('0xMiner');
        expect(field(i, 'Gas Used')).toMatch(/^21.?000$/);
    });

    it.each([
        ['eth', 'mainnet'], ['bsc', 'mainnet'], ['matic', 'mainnet'], ['eth', 'testnet'], ['bsc', 'testnet'], ['matic', 'testnet']
    ])('refuses an %s %s block hash lookup without any request', async (blockchain, network) => {
        const i = await run('block', { blockchain, block: `0x${HASH}`, network });
        expect(last(i)).toBe('Etherscan can only look up EVM blocks by number.');
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('keeps an API-supplied miner value inside the embed, never in message content', async () => {
        getSpy.mockResolvedValue({ data: { result: { number: hex(1), hash: HASH, timestamp: hex(0), size: hex(1), difficulty: hex(1), miner: '@everyone', gasUsed: hex(1), gasLimit: hex(1) } } });
        const i = await run('block', { blockchain: 'eth', block: '1' });
        expect(last(i).content).toBeUndefined();
        expect(field(i, 'Miner')).toBe('@everyone');
    });

    it('replaces non-printable scraped characters in the miner field', async () => {
        getSpy.mockResolvedValue({ data: { result: { number: hex(1), hash: HASH, timestamp: hex(0), size: hex(1), difficulty: hex(1), miner: 'A‮B\u0000C', gasUsed: hex(1), gasLimit: hex(1) } } });
        const i = await run('block', { blockchain: 'eth', block: '1' });
        expect(field(i, 'Miner')).toBe('A?B?C');
    });

    it('uses the Blockchair testnet endpoint by height', async () => {
        getSpy.mockResolvedValue({
            data: { data: { 2500000: { block: { id: 2500000, hash: HASH, time: 1700000000, transaction_count: 5, size: 2048, difficulty: 1 }, transactions: [{ output_address: 'tb1miner' }] } } }
        });
        const i = await run('block', { blockchain: 'btc', block: '2500000', network: 'testnet' });
        expect(getSpy.mock.calls[0][0]).toBe('https://api.blockchair.com/bitcoin/testnet/dashboards/block/height/2500000');
        expect(edata(i).title).toBe('Bitcoin (Bitcoin Testnet) Block Information');
        expect(field(i, 'Miner')).toBe('tb1miner');
        expect(edata(i).url).toBe('https://blockchair.com/bitcoin/testnet/block/2500000');
    });

    it('tells the user when the provider returns no data', async () => {
        getSpy.mockResolvedValue({ data: null });
        const i = await run('block', { blockchain: 'btc', block: '1' });
        expect(last(i)).toBe('No data found for Bitcoin block height: 1');
    });

    it('attaches the raw JSON when full is set', async () => {
        getSpy.mockResolvedValue({ data: { blocks: [btcBlock] } });
        const i = await run('block', { blockchain: 'btc', block: '800000', full: true });
        expect(last(i).files[0].name).toBe('btc_mainnet_block_800000.json');
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
});

describe('bob-blockchain: failures and request safety', () => {
    const cases = [
        ['address', { blockchain: 'btc', address: BTC_ADDR }],
        ['transaction', { blockchain: 'eth', txid: TXID }],
        ['block', { blockchain: 'ltc', block: '5' }]
    ];

    it.each(cases)('gives a generic message for a failing %s lookup without leaking the error', async (sub, opts) => {
        getSpy.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443 secret-api-key=abc'));
        const i = await run(sub, opts);
        expect(last(i)).toBe('An error occurred while processing your request. Please try again later.');
    });

    it('gives a generic message when the provider answers with a malformed body', async () => {
        getSpy.mockResolvedValue({ data: { unexpected: true } });
        const i = await run('address', { blockchain: 'btc', address: BTC_ADDR });
        expect(last(i)).toBe('An error occurred while processing your request. Please try again later.');
    });

    it('sends every provider request through the safe agents to a fixed provider host', async () => {
        getSpy.mockResolvedValue({ data: null });
        const hosts = new Set();
        const scenarios = [
            ['address', { blockchain: 'btc', address: BTC_ADDR }],
            ['address', { blockchain: 'eth', address: ETH_ADDR }],
            ['address', { blockchain: 'ltc', address: LTC_ADDR }],
            ['address', { blockchain: 'doge', address: DOGE_ADDR }],
            ['address', { blockchain: 'zec', address: ZEC_ADDR }],
            ['address', { blockchain: 'bsc', address: ETH_ADDR, network: 'testnet' }],
            ['transaction', { blockchain: 'matic', txid: TXID }],
            ['transaction', { blockchain: 'doge', txid: TXID, network: 'testnet' }],
            ['block', { blockchain: 'dash', block: HASH }],
            ['block', { blockchain: 'zec', block: '100' }]
        ];
        for (const [sub, opts] of scenarios) await run(sub, opts);

        expect(getSpy).toHaveBeenCalledTimes(scenarios.length);
        for (const [url, config] of getSpy.mock.calls) {
            hosts.add(new URL(url).host);
            expect(config.httpAgent).toBe(SAFE.httpAgent);
            expect(config.httpsAgent).toBe(SAFE.httpsAgent);
            expect(config.timeout).toBeGreaterThan(0);
            expect(config.maxContentLength).toBeGreaterThan(0);
        }
        expect([...hosts].sort()).toEqual([
            'api.blockchair.com', 'api.etherscan.io', 'api.zcha.in', 'blockchain.info', 'dogechain.info'
        ].sort());
    });
});

describe('blockchain testnet validation', () => {
    let validateTestnetAddress, testnetExplorerUrl, TESTNETS;
    beforeAll(() => ({ validateTestnetAddress, testnetExplorerUrl, TESTNETS } = cmd._internal));

    it('accepts EVM testnet addresses (same 0x40-hex as mainnet)', () => {
        const addr = '0x742d35Cc6634C0532925a3b8D3Ac0C4ad5d0B78a';
        for (const chain of ['eth', 'bsc', 'matic']) {
            expect(validateTestnetAddress(chain, addr)).toBe(true);
        }
        expect(validateTestnetAddress('eth', '0xnothex')).toBe(false);
    });

    it('accepts Bitcoin testnet formats (m/n/2/tb1)', () => {
        expect(validateTestnetAddress('btc', 'mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef')).toBe(true);
        expect(validateTestnetAddress('btc', '2NBFNJTktNa7GZusGbDbGKRZTxdK9VVez3n')).toBe(true);
        expect(validateTestnetAddress('btc', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
    });

    it('rejects a mainnet Bitcoin address under testnet validation', () => {
        expect(validateTestnetAddress('btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
        expect(validateTestnetAddress('btc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    });

    it('accepts Litecoin (Q/tltc1) and Dash (y) testnet addresses', () => {
        expect(validateTestnetAddress('ltc', 'tltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kfrjyz2')).toBe(true);
        expect(validateTestnetAddress('dash', 'yjHiKkkX3nCe2C1cLbGvVvVvVvVvVvVvVv')).toBe(true);
    });

    it('requires the bchtest: prefix for BCH testnet CashAddr (rejects bare mainnet CashAddr)', () => {
        expect(validateTestnetAddress('bch', 'bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe(true);
        // Bare mainnet CashAddr body must NOT pass as testnet.
        expect(validateTestnetAddress('bch', 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toBe(false);
    });

    it('throws for a chain with no configured testnet', () => {
        expect(() => validateTestnetAddress('zec', 'tmsomething')).toThrow();
        expect(TESTNETS.zec).toBeUndefined();
    });

    it('builds provider-correct explorer URLs', () => {
        // Etherscan family uses /tx/ and /block/
        expect(testnetExplorerUrl('eth', 'tx', '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc');
        expect(testnetExplorerUrl('bsc', 'block', '99')).toBe('https://testnet.bscscan.com/block/99');
        // Blockchair uses /transaction/ and /{chain}/testnet/
        expect(testnetExplorerUrl('btc', 'address', 'mzBc')).toBe('https://blockchair.com/bitcoin/testnet/address/mzBc');
        expect(testnetExplorerUrl('ltc', 'tx', 'deadbeef')).toBe('https://blockchair.com/litecoin/testnet/transaction/deadbeef');
    });

    it('exposes the expected testnet chains', () => {
        expect(Object.keys(TESTNETS).sort()).toEqual(['bch', 'bsc', 'btc', 'dash', 'doge', 'eth', 'ltc', 'matic']);
        // EVM chains carry an API host + key env; Blockchair chains carry a chair path.
        expect(TESTNETS.eth.provider).toBe('etherscan');
        expect(TESTNETS.btc.provider).toBe('blockchair');
        expect(TESTNETS.btc.chair).toBe('bitcoin/testnet');
    });
});
