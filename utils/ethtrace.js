/**
 * File: utils/ethtrace.js
 * Description: Headless EVM transaction-flow tracer. Recursively crawls an
 *   address's transactions via the Etherscan V2 unified multichain API and
 *   builds a directed money-flow graph, then derives "follow-the-money"
 *   analytics (sinks where funds accumulate, high-degree hubs to ignore, the
 *   dominant native-value path) and exports CSV / JSON / Mermaid.
 *
 *   Powers the `/bob-blockchain trace` subcommand. Pure logic + a single
 *   injectable fetch layer so the crawl/analysis is unit-testable offline.
 *
 * Security: outbound calls go only to the hardcoded Etherscan host through
 *   getSafeAxiosConfig() (connect-time private-IP re-validation). Every address
 *   is 0x-40-hex validated before use. Hard caps (depth, per-address tx, total
 *   addresses, total API calls) bound the crawl so a single command cannot fan
 *   out unboundedly.
 */
const axios = require('axios');
const { URLSearchParams } = require('node:url');
const { getSafeAxiosConfig, SIZE_5MB } = require('./ssrf');
const { entityLabel } = require('./eth-entities');

const API_BASE = 'https://api.etherscan.io/v2/api';

// EVM chains exposed by the tracer (chainid → display + explorer + the chain's
// NATIVE currency symbol — used so a BNB/POL/AVAX transfer isn't mislabeled ETH).
const EVM_CHAINS = [
    { id: 1, name: 'Ethereum', explorer: 'etherscan.io', native: 'ETH' },
    { id: 11155111, name: 'Sepolia', explorer: 'sepolia.etherscan.io', native: 'ETH' },
    { id: 56, name: 'BNB Chain', explorer: 'bscscan.com', native: 'BNB' },
    { id: 137, name: 'Polygon', explorer: 'polygonscan.com', native: 'POL' },
    { id: 42161, name: 'Arbitrum One', explorer: 'arbiscan.io', native: 'ETH' },
    { id: 10, name: 'Optimism', explorer: 'optimistic.etherscan.io', native: 'ETH' },
    { id: 8453, name: 'Base', explorer: 'basescan.org', native: 'ETH' },
    { id: 43114, name: 'Avalanche C-Chain', explorer: 'snowtrace.io', native: 'AVAX' },
    { id: 250, name: 'Fantom', explorer: 'ftmscan.com', native: 'FTM' }
];

// A tx "type" can expand to several underlying Etherscan account actions.
// `native: true` marks value-bearing chain-currency movements (normal + internal);
// token transfers are never native regardless of their (attacker-set) symbol.
const TX_TYPE_GROUPS = {
    normal: [{ action: 'txlist', label: 'normal', native: true }],
    internal: [{ action: 'txlistinternal', label: 'internal', native: true }],
    token: [
        { action: 'tokentx', label: 'ERC20', native: false },
        { action: 'tokennfttx', label: 'ERC721', native: false },
        { action: 'token1155tx', label: 'ERC1155', native: false }
    ]
};

// Hard safety limits — these bound cost/abuse regardless of user input.
const LIMITS = Object.freeze({
    MAX_DEPTH: 3,
    MAX_TX: 100,
    SAFETY_CAP: 150,      // max addresses crawled (dequeued + fetched)
    MAX_API_CALLS: 250,   // max Etherscan calls per trace
    MAX_EDGES: 5000,      // hard cap on graph/export size
    RATE_MS: 220,         // spacing between calls (~4.5 rps, under free tier)
    ENRICH_MAX: 4         // max addresses enriched (balance/nonce/first/last) per trace
});

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
function isAddress(a) { return ADDR_RE.test(String(a || '')); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// BigInt-safe conversion of a raw integer string to a decimal string.
function formatUnits(value, decimals) {
    try {
        let v = BigInt(value);
        const neg = v < 0n;
        if (neg) v = -v;
        const base = 10n ** BigInt(decimals);
        const whole = v / base;
        const frac = (v % base).toString().padStart(decimals, '0').slice(0, 6);
        return (neg ? '-' : '') + whole.toString() + '.' + frac;
    } catch {
        return '0';
    }
}
function trimZero(s) { return String(s).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''); }
function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

