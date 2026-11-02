/**
 * Centralized pino logger.
 * Import this module anywhere structured logging is needed.
 * Redacts sensitive fields before they reach stdout.
 */

const pino = require('pino');

const _pinoOptions = {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            // top-level fields
            'token',
            'authorization',
            'password',
            'api_key',
            'headers.authorization',
            'headers.cookie',
            'req.headers.authorization',
            // explicit secret env names (case-sensitive in pino)
            'DISCORD_TOKEN',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'AI_API_KEY',
            'VIRUSTOTAL_API_KEY',
            'WHOXY_API_KEY',
            'HOSTIO_API_KEY',
            'DNSDUMPSTER_TOKEN',
            'PAPPERS_API_KEY',
            'ETHERSCAN_API_KEY',
            'BSCSCAN_API_KEY',
            'POLYGONSCAN_API_KEY',
            'AVIATIONSTACK_API_KEY',
            'AIRPORTDB_API_KEY',
            'NIKE_TOKEN',
            'SECURITY_WEBHOOK_URL',
            'MARITIME_API_KEY',
            // nested under any single parent object
            '*.token',
            '*.authorization',
            '*.password',
            '*.api_key',
            '*.headers.authorization',
            '*.headers.cookie',
            '*.DISCORD_TOKEN',
            '*.AWS_ACCESS_KEY_ID',
            '*.AWS_SECRET_ACCESS_KEY',
            '*.OPENAI_API_KEY',
            '*.ANTHROPIC_API_KEY',
            '*.AI_API_KEY',
            '*.VIRUSTOTAL_API_KEY',
            '*.WHOXY_API_KEY',
            '*.HOSTIO_API_KEY',
            '*.DNSDUMPSTER_TOKEN',
            '*.PAPPERS_API_KEY',
            '*.ETHERSCAN_API_KEY',
            '*.BSCSCAN_API_KEY',
            '*.POLYGONSCAN_API_KEY',
            '*.AVIATIONSTACK_API_KEY',
            '*.AIRPORTDB_API_KEY',
            '*.NIKE_TOKEN',
            '*.SECURITY_WEBHOOK_URL',
            '*.MARITIME_API_KEY'
        ],
        censor: '[REDACTED]'
    }
};

// Secret env names are the upper-case redact paths above.
const SECRET_ENV = _pinoOptions.redact.paths.filter((p) => /^[A-Z][A-Z0-9_]+$/.test(p));

// Discord interaction/webhook tokens sit in URL paths (e.g. DiscordAPIError.url).
const TOKEN_IN_PATH = /(\/(?:webhooks|interactions)\/\d+\/)[\w.-]+/g;

function scrubSecrets(text) {
    if (typeof text !== 'string') return text;
    for (const name of SECRET_ENV) {
        const value = process.env[name];
        if (!value || value.length < 8) continue;
        for (const form of new Set([value, encodeURIComponent(value)])) text = text.split(form).join('[REDACTED]');
    }
    return text.replace(TOKEN_IN_PATH, '$1[REDACTED]');
}

// Request/response objects (axios config, DiscordAPIError.requestBody, sockets)
// carry keys, headers and payloads: dropped at any depth, not just the top level.
const DROP_KEYS = new Set(['config', 'request', 'response', 'requestBody', 'headers', 'socket', '_header']);

function scrubDeep(value, depth = 0, seen = new WeakSet()) {
    if (typeof value === 'string') return scrubSecrets(value);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    if (depth > 8) return '[Truncated]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1, seen));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (!DROP_KEYS.has(k)) out[k] = scrubDeep(v, depth + 1, seen);
    }
    return out;
}

/**
 * Error serializer. Axios errors carry the request config, whose headers and URL
 * query hold API keys (e.g. `?key=...`, `API-KEY:`), plus the whole socket/response;
 * nested errors (`cause`, AggregateError.errors, wrappers) carry the same. Keep what
 * helps debugging, drop request data at every depth, scrub every string.
 */
function errSerializer(err) {
    if (err === null || typeof err !== 'object') return scrubDeep(err);
    const out = scrubDeep(err instanceof Error ? pino.stdSerializers.err(err) : err);
    if (err.config || err.response) {
        out.status = err.response?.status ?? err.status;
        out.method = err.config?.method;
        out.url = scrubSecrets(String(err.config?.url ?? '').split('?')[0]) || undefined;
    } else if (typeof err.url === 'string') {
        out.url = scrubSecrets(err.url.split('?')[0]);
    }
    return out;
}
_pinoOptions.serializers = { err: errSerializer, error: errSerializer };

// Use pino-pretty in dev (non-production + interactive TTY)
if (process.env.NODE_ENV !== 'production' && process.stdout.isTTY) {
    _pinoOptions.transport = {
        target: 'pino-pretty',
        options: { colorize: true }
    };
}

let logger;
try {
    logger = pino(_pinoOptions);
} catch (err) {
    // eslint-disable-next-line no-console
    console.error('FATAL: logger init failed', err);
    process.exit(1);
}

module.exports = logger;
module.exports._pinoOptions = _pinoOptions;
