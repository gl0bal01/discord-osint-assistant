/**
 * Discord Slash Command: /bob-monitor
 *
 * Description:
 * A Discord bot command that enables monitoring of website content and login functionality.
 * It detects changes to web pages by hashing their content and optionally tests login flows
 * using Playwright's headless browser. All notifications are sent to a designated monitoring channel.
 *
 * Features:
 * - Monitor web pages for content changes at user-defined intervals.
 * - Simulate and validate login workflows via Playwright.
 * - Commands to start, stop, list, and stop all monitoring sessions.
 * - Sends real-time updates and errors to a configured Discord channel.
 *
 * Dependencies:
 * - `axios` for fetching page content
 * - `crypto` for hashing page data
 * - `discord.js` for constructing slash commands
 *
 * Environment Variables:
 * - `MONITOR_CHANNEL_ID`: The Discord channel ID where updates and alerts will be posted
 *
 * Author: gl0bal01
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');
const { validateUrlNotInternal, getSafeAxiosConfig } = require('../utils/ssrf');

const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;

// One entry per URL: { hash, userId, timer }
const monitors = new Map();
const MAX_MONITORS = 20;
const MAX_MONITORS_PER_USER = 3;

function hashContent(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

async function checkWebsite(url, client) {
    try {
        await validateUrlNotInternal(url);
        const response = await axios.get(url, {
            ...getSafeAxiosConfig(),
            maxContentLength: 5 * 1024 * 1024,
            maxBodyLength: 5 * 1024 * 1024,
        });
        const entry = monitors.get(url);
        if (!entry) return;
        const newHash = hashContent(response.data);
        if (entry.hash !== null && entry.hash !== newHash) {
            const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
            if (channel && channel.permissionsFor(client.user).has('SendMessages')) {
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

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start': {
                const url = interaction.options.getString('url');
                const interval = interaction.options.getInteger('interval');

                try {
                    await validateUrlNotInternal(url);
                } catch (_err) {
                    return interaction.editReply({ content: 'The provided URL is not allowed.' });
                }

                if (monitors.has(url)) {
                    await interaction.editReply(`Already monitoring ${url}`);
                    return;
                }

                if (monitors.size >= MAX_MONITORS) {
                    return interaction.editReply({ content: `Maximum monitoring limit (${MAX_MONITORS}) reached. Stop some monitors first.` });
                }
                if (interval < 1) {
                    return interaction.editReply({ content: 'Interval must be at least 1 minute.' });
                }

                const userId = interaction.user.id;
                let userMonitorCount = 0;
                for (const m of monitors.values()) {
                    if (m.userId === userId) userMonitorCount++;
                }
                if (userMonitorCount >= MAX_MONITORS_PER_USER) {
                    return interaction.editReply({ content: `You have reached the per-user monitor limit (${MAX_MONITORS_PER_USER}). Stop one of your monitors first.` });
                }

                const monitorChannel = await interaction.client.channels.fetch(MONITOR_CHANNEL_ID);
                if (!monitorChannel || !monitorChannel.permissionsFor(interaction.client.user).has('SendMessages')) {
                    await interaction.editReply({ content: "I don't have permission to send messages in the monitoring channel." });
                    return;
                }

                // Insert the entry BEFORE starting the timer so the first
                // tick can find it and ownership tracking is never racy.
                const entry = { hash: null, userId, timer: null };
                monitors.set(url, entry);
                entry.timer = setInterval(() => checkWebsite(url, interaction.client), interval * 60000);
                await checkWebsite(url, interaction.client);
                await interaction.editReply(`Started monitoring ${url} every ${interval} minutes. Results will be posted in <#${MONITOR_CHANNEL_ID}>`);
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

            case 'login':
                return interaction.editReply({ content: 'The login monitoring feature has been removed for security reasons.' });
        }
    },
    shutdown() {
        for (const entry of monitors.values()) clearInterval(entry.timer);
        monitors.clear();
    },
};