// Approximate native value (float) for ranking and summary display. Native-ness
// comes from the tx group (normal/internal), NOT the symbol string — so a token
// deceptively named "ETH" is never counted as native value.
function nativeFloat(edge) {
    if (!edge.native) return 0;
    const n = parseFloat(edge.amount);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve which type groups a selection expands to.
 * @param {string} types - 'all' | 'normal' | 'internal' | 'token'
 */
function resolveTypes(types) {
    if (types === 'normal') return [...TX_TYPE_GROUPS.normal];
    if (types === 'internal') return [...TX_TYPE_GROUPS.internal];
    if (types === 'token') return [...TX_TYPE_GROUPS.token];
    return [...TX_TYPE_GROUPS.normal, ...TX_TYPE_GROUPS.internal, ...TX_TYPE_GROUPS.token];
}

/**
 * Fetch one Etherscan account action for an address (V2 unified endpoint).
 * @returns {Promise<Array>} result rows (empty on "no transactions found")
 */
async function fetchAction(apiKey, chainId, address, action, offset, sort = 'desc') {
    const params = new URLSearchParams({
        chainid: String(chainId),
        module: 'account',
        action,
        address,
        startblock: '0',
        endblock: '99999999',
        page: '1',
        offset: String(offset),
        sort: sort === 'asc' ? 'asc' : 'desc',
        apikey: apiKey
    });
    const cfg = { ...getSafeAxiosConfig(), timeout: 15000, maxContentLength: SIZE_5MB, maxBodyLength: SIZE_5MB };

    for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await axios.get(`${API_BASE}?${params.toString()}`, cfg);
        const data = resp.data;
        if (data && data.status === '1') return Array.isArray(data.result) ? data.result : [];
        const msg = `${(data && data.message) || ''} ${(data && data.result) || ''}`;
        if (/rate limit/i.test(msg)) { await sleep(1200 * (attempt + 1)); continue; }
        if (/no transactions found/i.test(msg)) return [];
        throw new Error(`Etherscan ${action}: ${msg.trim() || 'unknown error'}`);
    }
    throw new Error(`Etherscan ${action}: retries exhausted`);
}

/**
 * Fetch a scalar-result Etherscan endpoint (balance, tx count, …).
 * @returns {Promise<Object>} raw response ({ status, result } or { result })
 */
async function fetchScalar(apiKey, chainId, extraParams) {
    const params = new URLSearchParams({ chainid: String(chainId), apikey: apiKey, ...extraParams });
    const cfg = { ...getSafeAxiosConfig(), timeout: 15000, maxContentLength: SIZE_5MB, maxBodyLength: SIZE_5MB };
    const resp = await axios.get(`${API_BASE}?${params.toString()}`, cfg);
    return resp.data;
}

/**
 * Enrich a small set of key addresses with balance / nonce / first & last
 * activity. Bounded to LIMITS.ENRICH_MAX addresses (≤4 calls each) so it can't
 * blow up the API budget. Every field is best-effort — failures leave it null.
 * @param {string} apiKey
 * @param {string|number} chainId
 * @param {string[]} addresses - ordered; only the first ENRICH_MAX are enriched
 * @param {Object} deps - { fetchScalar, fetchAction } injectable for tests
 * @returns {Promise<Map<string, {balance, nonce, firstSeen, lastSeen, symbol}>>}
 */
