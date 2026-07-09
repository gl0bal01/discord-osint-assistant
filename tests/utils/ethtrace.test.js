import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ethtrace = require('../../utils/ethtrace.js');

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';
const D = '0xdddddddddddddddddddddddddddddddddddddddd';

// Canned Etherscan responses: A -> B (0.5 ETH) -> C (0.4 ETH); A -> D (token).
function mockFetch(_apiKey, _chainId, address, action, _offset) {
    if (address === A && action === 'txlist') {
        return [{ from: A, to: B, value: '500000000000000000', hash: '0x1', blockNumber: '100', timeStamp: '1700000000' }];
    }
    if (address === A && action === 'tokentx') {
        return [{ from: A, to: D, value: '1000000', tokenSymbol: 'USDC', tokenDecimal: '6', hash: '0x2', blockNumber: '101', timeStamp: '1700000001' }];
    }
    if (address === B && action === 'txlist') {
        return [{ from: B, to: C, value: '400000000000000000', hash: '0x3', blockNumber: '102', timeStamp: '1700000002' }];
    }
    return [];
}

async function buildGraph(direction = 'both') {
    return ethtrace.crawl(
        { apiKey: 'k', chainId: 1, address: A, depth: 2, maxTx: 25, direction, types: 'all', rateMs: 0 },
        { fetchAction: mockFetch }
    );
}

describe('ethtrace.crawl', () => {
    it('builds the expected money-flow graph within depth', async () => {
        const g = await buildGraph();
        expect(g.root).toBe(A);
        expect(g.stats.addresses).toBe(4);      // A,B,C,D
        expect(g.stats.edges).toBe(3);           // A->B, A->D, B->C
        expect([...g.nodes.keys()].sort()).toEqual([A, B, C, D].sort());
        expect(g.nodes.get(A).isRoot).toBe(true);
    });

    it('rejects an invalid root address', async () => {
        await expect(
            ethtrace.crawl({ apiKey: 'k', chainId: 1, address: 'not-an-address', types: 'all' }, { fetchAction: mockFetch })
        ).rejects.toThrow(/invalid root/i);
    });

    it('counts API errors and still returns (empty) instead of throwing', async () => {
        const failing = () => { throw new Error('NOTOK Missing/Invalid API Key'); };
        const g = await ethtrace.crawl(
            { apiKey: 'bad', chainId: 1, address: A, depth: 2, types: 'normal', rateMs: 0 },
            { fetchAction: failing }
        );
        expect(g.edges).toHaveLength(0);
        expect(g.stats.errors).toBeGreaterThan(0);
    });

    it('honours the out direction (only follows spends)', async () => {
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 1, address: A, depth: 2, direction: 'out', types: 'normal', rateMs: 0 },
            { fetchAction: mockFetch }
        );
        // A->B (out) then B->C (out): both kept.
        expect(g.edges.map(e => e.hash).sort()).toEqual(['0x1', '0x3']);
    });
});

describe('ethtrace.analyze', () => {
    it('ranks sinks by net native inflow and finds the dominant path', async () => {
        const g = await buildGraph();
        const a = ethtrace.analyze(g);
        // C accumulates the most net ETH (0.4 in, 0 out).
        expect(a.sinks[0].address).toBe(C);
        // Greedy native path A -> B -> C.
        expect(a.path.map(p => p.to)).toEqual([B, C]);
        expect(a.path[0].amount).toBe('0.5');
        expect(a.path[0].symbol).toBe('ETH');
        expect(a.hubs).toEqual([]);
    });

    it('flags high-degree hubs above the threshold', async () => {
        const g = await buildGraph();
        const a = ethtrace.analyze(g, { hubDegree: 2 });
        // A(2) is root (excluded); B(2) qualifies at threshold 2.
        expect(a.hubs.map(h => h.address)).toContain(B);
    });
});

