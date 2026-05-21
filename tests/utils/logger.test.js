/**
 * Tests for utils/logger.js
 * Uses an inline pino instance with the same _pinoOptions to avoid
 * writing to real stdout from the singleton.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';

// Import the shared options from the logger module (no circular dep, no side-effects)
import loggerModule from '../../utils/logger.js';
const { _pinoOptions } = loggerModule;

/**
 * Build a test logger that writes to an in-memory sink.
 * Returns { logger, lines } where lines accumulates parsed JSON objects.
 */
function buildTestLogger(levelOverride) {
    const lines = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            try { lines.push(JSON.parse(chunk.toString())); } catch { /* ignore non-JSON */ }
            cb();
        }
    });

    const opts = {
        ...structuredClone({ level: _pinoOptions.level, redact: _pinoOptions.redact }),
        ...(levelOverride ? { level: levelOverride } : {})
    };

    const logger = pino(opts, sink);
    return { logger, lines };
}

describe('logger — JSON output shape', () => {
    it('emits an object with level, time, and msg fields', () => {
        const { logger, lines } = buildTestLogger();
        logger.info('hello world');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ msg: 'hello world' });
        expect(typeof lines[0].level).toBe('number');
        expect(typeof lines[0].time).toBe('number');
    });

    it('includes structured context in the log record', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ count: 42 }, 'counted');
        expect(lines[0].count).toBe(42);
        expect(lines[0].msg).toBe('counted');
    });
});

describe('logger — redaction', () => {
    it('redacts token field', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ token: 'secret123' }, 'test');
        expect(lines[0].token).toBe('[REDACTED]');
        expect(JSON.stringify(lines[0])).not.toContain('secret123');
    });

    it('redacts authorization field', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ authorization: 'Bearer abc' }, 'test');
        expect(lines[0].authorization).toBe('[REDACTED]');
    });

    it('redacts password field', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ password: 'hunter2' }, 'test');
        expect(lines[0].password).toBe('[REDACTED]');
    });

    it('redacts api_key field', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ api_key: 'key-xyz' }, 'test');
        expect(lines[0].api_key).toBe('[REDACTED]');
    });

    it('redacts nested headers.authorization', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ headers: { authorization: 'Bearer tok' } }, 'test');
        expect(lines[0].headers.authorization).toBe('[REDACTED]');
    });

    it('does not redact unrelated fields', () => {
        const { logger, lines } = buildTestLogger();
        logger.info({ username: 'alice', count: 5 }, 'test');
        expect(lines[0].username).toBe('alice');
        expect(lines[0].count).toBe(5);
    });
});

describe('logger — child logger', () => {
    it('child logger inherits redaction', () => {
        const { logger, lines } = buildTestLogger();
        const child = logger.child({ component: 'test' });
        child.info({ token: 'child-secret' }, 'child log');
        expect(lines[0].token).toBe('[REDACTED]');
        expect(lines[0].component).toBe('test');
    });
});

describe('logger — log level filtering', () => {
    it('default level suppresses debug calls', () => {
        const { logger, lines } = buildTestLogger('info');
        logger.debug('should be suppressed');
        expect(lines).toHaveLength(0);
    });

    it('debug level enables debug calls', () => {
        const { logger, lines } = buildTestLogger('debug');
        logger.debug('should appear');
        expect(lines).toHaveLength(1);
        expect(lines[0].msg).toBe('should appear');
    });

    it('info level passes info calls through', () => {
        const { logger, lines } = buildTestLogger('info');
        logger.info('info message');
        expect(lines).toHaveLength(1);
    });

    it('warn level suppresses info calls', () => {
        const { logger, lines } = buildTestLogger('warn');
        logger.info('should be suppressed');
        expect(lines).toHaveLength(0);
    });
});
