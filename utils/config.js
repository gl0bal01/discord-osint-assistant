/**
 * Environment variable registry.
 *
 * REQUIRED is validated when this module is imported (index.js): the bot exits 1 if
 * one is missing. OPTIONAL lists every other variable the bot reads and why; each
 * default lives where the value is read. tests/utils/env-contract.test.js keeps this
 * registry, the code, .env.example and the logger's redact list in sync, so a variable
 * can't be read without being documented (or documented without being read).
 */

const logger = require('./logger');

const REQUIRED = {
    DISCORD_TOKEN: 'Discord bot token',
    CLIENT_ID: 'Discord application client ID'
};

const OPTIONAL = {
    // Discord and access control
    GUILD_ID: 'Guild for `bun run deploy` (guild commands); deploy/clear scripts only',
    ALLOWED_GUILD_IDS: 'Comma-separated guild IDs the bot may operate in (empty = all)',
    OSINT_ALLOWED_ROLES: 'Comma-separated role IDs that may use restricted commands without the permission',
    MONITOR_CHANNEL_ID: 'Channel for /bob-monitor alerts',
    RATE_LIMIT_DAILY: 'Per-user daily command limit (default 200)',

    // Operations
    LOG_LEVEL: 'pino level: fatal, error, warn, info (default), debug, trace, silent',
    HEALTH_FILE: 'Health state file read by the Docker healthcheck (default ./temp/.health/health.json)',
    METRICS_ENABLED: 'true to serve Prometheus metrics (default off)',
    METRICS_PORT: 'Metrics port (default 9090)',
    METRICS_HOST: 'Metrics bind address (default 127.0.0.1)',
    REPORTS_DIR: 'Where command exports are copied (default ./reports; ephemeral in Docker/systemd)',
    REPORTS_RETENTION_DAYS: 'Reports older than this are pruned (default 30)',
    // Consumed only by commands/redirect-chain.js notifyWebhook(); don't generalize without a cooldown.
    SECURITY_WEBHOOK_URL: 'Webhook for /bob-redirect-check security alerts',

    // API keys (each command degrades gracefully without its key)
    AI_API_KEY: '1min.ai key for /bob-chat and /bob-upload',
    DNSDUMPSTER_TOKEN: 'DNSDumpster key for /bob-dns (and /bob-health check-apis)',
    WHOXY_API_KEY: 'Whoxy key for /bob-whoxy',
    HOSTIO_API_KEY: 'Host.io key for /bob-hostio',
    PAPPERS_API_KEY: 'Pappers key for /bob-pappers',
    ETHERSCAN_API_KEY: 'Etherscan API V2 key: every EVM chain in /bob-blockchain (free plan: not BNB Chain)',
    AVIATIONSTACK_API_KEY: 'AviationStack key for /bob-flight',
    AIRPORTDB_API_KEY: 'AirportDB key for /bob-airport',
    NIKE_TOKEN: 'Nike token for /bob-nike (expires after ~1 hour)',
    AWS_ACCESS_KEY_ID: 'AWS access key for /bob-rekognition',
    AWS_SECRET_ACCESS_KEY: 'AWS secret key for /bob-rekognition',
    AWS_REGION: 'AWS region for /bob-rekognition (default us-east-1)',

    // External tools (only needed outside the full Docker image)
    EXIFTOOL_PATH: 'exiftool binary (default: exiftool on PATH)',
    SHERLOCK_PATH: 'sherlock binary (default: sherlock on PATH)',
    MAIGRET_PATH: 'maigret binary (default: maigret on PATH)',
    NUCLEI_PATH: 'nuclei binary (default: nuclei on PATH)',
    NUCLEI_TEMPLATE_PATH: 'nuclei OSINT templates (default /opt/nuclei-templates/http/osint/user-enumeration)',
    JWT_TOOL_PATH: 'jwt_tool checkout (default /opt/tools/jwt_tool)',
    JWT_WORDLIST: 'Wordlist for /bob-jwt crack mode:dict (default: jwt_tool\'s jwt-common.txt)',
    GHUNT_CREDS_PATH: 'GHunt credentials file (default ~/.malfrats/ghunt/creds.m)'
};

const missing = Object.entries(REQUIRED)
    .filter(([key]) => !process.env[key])
    .map(([key, desc]) => `${key} (${desc})`);
if (missing.length > 0) {
    logger.error({ missing }, 'Missing required environment variables');
    process.exit(1);
}

module.exports = { REQUIRED, OPTIONAL };