async function enrich(apiKey, chainId, addresses, deps = {}) {
    const fetchS = deps.fetchScalar || fetchScalar;
    const fetchAct = deps.fetchAction || fetchAction;
    const rateMs = deps.rateMs ?? LIMITS.RATE_MS;
    const symbol = (chainById(chainId) || {}).native || 'ETH';
    const out = new Map();

    for (const addr of addresses.slice(0, LIMITS.ENRICH_MAX)) {
        if (!isAddress(addr)) continue;
        const info = { balance: null, nonce: null, firstSeen: null, lastSeen: null, symbol };

        try {
            const bal = await fetchS(apiKey, chainId, { module: 'account', action: 'balance', address: addr, tag: 'latest' });
            if (bal && bal.status === '1') info.balance = trimZero(formatUnits(bal.result || '0', 18));
        } catch { /* best-effort */ }
        if (rateMs > 0) await sleep(rateMs);

        try {
            const n = await fetchS(apiKey, chainId, { module: 'proxy', action: 'eth_getTransactionCount', address: addr, tag: 'latest' });
            if (n && n.result) { const parsed = parseInt(n.result, 16); if (Number.isFinite(parsed)) info.nonce = parsed; }
        } catch { /* best-effort */ }
        if (rateMs > 0) await sleep(rateMs);

        try {
            const last = await fetchAct(apiKey, chainId, addr, 'txlist', 1, 'desc');
            if (last[0] && last[0].timeStamp) info.lastSeen = Number(last[0].timeStamp);
        } catch { /* best-effort */ }
        if (rateMs > 0) await sleep(rateMs);

        try {
            const first = await fetchAct(apiKey, chainId, addr, 'txlist', 1, 'asc');
            if (first[0] && first[0].timeStamp) info.firstSeen = Number(first[0].timeStamp);
        } catch { /* best-effort */ }
        if (rateMs > 0) await sleep(rateMs);

        out.set(addr, info);
    }
    return out;
}

/**
 * Recursively crawl transactions into a money-flow graph.
 * @param {Object} opts - { apiKey, chainId, address, depth, maxTx, direction, types }
 * @param {Object} deps - { fetchAction } injectable for tests
 * @returns {Promise<{root, chainId, nodes: Map, edges: Array, stats}>}
 */
async function crawl(opts, deps = {}) {
    const fetch = deps.fetchAction || fetchAction;
    const root = String(opts.address || '').toLowerCase();
    if (!isAddress(root)) throw new Error('Invalid root address');

    const depth = Math.min(LIMITS.MAX_DEPTH, Math.max(1, opts.depth || 2));
    const maxTx = Math.min(LIMITS.MAX_TX, Math.max(1, opts.maxTx || 25));
    const direction = ['out', 'in', 'both'].includes(opts.direction) ? opts.direction : 'both';
    const typeGroups = resolveTypes(opts.types);
    const rateMs = opts.rateMs ?? LIMITS.RATE_MS;
    const nativeSymbol = (chainById(opts.chainId) || {}).native || 'ETH';

    const nodes = new Map();          // address -> { depth, isRoot }
    const edges = [];
    const edgeKeys = new Set();
    const visited = new Set();
    const queue = [{ address: root, depth: 0 }];
    let apiCalls = 0, capHit = false, errors = 0;

    const addNode = (addr, d, isRoot = false) => {
        const ex = nodes.get(addr);
        if (ex) { if (d < ex.depth) ex.depth = d; if (isRoot) ex.isRoot = true; return; }
        nodes.set(addr, { depth: d, isRoot });
    };
    addNode(root, 0, true);

    while (queue.length) {
        const { address: cur, depth: d } = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);

        if (visited.size > LIMITS.SAFETY_CAP) { capHit = true; break; }
        if (d >= depth) continue;

        for (const t of typeGroups) {
            if (apiCalls >= LIMITS.MAX_API_CALLS) { capHit = true; break; }
            apiCalls++;
            if (opts.onProgress) opts.onProgress({ address: cur, depth: d, visited: visited.size, apiCalls });

            let rows;
            try {
                rows = await fetch(opts.apiKey, opts.chainId, cur, t.action, maxTx);
            } catch (err) {
                errors++;
                if (opts.onError) opts.onError(err);
                if (rateMs > 0) await sleep(rateMs);
                continue;
            }
            if (rateMs > 0) await sleep(rateMs);

            for (const tx of rows) {
                if (edges.length >= LIMITS.MAX_EDGES) { capHit = true; break; }
                const from = String(tx.from || '').toLowerCase();
                const to = String(tx.to || tx.contractAddress || '').toLowerCase();
                if (!isAddress(from) || !isAddress(to)) continue;

                // Direction gate: only follow flows we care about.
                if (direction === 'out' && from !== cur) continue;
                if (direction === 'in' && to !== cur) continue;

                const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal, 10) : 18;
                // Native-ness is a property of the tx group, not the symbol string.
                const symbol = t.native ? nativeSymbol : (tx.tokenSymbol ? String(tx.tokenSymbol) : nativeSymbol);
                const amount = trimZero(formatUnits(tx.value || '0', Number.isFinite(decimals) ? decimals : 18));
                const key = `${t.action}|${tx.hash}|${from}|${to}|${symbol}`;
                if (edgeKeys.has(key)) continue;
                edgeKeys.add(key);

                addNode(from, from === cur ? d : d + 1, false);
                addNode(to, to === cur ? d : d + 1, false);
                edges.push({
                    type: t.label, native: !!t.native, from, to, amount, symbol,
                    hash: tx.hash || '', block: tx.blockNumber || '', timeStamp: tx.timeStamp || ''
                });

                const other = from === cur ? to : from;
                if (!visited.has(other)) queue.push({ address: other, depth: d + 1 });
            }
            if (capHit) break;
        }
        if (capHit) break;
    }

    return { root, chainId: opts.chainId, nodes, edges, stats: { addresses: nodes.size, crawled: visited.size, edges: edges.length, apiCalls, capHit, errors, depth, direction } };
}

