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
            '*.SECURITY_WEBHOOK_URL'
        ],
        censor: '[REDACTED]'
    }
};

// Secret env names are the upper-case redact paths above.
const SECRET_ENV = _pinoOptions.redact.paths.filter((p) => /^[A-Z][A-Z0-9_]+$/.test(p));

function scrubSecrets(text) {
    if (typeof text !== 'string') return text;
    for (const name of SECRET_ENV) {
        const value = process.env[name];
        if (value && value.length >= 8) text = text.split(value).join('[REDACTED]');
    }
    return text;
}

/**
 * Error serializer. Axios errors carry the request config, whose headers and URL
 * query hold API keys (e.g. `?key=...`, `API-KEY:`), plus the whole socket/response.
 * Keep only what helps debugging, and scrub any known secret value that remains.
 */
function errSerializer(err) {
    if (!(err instanceof Error)) return err;
    const out = pino.stdSerializers.err(err);
    if (err.config || err.request || err.response) {
        delete out.config;
        delete out.request;
        delete out.response;
        out.status = err.response?.status;
        out.method = err.config?.method;
        out.url = String(err.config?.url ?? '').split('?')[0] || undefined;
    }
    out.message = scrubSecrets(out.message);
    out.stack = scrubSecrets(out.stack);
    if (out.url) out.url = scrubSecrets(out.url);
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
