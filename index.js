// Main Discord bot entry point for OSINT Assistant — gl0bal01
require('dotenv').config();

const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const path = require('node:path');
const { checkPermission } = require('./utils/permissions');
const { checkRateLimit, startRateLimitPrune, stopRateLimitPrune } = require('./utils/ratelimit');
const bootstrap = require('./utils/bootstrap');
const logger = require('./utils/logger');
const { startHealthWriter, stopHealthWriter, markReady, markShuttingDown, writeStartingState } = require('./utils/health');
const { startMetricsServer, stopMetricsServer, commandDuration, commandErrors, ratelimitBlocks, discordEvents } = require('./utils/metrics');
const { startHourlySweep, stopHourlySweep } = require('./utils/temp-sweep');

require('./utils/config'); // validates env; exits(1) on missing required vars

const tempDir = path.join(__dirname, 'temp');
bootstrap.sweepBootTemp(tempDir);
startHourlySweep(tempDir);

const HEALTH_FILE = process.env.HEALTH_FILE || './temp/.health/health.json';
writeStartingState(HEALTH_FILE);
startHealthWriter({ path: HEALTH_FILE, intervalMs: 5000 });
startRateLimitPrune();

let metricsServer = null;
if (process.env.METRICS_ENABLED === 'true') {
    metricsServer = startMetricsServer({ port: parseInt(process.env.METRICS_PORT || '9090', 10), host: process.env.METRICS_HOST || '127.0.0.1' });
    metricsServer.catch(err => logger.error({ err }, 'metrics server failed to start'));
}

const ALLOWED_GUILDS = bootstrap.parseAllowedGuilds(process.env.ALLOWED_GUILD_IDS);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    allowedMentions: { parse: ['users'], repliedUser: false }
});

const { commands, stats } = bootstrap.loadCommands(path.join(__dirname, 'commands'));
client.commands = commands;
logger.info({ loaded: stats.loaded, skipped: stats.skipped, failed: stats.failed }, 'Commands loaded');

const shutdownHandler = bootstrap.createShutdownHandler(client, {
    onSignal: (signal) => { logger.info({ signal }, 'shutdown signal received'); markShuttingDown(); },
    onDrain: async () => { stopRateLimitPrune(); stopHealthWriter(); stopHourlySweep(); if (metricsServer) await stopMetricsServer(); }
});
process.on('SIGINT', () => shutdownHandler('SIGINT'));
process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

function leaveUnauthorized(guild) {
    if (ALLOWED_GUILDS.length > 0 && !ALLOWED_GUILDS.includes(guild.id)) {
        logger.info({ guildName: guild.name, guildId: guild.id }, 'Leaving unauthorized guild');
        guild.leave().catch(err => logger.error({ guildId: guild.id, err }, 'Failed to leave guild'));
    }
}

client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size, commands: client.commands.size }, 'OSINT Assistant online');
    client.user.setActivity('OSINT operations', { type: 'WATCHING' });
    if (ALLOWED_GUILDS.length > 0) readyClient.guilds.cache.forEach(leaveUnauthorized);
    markReady();
    discordEvents.inc({ event: 'ready' });
});

client.on(Events.GuildCreate, leaveUnauthorized);

client.on(Events.InteractionCreate, async interaction => {
    if (ALLOWED_GUILDS.length > 0) {
        if (!interaction.guild || !ALLOWED_GUILDS.includes(interaction.guild.id)) {
            if (interaction.isRepliable?.()) {
                try { await interaction.reply({ content: 'This bot is not authorized in this context.', flags: MessageFlags.Ephemeral }); }
                catch { /* expired */ }
            }
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    const cmdName = interaction.commandName;
    const command = client.commands.get(cmdName);
    if (!command) { logger.error({ commandName: cmdName }, 'No command matching name was found'); return; }

    const { allowed, reason } = checkPermission(interaction);
    if (!allowed) {
        try {
            return await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }
    const { limited, reason: rateLimitReason } = checkRateLimit(interaction.user.id, cmdName);
    if (limited) {
        ratelimitBlocks.inc({ command: cmdName });
        try {
            return await interaction.reply({ content: rateLimitReason, flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }

    logger.info({
        command: cmdName,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guild?.id,
        guildName: interaction.guild?.name
    }, 'Command invoked');

    const endTimer = commandDuration.startTimer({ command: cmdName });
    try {
        await command.execute(interaction);
        logger.info({ command: cmdName }, 'Command completed successfully');
    } catch (error) {
        commandErrors.inc({ command: cmdName, reason: error.name || 'Error' });
        logger.error({ command: cmdName, err: error }, 'Error executing command');
        const msg = 'There was an error while executing this command! Please try again later.';
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
            else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        } catch (e) { logger.error({ err: e }, 'Failed to send error message to user'); }
    } finally {
        endTimer();
    }
});

process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaughtException'); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'unhandledRejection'); process.exit(1); });

logger.info('Starting Discord OSINT Assistant...');
client.login(process.env.DISCORD_TOKEN);
