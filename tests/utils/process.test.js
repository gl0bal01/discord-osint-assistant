import { describe, it, expect } from 'vitest';
import { safeSpawn } from '../../utils/process.js';

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
});
