import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { safeSpawn, safeSpawnToFile } from '../../utils/process.js';

const mkTmp = () => path.join(os.tmpdir(), `osint-bot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const cleanups = [];
afterEach(async () => {
    while (cleanups.length) {
        try { await fsp.unlink(cleanups.pop()); } catch { /* already gone */ }
    }
});

describe('safeSpawn', () => {
    it('executes a simple command', async () => {
        const result = await safeSpawn('echo', ['hello']);
        expect(result.stdout.trim()).toBe('hello');
        expect(result.code).toBe(0);
    });

    it('captures stderr', async () => {
        const result = await safeSpawn('node', ['-e', 'console.error("err")']);
        expect(result.stderr.trim()).toBe('err');
    });

    it('returns exit code', async () => {
        const result = await safeSpawn('node', ['-e', 'process.exit(42)']);
        expect(result.code).toBe(42);
    });

    it('handles command not found', async () => {
        await expect(safeSpawn('nonexistent-command-xyz-123', []))
            .rejects.toThrow('Failed to start process');
    });

    it('handles timeout', async () => {
        await expect(safeSpawn('sleep', ['10'], { timeout: 200 }))
            .rejects.toThrow('timed out');
    }, 10000);

    it('passes arguments safely without shell interpretation', async () => {
        const result = await safeSpawn('echo', ['hello; rm -rf /']);
        expect(result.stdout.trim()).toBe('hello; rm -rf /');
    });

    it('passes dollar signs without expansion', async () => {
        const result = await safeSpawn('echo', ['$HOME']);
        expect(result.stdout.trim()).toBe('$HOME');
    });

    it('passes backticks without expansion', async () => {
        const result = await safeSpawn('echo', ['`whoami`']);
        expect(result.stdout.trim()).toBe('`whoami`');
    });

    it('rejects when stdout exceeds maxBuffer', async () => {
        // 'yes' floods stdout. maxBuffer 1KB => quick rejection.
        await expect(safeSpawn('yes', [], { maxBuffer: 1024, timeout: 5000 }))
            .rejects.toThrow('Output exceeded maximum buffer size');
    }, 10000);

    it('child env does not contain caller secrets', async () => {
        process.env.TEST_SECRET_VAR = 'must-not-leak';
        try {
            const result = await safeSpawn('node', ['-e', 'console.log(process.env.TEST_SECRET_VAR || "unset")']);
            expect(result.stdout.trim()).toBe('unset');
        } finally {
            delete process.env.TEST_SECRET_VAR;
        }
    });
});

describe('safeSpawnToFile', () => {
    it('writes stdout to the given file', async () => {
        const out = mkTmp();
        cleanups.push(out);
        const result = await safeSpawnToFile('echo', ['written'], out);
        expect(result.code).toBe(0);
        const content = await fsp.readFile(out, 'utf8');
        expect(content.trim()).toBe('written');
    });

    it('rejects when output exceeds maxFileSize', async () => {
        const out = mkTmp();
        cleanups.push(out);
        await expect(safeSpawnToFile('yes', [], out, { maxFileSize: 1024, timeout: 5000 }))
            .rejects.toThrow('Output file exceeded maximum size');
    }, 10000);

    it('feeds input to stdin when input option is set', async () => {
        const out = mkTmp();
        cleanups.push(out);
        // node -e 'process.stdin.pipe(process.stdout)' echoes stdin to stdout
        const result = await safeSpawnToFile(
            'node',
            ['-e', 'process.stdin.pipe(process.stdout)'],
            out,
            { input: 'piped-secret' }
        );
        expect(result.code).toBe(0);
        const content = await fsp.readFile(out, 'utf8');
        expect(content.trim()).toBe('piped-secret');
    });
});
