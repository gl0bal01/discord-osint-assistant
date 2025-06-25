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
 * - `playwright` for browser automation during login monitoring
 * - `@discordjs/builders` for constructing slash commands
 * - `dotenv` for environment variable configuration
 * 
 * Environment Variables:
 * - `MONITOR_CHANNEL_ID`: The Discord channel ID where updates and alerts will be posted
 * 
 * Author: gl0bal01
 */

require('dotenv').config();
const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const crypto = require('crypto');
const { chromium } = require('playwright');

const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;

// Store monitored URLs and their hashes
const monitoredUrls = new Map();
const intervals = new Map();

function hashContent(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

async function checkWebsite(url, client) {
    try {
        const response = await axios.get(url);
        const newHash = hashContent(response.data);
        
        if (monitoredUrls.has(url) && monitoredUrls.get(url) !== newHash) {
            const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
            if (channel && channel.permissionsFor(client.user).has('SendMessages')) {
                await channel.send(`Changes detected on ${url}`);
                monitoredUrls.set(url, newHash); // Update the hash after detecting changes
            } else {
                console.error(`Missing permissions to send messages in channel ${MONITOR_CHANNEL_ID}`);
            }
        } else if (!monitoredUrls.has(url)) {
            monitoredUrls.set(url, newHash);
        }
    } catch (error) {
        console.error(`Error checking ${url}: ${error.message}`);
    }
}

async function monitorLogin(url, username, password, client) {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        await page.goto(url);
        
        // This is a generic login process. You may need to adjust selectors based on the specific website.
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');

        // Wait for navigation or a specific element that indicates successful login
        await page.waitForNavigation();

        const loginSuccessful = await page.evaluate(() => {
            // Check for elements or text that indicate successful login
            return !document.querySelector('.login-error') && document.querySelector('.user-profile');
        });

        const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
        if (channel && channel.permissionsFor(client.user).has('SendMessages')) {
            await channel.send(loginSuccessful ? 'Login successful' : 'Login failed');
        } else {
            console.error(`Missing permissions to send messages in channel ${MONITOR_CHANNEL_ID}`);
        }
    } catch (error) {
        console.error(`Error monitoring login: ${error.message}`);
        const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
        if (channel && channel.permissionsFor(client.user).has('SendMessages')) {
            await channel.send(`Error monitoring login: ${error.message}`);
        }
    } finally {
        await browser.close();
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
                        .setRequired(true)))
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
                .setDescription('List all monitored websites'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('login')
                .setDescription('Monitor login functionality')
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('The login URL')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Username for login')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Password for login')
                        .setRequired(true))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start':
                const url = interaction.options.getString('url');
                const interval = interaction.options.getInteger('interval');
                
                if (intervals.has(url)) {
                    await interaction.reply(`Already monitoring ${url}`);
                    return;
                }
                
                const monitorChannel = await interaction.client.channels.fetch(MONITOR_CHANNEL_ID);
                if (!monitorChannel || !monitorChannel.permissionsFor(interaction.client.user).has('SendMessages')) {
                    await interaction.reply({ content: "I don't have permission to send messages in the monitoring channel.", ephemeral: true });
                    return;
                }
                
                const checkInterval = setInterval(() => checkWebsite(url, interaction.client), interval * 60000);
                intervals.set(url, checkInterval);
                await checkWebsite(url, interaction.client);
                await interaction.reply(`Started monitoring ${url} every ${interval} minutes. Results will be posted in <#${MONITOR_CHANNEL_ID}>`);
                break;

            case 'stop':
                const stopUrl = interaction.options.getString('url');
                if (intervals.has(stopUrl)) {
                    clearInterval(intervals.get(stopUrl));
                    intervals.delete(stopUrl);
                    monitoredUrls.delete(stopUrl);
                    await interaction.reply(`Stopped monitoring ${stopUrl}`);
                } else {
                    await interaction.reply(`Not monitoring ${stopUrl}`);
                }
                break;

            case 'stopall':
                intervals.forEach((interval) => clearInterval(interval));
                intervals.clear();
                monitoredUrls.clear();
                await interaction.reply('Stopped monitoring all websites');
                break;

            case 'list':
                if (monitoredUrls.size === 0) {
                    await interaction.reply('No websites are currently being monitored');
                } else {
                    const urlList = Array.from(monitoredUrls.keys()).join('\n');
                    await interaction.reply(`Monitored websites:\n${urlList}`);
                }
                break;

            case 'login':
                const loginUrl = interaction.options.getString('url');
                const username = interaction.options.getString('username');
                const password = interaction.options.getString('password');
                
                await interaction.deferReply({ ephemeral: true });
                await monitorLogin(loginUrl, username, password, interaction.client);
                await interaction.editReply('Login monitoring complete. Check the monitor channel for results.');
                break;
        }
    },
};

