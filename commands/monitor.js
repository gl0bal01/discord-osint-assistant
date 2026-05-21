/**
 * Discord Slash Command: /bob-monitor
 *
 * Polls user-supplied URLs at fixed intervals and posts a Discord
 * notification to MONITOR_CHANNEL_ID when the page body hash changes.
 *
 * Subcommands: start, stop, stopall, list.
 *
 * Author: gl0bal01
 */

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');
const { validateUrlNotInternal, getSafeAxiosConfig, SIZE_5MB } = require('../utils/ssrf');

const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;

// One entry per URL: { hash, userId, timer }
const monitors = new Map();
const MAX_MONITORS = 20;
const MAX_MONITORS_PER_USER = 3;

function hashContent(content) {
    const buf = typeof content === 'string' || Buffer.isBuffer(content)
        ? content
        : JSON.stringify(content);
    return crypto.createHash('md5').update(buf).digest('hex');
}

async function checkWebsite(url, client) {
    try {
        await validateUrlNotInternal(url);
        const response = await axios.get(url, {
            ...getSafeAxiosConfig(),
            responseType: 'text',
            transformResponse: [(data) => data],
            maxContentLength: SIZE_5MB,
            maxBodyLength: SIZE_5MB,
        });
        const entry = monitors.get(url);
        if (!entry) return;
        const newHash = hashContent(response.data);
        if (entry.hash !== null && entry.hash !== newHash) {
            const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
            if (channel && channel.permissionsFor(client.user).has(PermissionFlagsBits.SendMessages)) {
                await channel.send(`Changes detected on ${url}`);
            } else {
                console.error('Missing permissions to send messages in monitoring channel');
            }
        }
        entry.hash = newHash;
    } catch (error) {
        console.error('Error checking website:', { status: error.response?.status, message: error.message });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-monitor')
        .setDescription('Monitor website changes')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start monitoring a website')
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('The URL to monitor')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('interval')
                        .setDescription('Check interval in minutes')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop monitoring a website')
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('The URL to stop monitoring')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stopall')
                .setDescription('Stop monitoring all websites'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all monitored websites')),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!MONITOR_CHANNEL_ID) {
            return interaction.editReply({ content: 'Monitoring is not configured: MONITOR_CHANNEL_ID is unset.' });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start': {
                const url = interaction.options.getString('url');
                const interval = interaction.options.getInteger('interval');
                const userId = interaction.user.id;

                // All gating checks must be synchronous and complete BEFORE
                // any await, so two concurrent invocations cannot both pass
                // the same check and double-claim a slot.
                if (monitors.has(url)) {
                    return interaction.editReply(`Already monitoring ${url}`);
                }
                if (monitors.size >= MAX_MONITORS) {
                    return interaction.editReply({ content: `Maximum monitoring limit (${MAX_MONITORS}) reached. Stop some monitors first.` });
                }
                let userMonitorCount = 0;
                for (const m of monitors.values()) {
                    if (m.userId === userId) userMonitorCount++;
                }
                if (userMonitorCount >= MAX_MONITORS_PER_USER) {
                    return interaction.editReply({ content: `You have reached the per-user monitor limit (${MAX_MONITORS_PER_USER}). Stop one of your monitors first.` });
                }

                const entry = { hash: null, userId, timer: null };
                monitors.set(url, entry);

                try {
                    await validateUrlNotInternal(url);

                    const monitorChannel = await interaction.client.channels.fetch(MONITOR_CHANNEL_ID);
                    if (!monitorChannel || !monitorChannel.permissionsFor(interaction.client.user).has(PermissionFlagsBits.SendMessages)) {
                        monitors.delete(url);
                        return interaction.editReply({ content: "I don't have permission to send messages in the monitoring channel." });
                    }

                    entry.timer = setInterval(() => checkWebsite(url, interaction.client), interval * 60000);
                    await checkWebsite(url, interaction.client);
                    await interaction.editReply(`Started monitoring ${url} every ${interval} minutes. Results will be posted in <#${MONITOR_CHANNEL_ID}>`);
                } catch (err) {
                    if (entry.timer) clearInterval(entry.timer);
                    monitors.delete(url);
                    console.error('Failed to start monitor:', { url, message: err.message });
                    return interaction.editReply({ content: 'The provided URL is not allowed or the monitor could not be started.' });
                }
                break;
            }

            case 'stop': {
                const stopUrl = interaction.options.getString('url');
                const entry = monitors.get(stopUrl);
                if (entry) {
                    clearInterval(entry.timer);
                    monitors.delete(stopUrl);
                    await interaction.editReply(`Stopped monitoring ${stopUrl}`);
                } else {
                    await interaction.editReply(`Not monitoring ${stopUrl}`);
                }
                break;
            }

            case 'stopall':
                for (const entry of monitors.values()) clearInterval(entry.timer);
                monitors.clear();
                await interaction.editReply('Stopped monitoring all websites');
                break;

            case 'list': {
                if (monitors.size === 0) {
                    await interaction.editReply('No websites are currently being monitored');
                } else {
                    const urlList = Array.from(monitors.keys()).join('\n');
                    await interaction.editReply(`Monitored websites:\n${urlList}`);
                }
                break;
            }
        }
    },
    shutdown() {
        for (const entry of monitors.values()) clearInterval(entry.timer);
        monitors.clear();
    },
};