describe('ethtrace exporters', () => {
    it('toCsv emits a header plus one row per node and edge', async () => {
        const g = await buildGraph();
        const lines = ethtrace.toCsv(g).split('\n');
        expect(lines[0].startsWith('row_type,address')).toBe(true);
        expect(lines.length).toBe(1 + 4 + 3); // header + nodes + edges
        expect(lines.some(l => l.startsWith('edge,'))).toBe(true);
    });

    it('toJson round-trips root, edges and analysis', async () => {
        const g = await buildGraph();
        const parsed = JSON.parse(ethtrace.toJson(g, ethtrace.analyze(g)));
        expect(parsed.root).toBe(A);
        expect(parsed.edges).toHaveLength(3);
        expect(parsed.analysis.path).toHaveLength(2);
    });

    it('toMermaid produces a capped, syntactically-safe flowchart', async () => {
        const g = await buildGraph();
        const mmd = ethtrace.toMermaid(g, { maxEdges: 2 });
        expect(mmd.startsWith('flowchart LR')).toBe(true);
        expect(mmd).toContain(':::root');
        expect(mmd).toContain('classDef root');
        // Only 2 of 3 edges rendered → omission note present.
        expect(mmd).toContain('more edges omitted');
        // Every edge line has exactly two pipes (label delimiters), never more.
        for (const line of mmd.split('\n').filter(l => l.includes('-->'))) {
            expect((line.match(/\|/g) || []).length).toBe(2);
        }
    });

    it('mmLabel strips flowchart-breaking characters', () => {
        expect(ethtrace._internal.mmLabel('a|b"c]d[e')).not.toMatch(/[|"\]\[]/);
    });
});

describe('ethtrace native-value correctness (review fixes)', () => {
    // A native 2 BNB transfer + a decoy ERC-20 literally named "ETH".
    function mockDecoy(_k, _c, address, action) {
        if (address === A && action === 'txlist') {
            return [{ from: A, to: B, value: '2000000000000000000', hash: '0x1', blockNumber: '1', timeStamp: '1' }];
        }
        if (address === A && action === 'tokentx') {
            return [{ from: A, to: B, value: '9999000000000000000000', tokenSymbol: 'ETH', tokenDecimal: '18', hash: '0x2', blockNumber: '2', timeStamp: '2' }];
        }
        return [];
    }

    it('labels native transfers with the chain symbol, not ETH, on non-ETH chains', async () => {
        // chainId 56 = BNB Chain.
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 56, address: A, depth: 1, types: 'all', rateMs: 0 },
            { fetchAction: mockDecoy }
        );
        const nativeEdge = g.edges.find(e => e.native);
        expect(nativeEdge.symbol).toBe('BNB');
        const tokenEdge = g.edges.find(e => !e.native);
        expect(tokenEdge.symbol).toBe('ETH'); // decoy symbol preserved…
        expect(tokenEdge.native).toBe(false); // …but never treated as native
    });

    it('does not count a decoy token named ETH as native inflow', async () => {
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 56, address: A, depth: 1, types: 'all', rateMs: 0 },
            { fetchAction: mockDecoy }
        );
        const a = ethtrace.analyze(g);
        // Only the real 2 BNB counts; the 9999 decoy is ignored.
        expect(a.sinks[0].address).toBe(B);
        expect(a.sinks[0].netNative).toBe(2);
    });

    it('excludes net-zero / net-negative addresses from sinks', async () => {
        const g = await buildGraph();
        const a = ethtrace.analyze(g);
        // D received only a token (net native 0) → must not appear as a sink.
        expect(a.sinks.map(s => s.address)).not.toContain(D);
        expect(a.sinks.every(s => s.netNative > 0)).toBe(true);
    });

    it('follows the in direction (receipts only)', async () => {
        function mockIn(_k, _c, address, action) {
            if (address === A && action === 'txlist') {
                return [{ from: B, to: A, value: '1000000000000000000', hash: '0x9', blockNumber: '1', timeStamp: '1' }];
            }
            return [];
        }
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 1, address: A, depth: 2, direction: 'in', types: 'normal', rateMs: 0 },
            { fetchAction: mockIn }
        );
        expect(g.edges.map(e => e.hash)).toEqual(['0x9']);
        expect(g.nodes.has(B)).toBe(true);
    });
});

describe('ethtrace safety caps (review fixes)', () => {
    // Every address fans out to 60 fresh valid addresses → unbounded without caps.
    function mockFan(_k, _c, address, action) {
        if (action !== 'txlist') return [];
        const rows = [];
        for (let i = 0; i < 60; i++) {
            const to = '0x' + (BigInt('0x' + address.slice(2)) + BigInt(i + 1)).toString(16).padStart(40, '0').slice(-40);
            rows.push({ from: address, to, value: '1', hash: `${address}-${i}`, blockNumber: '1', timeStamp: '1' });
        }
        return rows;
    }

    it('enforces address / api-call / edge caps and flags capHit', async () => {
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 1, address: A, depth: 3, maxTx: 100, direction: 'out', types: 'normal', rateMs: 0 },
            { fetchAction: mockFan }
        );
        expect(g.stats.crawled).toBeLessThanOrEqual(ethtrace.LIMITS.SAFETY_CAP + 1);
        expect(g.stats.apiCalls).toBeLessThanOrEqual(ethtrace.LIMITS.MAX_API_CALLS);
        expect(g.edges.length).toBeLessThanOrEqual(ethtrace.LIMITS.MAX_EDGES);
        expect(g.stats.capHit).toBe(true);
    });
});

