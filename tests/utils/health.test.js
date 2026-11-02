import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// We import the module under test using dynamic import so each test group
// can work with a fresh module state via re-import tricks if needed.
// For simplicity we use the same module instance and call stop between tests.
import {
    startHealthWriter,
    stopHealthWriter,
    markReady,
    markShuttingDown,
    writeNow
} from '../../utils/health.js';

function uniqueDir() {
    return path.join(os.tmpdir(), `health-test-${crypto.randomBytes(6).toString('hex')}`);
}

describe('health writer', () => {
    let dir;
    let filePath;

    beforeEach(() => {
        dir = uniqueDir();
        filePath = path.join(dir, '.health', 'health.json');
    });

    afterEach(async () => {
        stopHealthWriter();
        try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('round-trip: startHealthWriter writes valid JSON with required fields', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        const raw = await fs.readFile(filePath, 'utf8');
        const payload = JSON.parse(raw);
        expect(payload).toHaveProperty('state');
        expect(payload).toHaveProperty('lastReady');
        expect(payload).toHaveProperty('shuttingDownSince');
        expect(payload).toHaveProperty('uptime');
        expect(payload).toHaveProperty('pid');
        expect(payload).toHaveProperty('version');
        expect(payload).toHaveProperty('ts');
        expect(typeof payload.uptime).toBe('number');
        expect(payload.pid).toBe(process.pid);
        expect(payload.version).toBe(require('../../package.json').version);
    });

    it('mkdir -p creates missing parent directory', async () => {
        const nested = path.join(dir, 'a', 'b', 'c', 'health.json');
        await startHealthWriter({ path: nested, intervalMs: 60000 });
        const stat = await fs.stat(nested);
        expect(stat.isFile()).toBe(true);
    });

    it('markReady transitions state to ready and updates lastReady', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        const before = Date.now();
        await markReady();
        const after = Date.now();
        const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
        expect(payload.state).toBe('ready');
        expect(payload.lastReady).toBeGreaterThanOrEqual(before);
        expect(payload.lastReady).toBeLessThanOrEqual(after);
    });

    it('markShuttingDown transitions state to shutting_down and sets shuttingDownSince', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        const before = Date.now();
        await markShuttingDown();
        const after = Date.now();
        const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
        expect(payload.state).toBe('shutting_down');
        expect(payload.shuttingDownSince).toBeGreaterThanOrEqual(before);
        expect(payload.shuttingDownSince).toBeLessThanOrEqual(after);
    });

    it('refreshes lastReady on every write while the gateway is ready', async () => {
        const client = { ws: { status: 0 } };
        await startHealthWriter({ path: filePath, intervalMs: 60000, client });
        await markReady();
        const now = Date.now() + 60000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
            await writeNow();
            const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
            expect(payload.lastReady).toBe(now);

            client.ws.status = 5; // disconnected: lastReady must go stale
            vi.spyOn(Date, 'now').mockReturnValue(now + 60000);
            await writeNow();
            const stale = JSON.parse(await fs.readFile(filePath, 'utf8'));
            expect(stale.state).toBe('starting');
            expect(stale.lastReady).toBe(now);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('writeNow flushes immediately', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        await markReady();
        // Modify internal state indirectly by calling writeNow after markReady
        await writeNow();
        const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
        expect(payload.state).toBe('ready');
    });

    it('stopHealthWriter clears interval — no further writes after stop', async () => {
        vi.useFakeTimers();
        try {
            await startHealthWriter({ path: filePath, intervalMs: 100 });
            stopHealthWriter();
            // Delete the file so we can detect any spurious write
            await fs.unlink(filePath);
            // Advance fake timers well past interval
            await vi.advanceTimersByTimeAsync(1000);
            // File should not exist (no write happened)
            await expect(fs.access(filePath)).rejects.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });
});
