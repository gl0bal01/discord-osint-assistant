import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/healthcheck.js');

function uniqueDir() {
    return path.join(os.tmpdir(), `hc-test-${crypto.randomBytes(6).toString('hex')}`);
}

function writeHealthFile(dir, payload) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'health.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    return file;
}

function runHealthcheck(healthFile) {
    return spawnSync(process.execPath, [SCRIPT], {
        env: { ...process.env, HEALTH_FILE: healthFile },
        encoding: 'utf8',
        timeout: 5000
    });
}

describe('healthcheck.js', () => {
    it('ENOENT → exit 1', () => {
        const result = runHealthcheck('/nonexistent/path/health.json');
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/ENOENT/i);
    });

    it('malformed JSON → exit 1', () => {
        const dir = uniqueDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'health.json');
        fs.writeFileSync(file, 'not-json', 'utf8');
        const result = runHealthcheck(file);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/parse error/i);
    });

    it('valid ready file with fresh lastReady → exit 0', () => {
        const dir = uniqueDir();
        const file = writeHealthFile(dir, {
            state: 'ready',
            lastReady: Date.now(),
            shuttingDownSince: null,
            uptime: 1,
            pid: 1,
            version: '2.0.0',
            ts: Date.now()
        });
        const result = runHealthcheck(file);
        expect(result.status).toBe(0);
        expect(result.stderr).toMatch(/OK/i);
    });

    it('valid ready file with stale lastReady (>30s) → exit 1', () => {
        const dir = uniqueDir();
        const file = writeHealthFile(dir, {
            state: 'ready',
            lastReady: Date.now() - 35000,
            shuttingDownSince: null,
            uptime: 1,
            pid: 1,
            version: '2.0.0',
            ts: Date.now() - 35000
        });
        const result = runHealthcheck(file);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/stale/i);
    });

    it('valid shutting_down file within grace → exit 0', () => {
        const dir = uniqueDir();
        const file = writeHealthFile(dir, {
            state: 'shutting_down',
            lastReady: Date.now() - 5000,
            shuttingDownSince: Date.now() - 10000,
            uptime: 1,
            pid: 1,
            version: '2.0.0',
            ts: Date.now()
        });
        const result = runHealthcheck(file);
        expect(result.status).toBe(0);
        expect(result.stderr).toMatch(/OK/i);
    });

    it('valid shutting_down file outside grace (>60s) → exit 1', () => {
        const dir = uniqueDir();
        const file = writeHealthFile(dir, {
            state: 'shutting_down',
            lastReady: null,
            shuttingDownSince: Date.now() - 70000,
            uptime: 1,
            pid: 1,
            version: '2.0.0',
            ts: Date.now() - 70000
        });
        const result = runHealthcheck(file);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/grace expired/i);
    });
});
