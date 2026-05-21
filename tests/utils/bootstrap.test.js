import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load bootstrap fresh each time via require (CommonJS).
function loadBootstrap() {
    const resolved = require.resolve('../../utils/bootstrap.js');
    delete require.cache[resolved];
    return require('../../utils/bootstrap.js');
}

// ─── loadCommands ─────────────────────────────────────────────────────────────

describe('loadCommands', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-commands-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty Collection and zero stats when directory does not exist', () => {
        const { loadCommands } = loadBootstrap();
        const { commands, stats } = loadCommands('/nonexistent-dir-xyz-123');
        expect(commands.size).toBe(0);
        expect(stats.loaded).toBe(0);
        expect(stats.skipped).toBe(0);
        expect(stats.failed).toBe(0);
    });

    it('loads a valid command module into the Collection', () => {
        const { loadCommands } = loadBootstrap();
        const cmdFile = path.join(tmpDir, 'ping.js');
        fs.writeFileSync(cmdFile, `module.exports = { data: { name: 'ping' }, execute: () => {} };`);

        // Evict from require cache so loadCommands sees a fresh module.
        delete require.cache[cmdFile];

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.has('ping')).toBe(true);
        expect(stats.loaded).toBe(1);
        expect(stats.skipped).toBe(0);
        expect(stats.failed).toBe(0);
    });

    it('increments skipped for module missing execute', () => {
        const { loadCommands } = loadBootstrap();
        const cmdFile = path.join(tmpDir, 'bad-no-execute.js');
        fs.writeFileSync(cmdFile, `module.exports = { data: { name: 'noexec' } };`);
        delete require.cache[cmdFile];

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.size).toBe(0);
        expect(stats.skipped).toBe(1);
        expect(stats.failed).toBe(0);
    });

    it('increments skipped for module missing data', () => {
        const { loadCommands } = loadBootstrap();
        const cmdFile = path.join(tmpDir, 'bad-no-data.js');
        fs.writeFileSync(cmdFile, `module.exports = { execute: () => {} };`);
        delete require.cache[cmdFile];

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.size).toBe(0);
        expect(stats.skipped).toBe(1);
    });

    it('increments failed for a module with a syntax error', () => {
        const { loadCommands } = loadBootstrap();
        const cmdFile = path.join(tmpDir, 'broken.js');
        fs.writeFileSync(cmdFile, `this is not valid javascript %%%`);
        delete require.cache[cmdFile];

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.size).toBe(0);
        expect(stats.failed).toBe(1);
    });

    it('handles mixed valid, skipped, and failed files', () => {
        const { loadCommands } = loadBootstrap();

        const validFile = path.join(tmpDir, 'valid.js');
        const skipFile = path.join(tmpDir, 'skip.js');
        const failFile = path.join(tmpDir, 'fail.js');

        fs.writeFileSync(validFile, `module.exports = { data: { name: 'valid' }, execute: () => {} };`);
        fs.writeFileSync(skipFile, `module.exports = { data: { name: 'skip' } };`);
        fs.writeFileSync(failFile, `throw new Error('load error');`);

        for (const f of [validFile, skipFile, failFile]) delete require.cache[f];

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.size).toBe(1);
        expect(stats.loaded).toBe(1);
        expect(stats.skipped).toBe(1);
        expect(stats.failed).toBe(1);
    });

    it('ignores non-.js files', () => {
        const { loadCommands } = loadBootstrap();
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '# ignored');
        fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');

        const { commands, stats } = loadCommands(tmpDir);
        expect(commands.size).toBe(0);
        expect(stats.loaded + stats.skipped + stats.failed).toBe(0);
    });
});

// ─── parseAllowedGuilds ───────────────────────────────────────────────────────

describe('parseAllowedGuilds', () => {
    it('returns empty array for empty string', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds(undefined)).toEqual([]);
    });

    it('returns single id for a single value', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('123456789')).toEqual(['123456789']);
    });

    it('splits comma-separated ids', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('111,222,333')).toEqual(['111', '222', '333']);
    });

    it('trims whitespace around ids', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('  111 , 222 , 333  ')).toEqual(['111', '222', '333']);
    });

    it('ignores trailing commas', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('111,222,')).toEqual(['111', '222']);
    });

    it('ignores empty segments between extra commas', () => {
        const { parseAllowedGuilds } = loadBootstrap();
        expect(parseAllowedGuilds('111,,222')).toEqual(['111', '222']);
    });
});

// ─── sweepBootTemp ────────────────────────────────────────────────────────────

