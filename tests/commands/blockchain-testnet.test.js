import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _internal } = require('../../commands/blockchain.js');
const { validateTestnetAddress, testnetExplorerUrl, TESTNETS } = _internal;

describe('blockchain testnet validation', () => {
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