/**
 * Derive follow-the-money analytics from a crawled graph.
 * @param {Object} graph - output of crawl()
 * @param {Object} [opts] - { hubDegree }
 * @returns {{sinks, hubs, path}}
 */
function analyze(graph, opts = {}) {
    const hubDegree = opts.hubDegree || 15;
    const { root, nodes, edges } = graph;

    const degree = new Map();
    const nativeIn = new Map();
    const nativeOut = new Map();
    const outEdges = new Map(); // from -> [edge]
    const bump = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);

    for (const e of edges) {
        bump(degree, e.from); bump(degree, e.to);
        const nv = nativeFloat(e);
        if (nv > 0) { bump(nativeIn, e.to, nv); bump(nativeOut, e.from, nv); }
        if (!outEdges.has(e.from)) outEdges.set(e.from, []);
        outEdges.get(e.from).push(e);
    }

    // Sinks: non-root addresses that NET-ACCUMULATE native value (received > sent),
    // ranked by net inflow, tie-broken by degree — where the money actually settles.
    // Addresses with zero/negative net are excluded so the list can't claim value
    // accumulates where it doesn't (e.g. token-only or pass-through nodes).
    const sinks = [...nodes.keys()]
        .filter(a => a !== root)
        .map(a => ({
            address: a,
            netNative: (nativeIn.get(a) || 0) - (nativeOut.get(a) || 0),
            inflow: nativeIn.get(a) || 0,
            degree: degree.get(a) || 0,
            label: (entityLabel(a) || {}).label || null
        }))
        .filter(s => s.netNative > 0)
        .sort((x, y) => (y.netNative - x.netNative) || (y.degree - x.degree))
        .slice(0, 8);

    // Hubs to ignore: high-degree nodes (faucets/spam) AND any KNOWN entity
    // (exchange/mixer/bridge) even at low degree — those are effective dead-ends.
    const hubMap = new Map();
    for (const [a, deg] of degree) { if (a !== root && deg >= hubDegree) hubMap.set(a, deg); }
    for (const a of nodes.keys()) { if (a !== root && entityLabel(a) && !hubMap.has(a)) hubMap.set(a, degree.get(a) || 0); }
    const hubs = [...hubMap.entries()]
        .map(([address, deg]) => ({ address, degree: deg, label: (entityLabel(address) || {}).label || null }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 12);

    // Dominant native path: greedily follow the largest ETH outflow each hop.
    const hubSet = new Set(hubs.map(h => h.address));
    const path = [];
    const seen = new Set([root]);
    let cur = root;
    for (let i = 0; i < LIMITS.MAX_DEPTH + 1; i++) {
        const outs = (outEdges.get(cur) || [])
            .filter(e => nativeFloat(e) > 0 && !seen.has(e.to) && !hubSet.has(e.to))
            .sort((a, b) => nativeFloat(b) - nativeFloat(a));
        if (!outs.length) break;
        const best = outs[0];
        path.push({ from: cur, to: best.to, amount: best.amount, symbol: best.symbol });
        seen.add(best.to);
        cur = best.to;
    }

    return { sinks, hubs, path };
}