describe('sweepBootTemp', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-sweep-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.useRealTimers();
    });

    it('returns { swept: 0, kept: 0 } when directory does not exist', () => {
        const { sweepBootTemp } = loadBootstrap();
        const result = sweepBootTemp('/no-such-dir-xyz-987');
        expect(result).toEqual({ swept: 0, kept: 0 });
    });

    it('keeps fresh files (mtime < 24h ago)', () => {
        const { sweepBootTemp } = loadBootstrap();
        const freshFile = path.join(tmpDir, 'fresh.txt');
        fs.writeFileSync(freshFile, 'data');
        // File was just created — well within 24h window.

        const result = sweepBootTemp(tmpDir);
        expect(result.kept).toBe(1);
        expect(result.swept).toBe(0);
        expect(fs.existsSync(freshFile)).toBe(true);
    });

    it('deletes files with mtime older than 24h', () => {
        const { sweepBootTemp } = loadBootstrap();
        const oldFile = path.join(tmpDir, 'old.txt');
        fs.writeFileSync(oldFile, 'stale');

        // Back-date mtime to 25 hours ago.
        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(oldFile, past, past);

        const result = sweepBootTemp(tmpDir);
        expect(result.swept).toBe(1);
        expect(result.kept).toBe(0);
        expect(fs.existsSync(oldFile)).toBe(false);
    });

    it('deletes stale subdirectories recursively', () => {
        const { sweepBootTemp } = loadBootstrap();
        const oldDir = path.join(tmpDir, 'stale-dir');
        fs.mkdirSync(oldDir);
        fs.writeFileSync(path.join(oldDir, 'inner.txt'), 'content');

        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(oldDir, past, past);

        const result = sweepBootTemp(tmpDir);
        expect(result.swept).toBe(1);
        expect(fs.existsSync(oldDir)).toBe(false);
    });

    it('skips files in the default exclude list (.health)', () => {
        const { sweepBootTemp } = loadBootstrap();
        const healthDir = path.join(tmpDir, '.health');
        fs.mkdirSync(healthDir);

        // Back-date so it would normally be swept.
        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(healthDir, past, past);

        const result = sweepBootTemp(tmpDir);
        expect(result.swept).toBe(0);
        expect(result.kept).toBe(1);
        expect(fs.existsSync(healthDir)).toBe(true);
    });

    it('skips files in a custom exclude list', () => {
        const { sweepBootTemp } = loadBootstrap();
        const keepFile = path.join(tmpDir, 'keep-me.txt');
        fs.writeFileSync(keepFile, 'protected');

        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(keepFile, past, past);

        const result = sweepBootTemp(tmpDir, ['keep-me.txt']);
        expect(result.swept).toBe(0);
        expect(result.kept).toBe(1);
        expect(fs.existsSync(keepFile)).toBe(true);
    });

    it('handles a mix of fresh and stale files', () => {
        const { sweepBootTemp } = loadBootstrap();
        const freshFile = path.join(tmpDir, 'new.txt');
        const oldFile = path.join(tmpDir, 'old.txt');
        fs.writeFileSync(freshFile, 'new');
        fs.writeFileSync(oldFile, 'old');

        const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
        fs.utimesSync(oldFile, past, past);

        const result = sweepBootTemp(tmpDir);
        expect(result.swept).toBe(1);
        expect(result.kept).toBe(1);
        expect(fs.existsSync(freshFile)).toBe(true);
        expect(fs.existsSync(oldFile)).toBe(false);
    });
});

// ─── createShutdownHandler ────────────────────────────────────────────────────

describe('createShutdownHandler', () => {
    it('calls shutdown() on each command that has one', () => {
        const { createShutdownHandler } = loadBootstrap();
        const shutdownA = vi.fn();
        const shutdownB = vi.fn();
        const client = {
            commands: new Map([
                ['a', { shutdown: shutdownA }],
                ['b', { shutdown: shutdownB }],
                ['c', {}]  // no shutdown — should be skipped silently
            ]),
            destroy: vi.fn()
        };

        const handler = createShutdownHandler(client);
        handler('SIGTERM');

        expect(shutdownA).toHaveBeenCalledOnce();
        expect(shutdownB).toHaveBeenCalledOnce();
    });

    it('calls client.destroy()', () => {
        const { createShutdownHandler } = loadBootstrap();
        const client = { commands: new Map(), destroy: vi.fn() };
        const handler = createShutdownHandler(client);
        handler('SIGINT');
        expect(client.destroy).toHaveBeenCalledOnce();
    });

    it('is idempotent — second call is a no-op', () => {
        const { createShutdownHandler } = loadBootstrap();
        const destroy = vi.fn();
        const client = { commands: new Map(), destroy };
        const handler = createShutdownHandler(client);
        handler('SIGINT');
        handler('SIGINT');
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('calls onSignal hook with the signal name', () => {
        const { createShutdownHandler } = loadBootstrap();
        const onSignal = vi.fn();
        const client = { commands: new Map(), destroy: vi.fn() };
        const handler = createShutdownHandler(client, { onSignal });
        handler('SIGTERM');
        expect(onSignal).toHaveBeenCalledWith('SIGTERM');
    });

    it('calls onDrain hook after commands are shut down', () => {
        const { createShutdownHandler } = loadBootstrap();
        const order = [];
        const client = {
            commands: new Map([['x', { shutdown: () => order.push('cmd') }]]),
            destroy: vi.fn()
        };
        const handler = createShutdownHandler(client, {
            onSignal: () => order.push('signal'),
            onDrain: () => order.push('drain')
        });
        handler('SIGINT');
        expect(order).toEqual(['signal', 'cmd', 'drain']);
    });

    it('does not throw if a command shutdown() throws', () => {
        const { createShutdownHandler } = loadBootstrap();
        const client = {
            commands: new Map([['bad', { shutdown: () => { throw new Error('boom'); } }]]),
            destroy: vi.fn()
        };
        const handler = createShutdownHandler(client);
        expect(() => handler('SIGINT')).not.toThrow();
        expect(client.destroy).toHaveBeenCalledOnce();
    });

    it('does not throw if onSignal hook throws', () => {
        const { createShutdownHandler } = loadBootstrap();
        const client = { commands: new Map(), destroy: vi.fn() };
        const handler = createShutdownHandler(client, {
            onSignal: () => { throw new Error('hook error'); }
        });
        expect(() => handler('SIGTERM')).not.toThrow();
        expect(client.destroy).toHaveBeenCalledOnce();
    });

    it('works when client.commands is absent', () => {
        const { createShutdownHandler } = loadBootstrap();
        const client = { destroy: vi.fn() };
        const handler = createShutdownHandler(client);
        expect(() => handler('SIGINT')).not.toThrow();
        expect(client.destroy).toHaveBeenCalledOnce();
    });
});
