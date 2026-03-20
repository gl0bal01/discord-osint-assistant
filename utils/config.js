/**
 * Centralized configuration module.
 * Validates required env vars at startup, provides defaults for optional ones.
 */

const REQUIRED = {
    DISCORD_TOKEN: 'Discord bot token'
};

const OPTIONAL = {
    MONITOR_CHANNEL_ID: { desc: 'Channel ID for monitor alerts', default: null },
    SHERLOCK_PATH: { desc: 'Path to sherlock binary', default: 'sherlock' },
    MAIGRET_PATH: { desc: 'Path to maigret binary', default: 'maigret' },
    NUCLEI_PATH: { desc: 'Path to nuclei binary', default: 'nuclei' },
    NUCLEI_TEMPLATE_PATH: { desc: 'Path to nuclei templates', default: '/opt/nuclei-templates/http/osint/user-enumeration' },
    EXIFTOOL_PATH: { desc: 'Path to exiftool binary', default: 'exiftool' },
    JWT_TOOL_PATH: { desc: 'Path to jwt_tool', default: '/opt/tools/jwt_tool' },
    OPENAI_API_KEY: { desc: 'OpenAI API key for chat', default: null },
    ANTHROPIC_API_KEY: { desc: 'Anthropic API key for chat', default: null },
    AI_API_KEY: { desc: 'AI API key for chat fallback', default: null },
    VIRUSTOTAL_API_KEY: { desc: 'VirusTotal API key', default: null },
    WHOXY_API_KEY: { desc: 'Whoxy API key', default: null },
    HOSTIO_API_KEY: { desc: 'Host.io API key', default: null },
    DNSDUMPSTER_TOKEN: { desc: 'DNSDumpster API token', default: null },
    PAPPERS_API_KEY: { desc: 'Pappers API key for French company data', default: null },
    ETHERSCAN_API_KEY: { desc: 'Etherscan API key for Ethereum', default: null },
    BSCSCAN_API_KEY: { desc: 'BscScan API key for Binance Smart Chain', default: null },
    POLYGONSCAN_API_KEY: { desc: 'PolygonScan API key for Polygon', default: null },
    AVIATIONSTACK_API_KEY: { desc: 'AviationStack API key for flight data', default: null },
    AIRPORTDB_API_KEY: { desc: 'AirportDB API key for airport data', default: null },
    NIKE_TOKEN: { desc: 'Nike API token', default: null },
    ALLOWED_GUILD_IDS: { desc: 'Comma-separated guild IDs the bot is allowed to operate in (empty = all)', default: '' },
    OSINT_ALLOWED_ROLES: { desc: 'Comma-separated Discord role IDs for OSINT access', default: '' },
    SECURITY_WEBHOOK_URL: { desc: 'Webhook URL for security alerts', default: null },
    AWS_ACCESS_KEY_ID: { desc: 'AWS access key for Rekognition', default: null },
    AWS_SECRET_ACCESS_KEY: { desc: 'AWS secret key for Rekognition', default: null },
    AWS_REGION: { desc: 'AWS region', default: 'us-east-1' }
};

function loadConfig() {
    const config = {};
    const missing = [];

    for (const [key, desc] of Object.entries(REQUIRED)) {
        if (!process.env[key]) {
            missing.push(`${key} (${desc})`);
        }
        config[key] = process.env[key];
    }

    if (missing.length > 0) {
        console.error('Missing required environment variables:');
        missing.forEach(v => console.error(`  - ${v}`));
        process.exit(1);
    }

    for (const [key, { default: def }] of Object.entries(OPTIONAL)) {
        config[key] = process.env[key] !== undefined ? process.env[key] : def;
    }

    return config;
}

module.exports = { loadConfig, REQUIRED, OPTIONAL };
