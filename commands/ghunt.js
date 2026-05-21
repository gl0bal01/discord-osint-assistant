/**
 * File: ghunt.js
 * Description: Discord wrapper around GHunt (https://github.com/mxrch/GHunt)
 * Author: gl0bal01
 *
 * Supports login via GHunt Companion base64 token, login-status checks,
 * and all standard GHunt search modes (email, gaia, drive, geolocate, spiderdal).
 *
 * Usage:
 *   /bob-ghunt type:login token:<base64-from-companion>
 *   /bob-ghunt type:check-login
 *   /bob-ghunt type:email query:test@gmail.com
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { safeSpawn } = require('../utils/process');
const { isValidEmail, isValidUrl } = require('../utils/validation');
const { capField, escapeHtml } = require('../utils/embed');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { reportDirPath, cleanupDir } = require('../utils/temp');

/* -------------------------------------------------------------------------- */
/*                               Auth helpers                                 */
/* -------------------------------------------------------------------------- */

function getGhuntCredsPath() {
    const envPath = process.env.GHUNT_CREDS_PATH;
    if (envPath) return path.resolve(envPath);
    return path.join(os.homedir(), '.malfrats', 'ghunt', 'creds.m');
}

function isLoggedIn() {
    const credsPath = getGhuntCredsPath();
    if (!fs.existsSync(credsPath)) return false;
    try {
        const raw = fs.readFileSync(credsPath, 'utf8').trim();
        if (!raw) return false;
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        // Basic validation: must have a cookies object with at least one key
        if (!parsed || typeof parsed !== 'object') return false;
        if (parsed.cookies && Object.keys(parsed.cookies).length > 0) return true;
        // GHunt v2 sometimes stores top-level cookie keys directly
        const requiredKeys = ['SID', '__Secure-1PSID', 'APISID', 'SAPISID'];
        if (requiredKeys.some(k => parsed[k])) return true;
        return false;
    } catch {
        return false;
    }
}

function saveCredentials(base64Token) {
    const credsPath = getGhuntCredsPath();
    const credsDir = path.dirname(credsPath);
    if (!fs.existsSync(credsDir)) {
        fs.mkdirSync(credsDir, { recursive: true });
    }

    // Validate it's base64 before writing
    const decoded = Buffer.from(base64Token, 'base64').toString('utf8');
    if (!decoded) throw new Error('Invalid base64 token');
    JSON.parse(decoded); // Ensure valid JSON

    fs.writeFileSync(credsPath, base64Token, { mode: 0o600 });
    return credsPath;
}

/* -------------------------------------------------------------------------- */
/*                               HTML report                                  */
/* -------------------------------------------------------------------------- */

