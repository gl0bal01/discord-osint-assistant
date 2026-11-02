/**
 * Tests for utils/logger.js
 * Uses an inline pino instance with the same _pinoOptions to avoid
 * writing to real stdout from the singleton.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
        ...structuredClone({ level: 'info', redact: _pinoOptions.redact }),
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

describe('logger — error serializer', () => {
    it('drops axios request config and scrubs known secret values', () => {
        const lines = [];
        const sink = new Writable({ write(c, _e, cb) { lines.push(JSON.parse(c.toString())); cb(); } });
        const log = pino({ redact: _pinoOptions.redact, serializers: _pinoOptions.serializers }, sink);
        const secret = 'whoxy-secret-key-1234';
        const prev = process.env.WHOXY_API_KEY;
        process.env.WHOXY_API_KEY = secret;
        try {
            const err = new Error(`Request failed for ${secret}`);
            err.config = { method: 'get', url: `https://api.whoxy.com/?key=${secret}&whois=x`, headers: { 'API-KEY': secret } };
            err.response = { status: 401, config: err.config };
            log.error({ err }, 'whoxy failed');
            const out = JSON.stringify(lines[0]);
            expect(out).not.toContain(secret);
            expect(lines[0].err).toMatchObject({ status: 401, method: 'get', url: 'https://api.whoxy.com/' });
            expect(lines[0].err.config).toBeUndefined();
        } finally {
            if (prev === undefined) delete process.env.WHOXY_API_KEY; else process.env.WHOXY_API_KEY = prev;
        }
    });
});

describe('logger — error serializer: nested and non-axios shapes', () => {
    const secret = 'whoxy-secret-key-1234+/=';
    let prev;
    const capture = (obj) => {
        const lines = [];
        const sink = new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } });
        pino({ redact: _pinoOptions.redact, serializers: _pinoOptions.serializers }, sink).error(obj, 'failed');
        return lines[0];
    };
    const axiosErr = () => Object.assign(new Error('Request failed with status code 401'), {
        config: { url: `https://api.whoxy.com/?key=${secret}`, headers: { 'API-KEY': secret }, params: { key: secret } },
        response: { status: 401, data: { echo: secret } }
    });

    beforeEach(() => { prev = process.env.WHOXY_API_KEY; process.env.WHOXY_API_KEY = secret; });
    afterEach(() => { if (prev === undefined) delete process.env.WHOXY_API_KEY; else process.env.WHOXY_API_KEY = prev; });

    it('drops request data from an axios error wrapped under any key', () => {
        const wrapper = Object.assign(new Error('lookup failed'), { original: axiosErr() });
        const out = capture({ err: wrapper });
        expect(out).not.toContain(secret);
        expect(out).toContain('lookup failed');
    });

    it('covers AggregateError members and cause chains', () => {
        expect(capture({ err: new AggregateError([axiosErr()], 'all failed') })).not.toContain(secret);
        expect(capture({ err: new Error('outer', { cause: axiosErr() }) })).not.toContain(secret);
    });

    it('scrubs URL-encoded secrets and non-Error throwables', () => {
        expect(capture({ err: new Error(`bad url ?k=${encodeURIComponent(secret)}`) })).not.toContain(encodeURIComponent(secret));
        expect(capture({ err: { message: 'thrown object', config: { headers: { 'API-KEY': secret } } } })).not.toContain(secret);
        expect(capture({ err: `string throw ${secret}` })).not.toContain(secret);
    });

    it('redacts the Discord interaction token in a DiscordAPIError url and drops its request body', () => {
        const djs = Object.assign(new Error('Unknown interaction'), {
            url: 'https://discord.com/api/v10/webhooks/123456789/aW50ZXJhY3Rpb24tdG9rZW4.abc_def-123/messages/@original',
            requestBody: { json: { content: 'private reply' }, files: [] },
            status: 404
        });
        const out = capture({ err: djs });
        expect(out).not.toContain('aW50ZXJhY3Rpb24tdG9rZW4');
        expect(out).not.toContain('private reply');
        expect(out).toContain('/webhooks/123456789/[REDACTED]');
    });

    it('survives circular references', () => {
        const err = new Error('loop');
        err.self = err;
        expect(() => capture({ err })).not.toThrow();
    });
});

