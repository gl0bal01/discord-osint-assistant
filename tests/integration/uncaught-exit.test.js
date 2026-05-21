import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PATH_TO_LOGGER = path.resolve(import.meta.dirname, '../../utils/logger.js');

describe('uncaught process errors: fatal log + exit(1)', () => {
    it('uncaughtException logs fatal JSON and exits 1', () => {
        const r = spawnSync(process.execPath, ['-e', `
            process.env.NODE_ENV = 'production';
            const logger = require('${PATH_TO_LOGGER}');
            process.on('uncaughtException', (err) => {
                logger.fatal({ err }, 'uncaughtException');
                process.exit(1);
            });
            setImmediate(() => { throw new Error('boom-uncaught'); });
        `], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 });

        expect(r.status).toBe(1);
        const lines = r.stdout.trim().split('\n').filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1]);
        expect(last.level).toBe(60); // pino fatal
        expect(last.msg).toBe('uncaughtException');
        expect(last.err.message).toBe('boom-uncaught');
    });

    it('unhandledRejection logs fatal JSON and exits 1', () => {
        const r = spawnSync(process.execPath, ['-e', `
            process.env.NODE_ENV = 'production';
            const logger = require('${PATH_TO_LOGGER}');
            process.on('unhandledRejection', (reason) => {
                logger.fatal({ reason }, 'unhandledRejection');
                process.exit(1);
            });
            Promise.reject(new Error('boom-rejection'));
        `], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 });

        expect(r.status).toBe(1);
        const lines = r.stdout.trim().split('\n').filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1]);
        expect(last.level).toBe(60); // pino fatal
        expect(last.msg).toBe('unhandledRejection');
        expect(last.reason).toBeDefined();
    });
});
