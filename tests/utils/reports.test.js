import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// REPORTS_DIR is resolved at module load, so point it at a throwaway dir and
// re-require the module fresh for each test.
function loadReports(dir) {
    process.env.REPORTS_DIR = dir;
    const resolved = require.resolve('../../utils/reports.js');
    delete require.cache[resolved];
    return require('../../utils/reports.js');
}

describe('utils/reports', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-test-'));
    });

    afterEach(() => {
        delete process.env.REPORTS_DIR;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reportFilePath confines output to REPORTS_DIR and sanitizes the label', () => {
        const mod = loadReports(dir);
        const p = mod.reportFilePath('../../etc/passwd', 'txt');
        expect(path.dirname(p)).toBe(dir);
        expect(path.basename(p)).not.toContain('/');
        expect(path.basename(p)).not.toContain('..');
        expect(p.endsWith('.txt')).toBe(true);
    });

    it('reportFilePath strips a leading-dot extension and defaults empties', () => {
        const mod = loadReports(dir);
        expect(mod.reportFilePath('user', '.json').endsWith('.json')).toBe(true);
        expect(mod.reportFilePath('user', '').endsWith('.txt')).toBe(true);
    });

    it('saveReport writes string content and returns the path', async () => {
        const mod = loadReports(dir);
        const dest = await mod.saveReport('sherlock_john', 'hello world');
        expect(dest).toBeTruthy();
        expect(fs.readFileSync(dest, 'utf8')).toBe('hello world');
        expect(path.dirname(dest)).toBe(dir);
    });

    it('saveReport writes Buffer content', async () => {
        const mod = loadReports(dir);
        const dest = await mod.saveReport('maigret_jane', Buffer.from('buf'), 'txt');
        expect(fs.readFileSync(dest, 'utf8')).toBe('buf');
    });

    it('archiveReport copies an existing file and preserves its extension', async () => {
        const mod = loadReports(dir);
        const src = path.join(dir, 'src.json');
        fs.writeFileSync(src, '{"x":1}');
        const dest = await mod.archiveReport(src, 'blockchain_addr');
        expect(dest.endsWith('.json')).toBe(true);
        expect(fs.readFileSync(dest, 'utf8')).toBe('{"x":1}');
    });

    it('archiveReport returns null when the source is missing (never throws)', async () => {
        const mod = loadReports(dir);
        const dest = await mod.archiveReport(path.join(dir, 'nope.txt'), 'label');
        expect(dest).toBeNull();
    });

    it('pruneReports removes files older than the max age, keeps fresh ones', async () => {
        const mod = loadReports(dir);
        const old = await mod.saveReport('old', 'old');
        const fresh = await mod.saveReport('fresh', 'fresh');
        // Backdate one file well past the window.
        const past = Date.now() - 40 * 24 * 60 * 60 * 1000;
        fs.utimesSync(old, past / 1000, past / 1000);

        const res = mod.pruneReports(30 * 24 * 60 * 60 * 1000);
        expect(res.swept).toBe(1);
        expect(fs.existsSync(old)).toBe(false);
        expect(fs.existsSync(fresh)).toBe(true);
    });

    it('two same-label saves in the same second do not clobber each other', async () => {
        const mod = loadReports(dir);
        const a = await mod.saveReport('dup', 'first', 'txt');
        const b = await mod.saveReport('dup', 'second', 'txt');
        expect(a).not.toBe(b);
        expect(fs.readFileSync(a, 'utf8')).toBe('first');
        expect(fs.readFileSync(b, 'utf8')).toBe('second');
    });

    it('startReportsSweep is idempotent and stopReportsSweep clears it', () => {
        const mod = loadReports(dir);
        const t1 = mod.startReportsSweep({ intervalMs: 3600000 });
        const t2 = mod.startReportsSweep({ intervalMs: 3600000 });
        expect(t1).toBe(t2);
        mod.stopReportsSweep();
    });
});
