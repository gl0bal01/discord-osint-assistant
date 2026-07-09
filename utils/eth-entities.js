/**
 * File: utils/eth-entities.js
 * Description: Small curated map of well-known EVM addresses (exchanges, mixers,
 *   bridges, common contracts) so the tracer can LABEL nodes instead of relying
 *   only on the degree heuristic. Flagging a hop as "Binance" or "Tornado Cash"
 *   tells an investigator where the trail effectively ends (custodial / mixed).
 *
 * Scope & caveat: these are primarily ETHEREUM MAINNET addresses. EVM addresses
 *   are NOT portable across chains for custodial wallets (exchange deposit
 *   addresses differ per chain), so a match is only authoritative on Ethereum
 *   mainnet; treat matches on other chains as advisory. Keys are lowercased.
 */

// address (lowercase) -> { label, type }
const KNOWN_ENTITIES = {
    // ── Exchanges (Ethereum mainnet hot wallets) ──
    '0x28c6c06298d514db089934071355e5743bf21d60': { label: 'Binance', type: 'exchange' },
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { label: 'Binance', type: 'exchange' },
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { label: 'Binance', type: 'exchange' },
    '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': { label: 'Binance', type: 'exchange' },
    '0x9696f59e4d72e237be84ffd425dcad154bf96976': { label: 'Binance', type: 'exchange' },
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { label: 'Coinbase', type: 'exchange' },
    '0x503828976d22510aad0201ac7ec88293211d23da': { label: 'Coinbase', type: 'exchange' },
    '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': { label: 'Coinbase', type: 'exchange' },
    '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': { label: 'Kraken', type: 'exchange' },
    '0xae2d4617c862309a3d75a0ffb358c7a5009c673f': { label: 'Kraken', type: 'exchange' },
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': { label: 'OKX', type: 'exchange' },
    '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f': { label: 'Bitfinex', type: 'exchange' },
    '0x0d0707963952f2fba59dd06f2b425ace40b492fe': { label: 'Gate.io', type: 'exchange' },

    // ── Mixers ──
    '0x722122df12d4e14e13ac3b6895a86e84145b6967': { label: 'Tornado Cash (router)', type: 'mixer' },
    '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': { label: 'Tornado Cash 0.1 ETH', type: 'mixer' },
    '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': { label: 'Tornado Cash 1 ETH', type: 'mixer' },
    '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': { label: 'Tornado Cash 10 ETH', type: 'mixer' },
    '0xa160cdab225685da1d56aa342ad8841c3b53f291': { label: 'Tornado Cash 100 ETH', type: 'mixer' },

    // ── DEX routers / common contracts ──
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { label: 'Uniswap V2 Router', type: 'dex' },
    '0xe592427a0aece92de3edee1f18e0157c05861564': { label: 'Uniswap V3 Router', type: 'dex' },
    '0x1111111254eeb25477b68fb85ed929f73a960582': { label: '1inch Router', type: 'dex' },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { label: 'WETH', type: 'contract' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { label: 'USDT (Tether)', type: 'contract' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { label: 'USDC', type: 'contract' },

    // ── Burn / null ──
    '0x0000000000000000000000000000000000000000': { label: 'Null / burn', type: 'burn' },
    '0x000000000000000000000000000000000000dead': { label: 'Burn (0xdead)', type: 'burn' }
};

/**
 * Look up a known-entity label for an address.
 * @param {string} address - EVM address (any case)
 * @returns {{label: string, type: string}|null}
 */
function entityLabel(address) {
    return KNOWN_ENTITIES[String(address || '').toLowerCase()] || null;
}

module.exports = { KNOWN_ENTITIES, entityLabel };
