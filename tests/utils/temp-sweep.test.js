import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load bootstrap fresh (clears cache) — used only for the filesystem test.
function loadBootstrap() {
    const resolved = require.resolve('../../utils/bootstrap.js');
    delete require.cache[resolved];
    return require('../../utils/bootstrap.js');
}

// ─── startHourlySweep / stopHourlySweep ──────────────────────────────────────

describe('startHourlySweep', () => {
    let tmpDir;
    let mod;        // fresh temp-sweep module for the current test
    let bootstrapMod;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
        vi.useFakeTimers();

        // Keep bootstrap in cache (do NOT clear it) so the module object
        // is shared between temp-sweep and the spy.
        bootstrapMod = require('../../utils/bootstrap.js');

        // Always re-require temp-sweep fresh so module-level sweepTimer = null.
        const resolved = require.resolve('../../utils/temp-sweep.js');
        delete require.cache[resolved];
        mod = require('../../utils/temp-sweep.js');
    });

    afterEach(() => {
        mod.stopHourlySweep();
        vi.useRealTimers();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('schedules an interval and invokes sweepBootTemp after one tick', () => {
        const { SWEEP_EXCLUDE_DEFAULT } = bootstrapMod;
        const spy = vi.spyOn(bootstrapMod, 'sweepBootTemp');

        mod.startHourlySweep(tmpDir);
        expect(spy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(tmpDir, SWEEP_EXCLUDE_DEFAULT);

        spy.mockRestore();
    });

    it('stopHourlySweep clears the interval — no further calls after stop', () => {
        const spy = vi.spyOn(bootstrapMod, 'sweepBootTemp');

        mod.startHourlySweep(tmpDir);
        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(spy).toHaveBeenCalledOnce();

        mod.stopHourlySweep();

        vi.advanceTimersByTime(60 * 60 * 1000 * 5);
        expect(spy).toHaveBeenCalledOnce(); // still just once

        spy.mockRestore();
    });

    it('startHourlySweep is idempotent — calling twice does not double-fire', () => {
        const spy = vi.spyOn(bootstrapMod, 'sweepBootTemp');

        mod.startHourlySweep(tmpDir);
        mod.startHourlySweep(tmpDir); // second call should be a no-op

        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(spy).toHaveBeenCalledOnce();

        spy.mockRestore();
    });

    it('passes a custom intervalMs option', () => {
        const spy = vi.spyOn(bootstrapMod, 'sweepBootTemp');

        mod.startHourlySweep(tmpDir, { intervalMs: 5000 });

        vi.advanceTimersByTime(4999);
        expect(spy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(spy).toHaveBeenCalledOnce();

        spy.mockRestore();
    });

    it('passes a custom exclude array to sweepBootTemp', () => {
        const spy = vi.spyOn(bootstrapMod, 'sweepBootTemp');

        const customExclude = ['custom-dir'];
        mod.startHourlySweep(tmpDir, { intervalMs: 1000, exclude: customExclude });

        vi.advanceTimersByTime(1000);
        expect(spy).toHaveBeenCalledWith(tmpDir, customExclude);

        spy.mockRestore();
    });
});

// ─── .health/ directory survives sweep (real filesystem, real timer path) ────

describe('sweepBootTemp .health skip', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-health-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('preserves .health/ and health.json; removes stale file; keeps fresh file', () => {
        const { sweepBootTemp } = loadBootstrap();

        // Set up directory structure.
        const healthDir = path.join(tmpDir, '.health');
        fs.mkdirSync(healthDir);
        const healthJson = path.join(healthDir, 'health.json');
        fs.writeFileSync(healthJson, '{"status":"ok"}');

        const oldFile = path.join(tmpDir, 'old.txt');
        fs.writeFileSync(oldFile, 'stale data');
        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(oldFile, past, past);

        const freshFile = path.join(tmpDir, 'fresh.txt');
        fs.writeFileSync(freshFile, 'new data');

        sweepBootTemp(tmpDir);

        expect(fs.existsSync(healthDir)).toBe(true);
        expect(fs.existsSync(healthJson)).toBe(true);
        expect(fs.existsSync(oldFile)).toBe(false);
        expect(fs.existsSync(freshFile)).toBe(true);
    });
});