// ── Exporters ───────────────────────────────────────────────────────────────

function csvEscape(v) {
    v = String(v ?? '');
    // Defuse spreadsheet formula injection: a cell beginning with = + - @ or a
    // control char is executed as a formula by Excel/Sheets. Token symbols are
    // attacker-controlled on-chain metadata, so neutralize with a leading quote.
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(graph) {
    const header = ['row_type', 'address', 'depth', 'is_root', 'tx_type', 'from', 'to', 'amount', 'symbol', 'hash', 'block', 'date'];
    const rows = [header];
    for (const [address, meta] of graph.nodes) {
        rows.push(['node', address, meta.depth, meta.isRoot ? '1' : '0', '', '', '', '', '', '', '', '']);
    }
    for (const e of graph.edges) {
        const date = e.timeStamp ? new Date(parseInt(e.timeStamp, 10) * 1000).toISOString() : '';
        rows.push(['edge', '', '', '', e.type, e.from, e.to, e.amount, e.symbol, e.hash, e.block, date]);
    }
    return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function toJson(graph, analysis) {
    return JSON.stringify({
        root: graph.root,
        chainId: graph.chainId,
        stats: graph.stats,
        nodes: [...graph.nodes].map(([address, meta]) => ({ address, ...meta })),
        edges: graph.edges,
        analysis
    }, null, 2);
}

// Mermaid-safe: strip chars that break flowchart syntax; keep it short.
function mmLabel(s) { return String(s).replace(/["|\][<>{}\n]/g, ' ').slice(0, 24); }

/**
 * Render the graph as a Mermaid flowchart. Edges are capped so the diagram
 * stays renderable; the full set always lives in the CSV/JSON.
 */
function toMermaid(graph, opts = {}) {
    const maxEdges = opts.maxEdges || 80;
    const lines = ['flowchart LR'];
    const idOf = new Map();
    let i = 0;
    const nodeId = (addr) => {
        if (!idOf.has(addr)) {
            const id = `n${i++}`;
            idOf.set(addr, id);
            const meta = graph.nodes.get(addr) || {};
            const label = mmLabel(shortAddr(addr));
            lines.push(`  ${id}["${label}"]${meta.isRoot ? ':::root' : ''}`);
        }
        return idOf.get(addr);
    };

    const shown = graph.edges.slice(0, maxEdges);
    for (const e of shown) {
        const a = nodeId(e.from), b = nodeId(e.to);
        const lbl = mmLabel(`${e.amount} ${e.symbol}`);
        lines.push(`  ${a} -->|${lbl}| ${b}`);
    }
    lines.push('  classDef root fill:#e63946,stroke:#fff,color:#fff;');
    if (graph.edges.length > shown.length) {
        lines.push(`  %% ${graph.edges.length - shown.length} more edges omitted — see CSV/JSON`);
    }
    return lines.join('\n');
}

function chainById(chainId) {
    return EVM_CHAINS.find(c => String(c.id) === String(chainId)) || null;
}

module.exports = {
    EVM_CHAINS,
    LIMITS,
    isAddress,
    crawl,
    analyze,
    enrich,
    entityLabel,
    toCsv,
    toJson,
    toMermaid,
    chainById,
    shortAddr,
    // exported for tests
    _internal: { fetchAction, fetchScalar, formatUnits, trimZero, resolveTypes, nativeFloat, mmLabel }
};
