import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    startHealthWriter,
    stopHealthWriter,
    markShuttingDown
} from '../../utils/health.js';

const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/healthcheck.js');

function uniqueDir() {
    return path.join(os.tmpdir(), `hc-int-${crypto.randomBytes(6).toString('hex')}`);
}

function runHealthcheck(healthFile) {
    return spawnSync(process.execPath, [SCRIPT], {
        env: { ...process.env, HEALTH_FILE: healthFile },
        encoding: 'utf8',
        timeout: 5000
    });
}

describe('health integration: shutting_down', () => {
    let dir;
    let filePath;

    beforeEach(() => {
        dir = uniqueDir();
        filePath = path.join(dir, '.health', 'health.json');
    });

    afterEach(async () => {
        stopHealthWriter();
        try { await fsp.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('boot writer → markShuttingDown → healthcheck exits 0 within grace', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        await markShuttingDown();

        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(payload.state).toBe('shutting_down');
        expect(typeof payload.shuttingDownSince).toBe('number');

        const result = runHealthcheck(filePath);
        expect(result.status).toBe(0);
        expect(result.stderr).toMatch(/OK/i);
    });

    it('file with shuttingDownSince 70s ago → healthcheck exits 1 (grace expired)', async () => {
        await startHealthWriter({ path: filePath, intervalMs: 60000 });
        await markShuttingDown();

        // Overwrite file with stale shuttingDownSince timestamp
        const stalePayload = {
            state: 'shutting_down',
            lastReady: null,
            shuttingDownSince: Date.now() - 70000,
            uptime: 1,
            pid: process.pid,
            version: '2.0.0',
            ts: Date.now() - 70000
        };
        await fsp.writeFile(filePath, JSON.stringify(stalePayload), 'utf8');

        const result = runHealthcheck(filePath);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/grace expired/i);
    });
});