function generateHtmlReport(results, searchType, query, userTag, timestamp) {
    const reportDate = new Date(timestamp).toLocaleString();
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GHunt Results - ${escapeHtml(searchType)} - ${escapeHtml(query)}</title>
    <style>
        :root {
            --primary: #4285F4;
            --secondary: #34A853;
            --accent: #EA4335;
            --light: #F2F2F2;
            --dark: #333333;
            --card-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        body {
            font-family: 'Roboto', Arial, sans-serif;
            line-height: 1.6;
            color: var(--dark);
            background-color: var(--light);
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: var(--card-shadow);
            padding: 25px;
        }
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid #eaeaea;
        }
        .logo { display: flex; align-items: center; }
        .logo-img { width: 40px; height: 40px; margin-right: 10px; }
        h1 { color: var(--primary); margin: 0; font-size: 24px; }
        .timestamp { color: #757575; font-size: 14px; }
        .summary {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 25px;
        }
        .summary h2 { margin-top: 0; color: var(--dark); font-size: 18px; }
        .summary-item { display: flex; margin-bottom: 8px; }
        .summary-label { font-weight: bold; width: 130px; flex-shrink: 0; }
        .links {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .link-card {
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            padding: 15px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .link-card:hover { transform: translateY(-3px); box-shadow: var(--card-shadow); }
        .link-title { font-weight: bold; color: var(--primary); margin-bottom: 8px; }
        .link-url { word-break: break-all; }
        .link-url a { color: var(--primary); text-decoration: none; }
        .link-url a:hover { text-decoration: underline; }
        .results { background-color: #f8f9fa; border-radius: 4px; padding: 15px; }
        .results h2 { margin-top: 0; color: var(--dark); font-size: 18px; }
        pre {
            background-color: #272822;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap;
            font-family: 'Courier New', Courier, monospace;
        }
        footer {
            text-align: center;
            margin-top: 30px;
            color: #757575;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <div class="logo-img">🔍</div>
                <h1>GHunt OSINT Report</h1>
            </div>
            <div class="timestamp">${reportDate}</div>
        </header>
        <div class="summary">
            <h2>Search Summary</h2>
            <div class="summary-item">
                <div class="summary-label">Search Type:</div>
                <div>${escapeHtml(searchType)}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Query:</div>
                <div>${escapeHtml(query)}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Generated By:</div>
                <div>${escapeHtml(userTag)}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Timestamp:</div>
                <div>${reportDate}</div>
            </div>
        </div>
        <div class="links">`;

    if (searchType === 'email') {
        const [username, domain] = query.split('@');
        html += generateLinkCard('Google Calendar ICS', `https://calendar.google.com/calendar/ical/${query}/public/basic.ics`);
        if (results && results.personId) {
            html += generateLinkCard('Google Maps Reviews', `https://www.google.com/maps/contrib/${results.personId}/reviews`);
        }
        html += generateLinkCard('Epieos OSINT', `https://epieos.com/?q=${query}`);
        html += generateLinkCard('EmailRep Lookup', `https://emailrep.io/${query}`);
        html += generateLinkCard('Have I Been Pwned', `https://haveibeenpwned.com/account/${query}`);
        if (domain.toLowerCase() === 'gmail.com') {
            html += generateLinkCard('Gmail OSINT Tool', `https://gmail-osint.activetk.jp/${username}`);
        }
    } else if (searchType === 'gaia') {
        html += generateLinkCard('Google Maps Reviews', `https://www.google.com/maps/contrib/${query}/reviews`);
    } else if (searchType === 'spiderdal') {
        html += generateLinkCard('Google Calendar ICS', `https://calendar.google.com/calendar/ical/${query}/public/basic.ics`);
    }

    html += `
        </div>
        <div class="results">
            <h2>Detailed Results</h2>
            <pre>${escapeHtml(JSON.stringify(results, null, 2))}</pre>
        </div>
        <footer>
            Generated by GHunt Discord Bot | User: ${escapeHtml(userTag)} | ${reportDate}
        </footer>
    </div>
</body>
</html>`;

    return html;
}

function generateLinkCard(title, url) {
    return `
            <div class="link-card">
                <div class="link-title">${escapeHtml(title)}</div>
                <div class="link-url"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a></div>
            </div>`;
}

function extractDriveId(url) {
    try {
        const idMatch = url.match(/[-\w]{25,}/);
        return idMatch ? idMatch[0] : 'unknown';
    } catch (_error) {
        return 'unknown';
    }
}

/* -------------------------------------------------------------------------- */
/*                              Command module                                */
/* -------------------------------------------------------------------------- */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-ghunt')
        .setDescription('Execute GHunt commands for OSINT')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The type of GHunt operation to perform')
                .setRequired(true)
                .addChoices(
                    { name: '📧 Email Lookup', value: 'email' },
                    { name: '🆔 Gaia ID Lookup', value: 'gaia' },
                    { name: '💾 Drive Analysis', value: 'drive' },
                    { name: '📍 BSSID Geolocation', value: 'geolocate' },
                    { name: '🔗 Digital Asset Links', value: 'spiderdal' },
                    { name: '🔑 Login (update credentials)', value: 'login' },
                    { name: '🔍 Check Login Status', value: 'check-login' }
                ))
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The value to search (email, Gaia ID, Drive URL, BSSID, domain) or base64 token for login')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('token')
                .setDescription('Base64 token from GHunt Companion (alternative to query for login)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('sight')
                .setDescription('Find Google Sight profiles (for email command only)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('driver')
                .setDescription('Use Chrome driver instead of requests (for email and gaia commands)')
                .setRequired(false)),

    async execute(interaction) {
        const searchType = interaction.options.getString('type');
        const query = interaction.options.getString('query');
        const token = interaction.options.getString('token');

        /* ------------------------------- Login ------------------------------- */
        if (searchType === 'login') {
            const base64Token = token || query;
            if (!base64Token) {
                return interaction.reply({
                    content: '❌ **Missing Token**\n' +
                        'Please provide the base64 token from GHunt Companion.\n\n' +
                        '**How to get a token:**\n' +
                        '1. Install the [GHunt Companion](https://github.com/mxrch/GHunt/tree/master/gc-assets) browser extension\n' +
                        '2. Log in to your Google account in the browser\n' +
                        '3. Click the extension icon → copy the base64 string\n' +
                        '4. Run `/bob-ghunt type:login query:<base64-string>`',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const credsPath = saveCredentials(base64Token);
                return interaction.editReply({
                    content: '✅ **GHunt Credentials Saved**\n' +
                        `📁 Path: \`${credsPath}\`\n` +
                        '🎯 You can now run GHunt lookups.\n\n' +
                        '**Test it:** `/bob-ghunt type:check-login`'
                });
            } catch (error) {
                console.error('[GHUNT] Login error:', error.message);
                let reason = error.message;
                if (error.message.includes('Invalid base64')) {
                    reason = 'The token is not valid base64. Make sure you copied the entire string from GHunt Companion.';
                } else if (error.message.includes('JSON')) {
                    reason = 'The decoded token is not valid JSON. Make sure you are using the GHunt Companion extension output.';
                }
                return interaction.editReply({
                    content: '❌ **Login Failed**\n' + capField(reason, 1024)
                });
            }
        }

        /* --------------------------- Check login ----------------------------- */
        if (searchType === 'check-login') {
            const loggedIn = isLoggedIn();
            const credsPath = getGhuntCredsPath();
            const exists = fs.existsSync(credsPath);
            let statusText;
            let color;

            if (loggedIn) {
                statusText = '✅ **Logged In**\nGHunt credentials are valid and ready to use.';
                color = 0x00ff00;
            } else if (exists) {
                statusText = '⚠️ **Credentials File Exists but Invalid**\n' +
                    `Found: \`${credsPath}\`\n` +
                    'The file exists but does not contain valid GHunt credentials.\n' +
                    'Run `/bob-ghunt type:login query:<base64-token>` to refresh.';
                color = 0xffff00;
            } else {
                statusText = '❌ **Not Logged In**\n' +
                    `No credentials found at \`${credsPath}\`.\n\n` +
                    '**To authenticate:**\n' +
                    '1. Install the [GHunt Companion](https://github.com/mxrch/GHunt/tree/master/gc-assets) browser extension\n' +
                    '2. Log in to your Google account in the browser\n' +
                    '3. Click the extension icon → copy the base64 string\n' +
                    '4. Run `/bob-ghunt type:login query:<base64-string>`';
                color = 0xff0000;
            }

            const embed = new EmbedBuilder()
                .setTitle('GHunt Login Status')
                .setColor(color)
                .setDescription(statusText)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        /* --------------------------- Searches -------------------------------- */

        // Pre-validation for search types
        switch (searchType) {
            case 'email': {
                if (!query || !isValidEmail(query)) {
                    return interaction.reply({ content: 'Please provide a valid email address in the `query` field.', flags: MessageFlags.Ephemeral });
                }
                break;
            }
            case 'drive': {
                if (!query || !isValidUrl(query)) {
                    return interaction.reply({ content: 'Please provide a valid Google Drive URL in the `query` field.', flags: MessageFlags.Ephemeral });
                }
                break;
            }
            case 'geolocate': {
                const bssidRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
                if (!query || !bssidRegex.test(query)) {
                    return interaction.reply({ content: 'Please provide a valid BSSID in the format `XX:XX:XX:XX:XX:XX`.', flags: MessageFlags.Ephemeral });
                }
                break;
            }
            case 'gaia':
            case 'spiderdal': {
                if (!query) {
                    return interaction.reply({ content: 'Please provide a value in the `query` field.', flags: MessageFlags.Ephemeral });
                }
                break;
            }
            default:
                return interaction.reply({ content: 'Invalid search type.', flags: MessageFlags.Ephemeral });
        }

        // Check login before performing any search
        if (!isLoggedIn()) {
            const credsPath = getGhuntCredsPath();
            return interaction.reply({
                content: '❌ **GHunt Not Authenticated**\n' +
                    `No valid credentials found at \`${credsPath}\`.\n\n` +
                    '**Authenticate with:**\n' +
                    '`/bob-ghunt type:login query:<base64-from-companion>`\n\n' +
                    '**How to get a token:**\n' +
                    '1. Install the [GHunt Companion](https://github.com/mxrch/GHunt/tree/master/gc-assets) browser extension\n' +
                    '2. Log in to your Google account in the browser\n' +
                    '3. Click the extension icon → copy the base64 string\n' +
                    '4. Paste it as the `query` parameter above',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        const useDriver = interaction.options.getBoolean('driver') ?? false;
        const useSight = interaction.options.getBoolean('sight') ?? false;
        const username = interaction.user.username;
        const userTag = interaction.user.tag || username;

        const resultsDir = reportDirPath('ghunt');

        const timestamp = Date.now();
        let ghuntArgs;
        let outputFilePath;
        let sanitizedQuery;
        let embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTimestamp()
            .setFooter({ text: `GHunt OSINT Tool - ${searchType}` });

        switch (searchType) {
            case 'email': {
                sanitizedQuery = query.replace(/[^a-zA-Z0-9@.]/g, '_');
                outputFilePath = path.join(resultsDir, `email_${sanitizedQuery}_${timestamp}.json`);
                ghuntArgs = ['email', sanitizedQuery, '--json', outputFilePath];
                if (useDriver) ghuntArgs.push('--driver');
                if (useSight) ghuntArgs.push('--sight');
                const [uname, domain] = query.split('@');
                embed.setTitle('Email Lookup Results')
                    .setDescription(`Results for ${query}`);
                if (domain.toLowerCase() === 'gmail.com') {
                    embed.addFields({ name: 'Gmail OSINT Tool', value: `[View Results](https://gmail-osint.activetk.jp/${uname})` });
                }
                embed.addFields(
                    { name: 'Epieos OSINT', value: `[View Results](https://epieos.com/?q=${query})` },
                    { name: 'EmailRep Lookup', value: `[View Results](https://emailrep.io/${query})` },
                    { name: 'Have I Been Pwned', value: `[View Results](https://haveibeenpwned.com/account/${query})` },
                    { name: 'Google Calendar ICS', value: `[Download Calendar](https://calendar.google.com/calendar/ical/${query}/public/basic.ics)` }
                );
                break;
            }
            case 'gaia': {
                sanitizedQuery = query.replace(/[^0-9]/g, '');
                outputFilePath = path.join(resultsDir, `gaia_${sanitizedQuery}_${timestamp}.json`);
                ghuntArgs = ['gaia', sanitizedQuery, '--json', outputFilePath];
                if (useDriver) ghuntArgs.push('--driver');
                embed.setTitle('Gaia ID Lookup Results')
                    .setDescription(`Results for Gaia ID: ${query}`);
                embed.addFields(
                    { name: 'Google Maps Reviews', value: `[View Reviews](https://www.google.com/maps/contrib/${query}/reviews)` },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
            }
            case 'drive': {
                sanitizedQuery = query.replace(/['"]/g, '');
                const driveFileId = extractDriveId(sanitizedQuery);
                outputFilePath = path.join(resultsDir, `drive_${driveFileId}_${timestamp}.json`);
                ghuntArgs = ['drive', sanitizedQuery, '--json', outputFilePath];
                embed.setTitle('Google Drive Analysis')
                    .setDescription(`Results for Drive URL: ${query}`);
                embed.addFields(
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
            }
            case 'geolocate': {
                sanitizedQuery = query.replace(/[^0-9A-Fa-f:]/g, '');
                outputFilePath = path.join(resultsDir, `geolocate_${sanitizedQuery.replace(/:/g, '')}_${timestamp}.json`);
                ghuntArgs = ['geolocate', sanitizedQuery, '--json', outputFilePath];
                embed.setTitle('BSSID Geolocation Results')
                    .setDescription(`Geolocation results for BSSID: ${query}`);
                embed.addFields(
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
            }
            case 'spiderdal': {
                sanitizedQuery = query.replace(/[^a-zA-Z0-9-.]/g, '');
                outputFilePath = path.join(resultsDir, `spiderdal_${sanitizedQuery}_${timestamp}.json`);
                ghuntArgs = ['spiderdal', sanitizedQuery, '--json', outputFilePath];
                embed.setTitle('Digital Asset Links Analysis')
                    .setDescription(`Results for domain: ${query}`);
                embed.addFields(
                    { name: 'Google Calendar ICS', value: `[Calendar ICS](https://calendar.google.com/calendar/ical/${sanitizedQuery}/public/basic.ics)` },
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' }
                );
                break;
            }
            default:
                return interaction.editReply({ content: 'Invalid search type.' });
        }

        try {
            await safeSpawn('ghunt', ghuntArgs, { timeout: 120000 });

            if (fs.existsSync(outputFilePath)) {
                const attachment = new AttachmentBuilder(outputFilePath, {
                    name: path.basename(outputFilePath),
                    description: `GHunt ${searchType} results`
                });
                embed.addFields({ name: 'GHunt Results', value: 'Results attached as JSON' });

                if (searchType === 'email') {
                    try {
                        const jsonData = fs.readFileSync(outputFilePath, 'utf8');
                        const ghuntResults = JSON.parse(jsonData);
                        if (ghuntResults && ghuntResults.personId) {
                            embed.addFields({
                                name: 'Google Maps Reviews',
                                value: `[View Reviews](https://www.google.com/maps/contrib/${ghuntResults.personId}/reviews)`
                            });
                        }
                    } catch (jsonError) {
                        console.error(`[GHUNT] JSON parse error: ${jsonError.message}`);
                    }
                }

                let ghuntResults = {};
                try {
                    const jsonData = fs.readFileSync(outputFilePath, 'utf8');
                    ghuntResults = JSON.parse(jsonData);
                } catch { /* ignore */ }

                const htmlReportPath = path.join(resultsDir, `report_${sanitizedQuery}_${timestamp}.html`);
                const htmlContent = generateHtmlReport(ghuntResults, searchType, query, userTag, timestamp);
                fs.writeFileSync(htmlReportPath, htmlContent);

                const htmlAttachment = new AttachmentBuilder(htmlReportPath, {
                    name: `GHunt_Report_${searchType}_${timestamp}.html`,
                    description: 'GHunt results in HTML format'
                });

                await interaction.editReply({
                    embeds: [embed],
                    files: [attachment, htmlAttachment]
                });
            } else {
                embed.addFields({ name: 'GHunt Results', value: 'GHunt executed but no results were found.' });
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(`[GHUNT] Execution error: ${error.message}`);

            // Detect expired/invalid credentials from GHunt stderr
            const errMsg = String(error.message || '');
            const isAuthError = errMsg.includes('credentials') ||
                errMsg.includes('authenticated') ||
                errMsg.includes('Unauthorized') ||
                errMsg.includes('401');

            if (isAuthError) {
                embed.setColor(0xff0000)
                    .setTitle('Authentication Failed')
                    .setDescription('GHunt reported an authentication error. Your Google session may have expired.\n\n' +
                        '**Run:** `/bob-ghunt type:check-login` to verify\n' +
                        '**Then:** `/bob-ghunt type:login query:<base64-from-companion>` to refresh');
            } else {
                const userMsg = errMsg.includes('ENOENT') || errMsg.includes('Failed to start process')
                    ? 'GHunt is not installed or not found in PATH. Please contact the administrator.'
                    : 'Error running GHunt. Check server logs for details.';
                embed.addFields({ name: 'GHunt Error', value: userMsg });
            }

            await interaction.editReply({ embeds: [embed] });
        } finally {
            setTimeout(() => {
                cleanupDir(resultsDir, 0).catch((err) => {
                    console.error('[GHUNT] Cleanup error:', err.message);
                });
            }, 30000);
        }
    }
};