describe('ethtrace CSV safety (review fix)', () => {
    it('neutralizes spreadsheet formula injection in a token symbol', () => {
        const g = {
            root: A, chainId: 1,
            nodes: new Map([[A, { depth: 0, isRoot: true }]]),
            edges: [{ type: 'ERC20', native: false, from: A, to: B, amount: '1', symbol: '=SUM(A1)', hash: '0x1', block: '1', timeStamp: '' }],
            stats: {}
        };
        const csv = ethtrace.toCsv(g);
        expect(csv).toContain("'=SUM(A1)");   // leading quote defuses the formula
        expect(csv).not.toMatch(/,=SUM/);      // never a bare =formula cell
    });
});

describe('ethtrace entity labels + enrich (new features)', () => {
    const BINANCE = '0x28c6c06298d514db089934071355e5743bf21d60';
    function mockToExch(_k, _c, address, action) {
        if (address === A && action === 'txlist') {
            return [{ from: A, to: BINANCE, value: '1000000000000000000', hash: '0x1', blockNumber: '1', timeStamp: '1' }];
        }
        return [];
    }

    it('flags a known entity as a hub even at low degree, with its label', async () => {
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 1, address: A, depth: 1, types: 'normal', rateMs: 0 },
            { fetchAction: mockToExch }
        );
        const hub = ethtrace.analyze(g).hubs.find(h => h.address === BINANCE);
        expect(hub).toBeTruthy();
        expect(hub.label).toBe('Binance');
    });

    it('labels sinks with known entities', async () => {
        const g = await ethtrace.crawl(
            { apiKey: 'k', chainId: 1, address: A, depth: 1, types: 'normal', rateMs: 0 },
            { fetchAction: mockToExch }
        );
        const sink = ethtrace.analyze(g).sinks.find(s => s.address === BINANCE);
        expect(sink.label).toBe('Binance');
    });

    it('entityLabel resolves known and rejects unknown addresses', () => {
        expect(ethtrace.entityLabel(BINANCE).type).toBe('exchange');
        expect(ethtrace.entityLabel(B)).toBeNull();
    });

    it('enrich returns balance/nonce/first/last and is bounded to ENRICH_MAX', async () => {
        const mockScalar = (_k, _c, p) => (p.action === 'balance' ? { status: '1', result: '1500000000000000000' } : { result: '0x5' });
        const mockAct = (_k, _c, _addr, _act, _off, sort) => [{ timeStamp: sort === 'asc' ? '1600000000' : '1700000000' }];
        const many = Array.from({ length: 10 }, (_, i) => '0x' + String(i + 1).padStart(40, '0'));
        const m = await ethtrace.enrich('k', 1, many, { fetchScalar: mockScalar, fetchAction: mockAct, rateMs: 0 });
        expect(m.size).toBe(ethtrace.LIMITS.ENRICH_MAX);
        const first = [...m.values()][0];
        expect(first.balance).toBe('1.5');
        expect(first.nonce).toBe(5);
        expect(first.firstSeen).toBe(1600000000);
        expect(first.lastSeen).toBe(1700000000);
        expect(first.symbol).toBe('ETH');
    });
});

describe('ethtrace amount helpers', () => {
    it('formatUnits + trimZero render human amounts', () => {
        const { formatUnits, trimZero } = ethtrace._internal;
        expect(trimZero(formatUnits('500000000000000000', 18))).toBe('0.5');
        expect(trimZero(formatUnits('1000000', 6))).toBe('1');
        expect(formatUnits('not-a-number', 18)).toBe('0');
    });

    it('resolveTypes expands selections', () => {
        expect(ethtrace._internal.resolveTypes('normal')).toHaveLength(1);
        expect(ethtrace._internal.resolveTypes('token')).toHaveLength(3);
        expect(ethtrace._internal.resolveTypes('all')).toHaveLength(5);
    });
});
