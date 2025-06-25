/**
 * File: ghunt.js
 * Description: Bot health monitoring and system status command
 * Author: gl0bal01
 * 
 * Discord wrapper around https://github.com/mxrch/GHunt 
 * 
 * Usage: /bob-ghunt...
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// HTML report generation functions
/**
 * Generates an HTML report from GHunt results
 * @param {Object} results - The parsed JSON results from GHunt
 * @param {string} searchType - The type of search (email, gaia, etc.)
 * @param {string} query - The search query
 * @param {string} userTag - The Discord user tag who generated the report
 * @param {number} timestamp - Timestamp when the report was generated
 * @returns {string} HTML content of the report
 */
function generateHtmlReport(results, searchType, query, userTag, timestamp) {
    // Format the timestamp as a readable date string
    const reportDate = new Date(timestamp).toLocaleString();
    
    // Base template
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GHunt Results - ${searchType} - ${query}</title>
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
        
        .logo {
            display: flex;
            align-items: center;
        }
        
        .logo-img {
            width: 40px;
            height: 40px;
            margin-right: 10px;
        }
        
        h1 {
            color: var(--primary);
            margin: 0;
            font-size: 24px;
        }
        
        .timestamp {
            color: #757575;
            font-size: 14px;
        }
        
        .summary {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 25px;
        }
        
        .summary h2 {
            margin-top: 0;
            color: var(--dark);
            font-size: 18px;
        }
        
        .summary-item {
            display: flex;
            margin-bottom: 8px;
        }
        
        .summary-label {
            font-weight: bold;
            width: 130px;
            flex-shrink: 0;
        }
        
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
        
        .link-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--card-shadow);
        }
        
        .link-title {
            font-weight: bold;
            color: var(--primary);
            margin-bottom: 8px;
        }
        
        .link-url {
            word-break: break-all;
        }
        
        .link-url a {
            color: var(--primary);
            text-decoration: none;
        }
        
        .link-url a:hover {
            text-decoration: underline;
        }
        
        .results {
            background-color: #f8f9fa;
            border-radius: 4px;
            padding: 15px;
        }
        
        .results h2 {
            margin-top: 0;
            color: var(--dark);
            font-size: 18px;
        }
        
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
                <div>${searchType}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Query:</div>
                <div>${query}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Generated By:</div>
                <div>${userTag}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Timestamp:</div>
                <div>${reportDate}</div>
            </div>
        </div>
        
        <div class="links">
`;

    // Add links based on search type
    if (searchType === 'email') {
        const [username, domain] = query.split('@');
        
        html += generateLinkCard('Google Calendar ICS', `https://calendar.google.com/calendar/ical/${query}/public/basic.ics`);
        
        // If we have a person ID from the results, add Maps link
        if (results && results.personId) {
            html += generateLinkCard('Google Maps Reviews', `https://www.google.com/maps/contrib/${results.personId}/reviews`);
        }
        
        html += generateLinkCard('Epieos OSINT', `https://epieos.com/?q=${query}`);
        html += generateLinkCard('EmailRep Lookup', `https://emailrep.io/${query}`);
        html += generateLinkCard('Have I Been Pwned', `https://haveibeenpwned.com/account/${query}`);
        
        if (domain.toLowerCase() === 'gmail.com') {
            html += generateLinkCard('Gmail OSINT Tool', `https://gmail-osint.activetk.jp/${username}`);
        }
    } 
    else if (searchType === 'gaia') {
        html += generateLinkCard('Google Maps Reviews', `https://www.google.com/maps/contrib/${query}/reviews`);
    }
    else if (searchType === 'spiderdal') {
        html += generateLinkCard('Google Calendar ICS', `https://calendar.google.com/calendar/ical/${query}/public/basic.ics`);
    }

    // Close the links section and add the results
    html += `
        </div>
        
        <div class="results">
            <h2>Detailed Results</h2>
            <pre>${JSON.stringify(results, null, 2)}</pre>
        </div>
        
        <footer>
            Generated by GHunt Discord Bot | User: ${userTag} | ${reportDate}
        </footer>
    </div>
</body>
</html>`;

    return html;
}

/**
 * Helper function to generate a link card HTML
 */
function generateLinkCard(title, url) {
    return `
            <div class="link-card">
                <div class="link-title">${title}</div>
                <div class="link-url"><a href="${url}" target="_blank">${url}</a></div>
            </div>`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-ghunt')
        .setDescription('Execute GHunt commands for OSINT')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('The type of GHunt search to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Email Lookup', value: 'email' },
                    { name: 'Gaia ID Lookup', value: 'gaia' },
                    { name: 'Drive Analysis', value: 'drive' },
                    { name: 'BSSID Geolocation', value: 'geolocate' },
                    { name: 'Digital Asset Links', value: 'spiderdal' }
                ))
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The value to search (email, Gaia ID, Drive URL, BSSID, or domain)')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('sight')
                .setDescription('Find Google Sight profiles (for email command only)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('driver')
                .setDescription('Use Chrome driver instead of requests (for email and gaia commands)')
                .setRequired(false)),
    
    async execute(interaction) {
        // Defer the reply since GHunt might take time to complete
        await interaction.deferReply();
        
        const searchType = interaction.options.getString('type');
        const query = interaction.options.getString('query');
        const useDriver = interaction.options.getBoolean('driver') ?? false;
        const useSight = interaction.options.getBoolean('sight') ?? false;
        
        // Get user information
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userTag = interaction.user.tag || username;
        
        // Directory for results
        const resultsDir = path.join(__dirname, '../ghunt_results');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        // Create timestamp for unique filenames
        const timestamp = Date.now();
        
        // Build command and setup based on search type
        let ghuntCommand = '';
        let outputFilePath = '';
        let sanitizedQuery = '';
        let embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTimestamp()
            .setFooter({ text: `GHunt OSINT Tool - ${searchType}` });
        
        // Process different search types
        switch (searchType) {
            case 'email':
                // Basic email validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(query)) {
                    return interaction.editReply({
                        content: 'Please provide a valid email address',
                        ephemeral: true
                    });
                }

                // Sanitize input to prevent command injection
                sanitizedQuery = query.replace(/[^a-zA-Z0-9@.]/g, '_');
                outputFilePath = path.join(resultsDir, `email_${sanitizedQuery}_${timestamp}.json`);
                
                // Build the GHunt command
                ghuntCommand = `ghunt email ${sanitizedQuery}`;
                ghuntCommand += ` --json ${outputFilePath}`;
                if (useDriver) ghuntCommand += ' --driver';
                if (useSight) ghuntCommand += ' --sight';
                
                // Extract username and domain from email
                const [username, domain] = query.split('@');

                // Create embed
                embed.setTitle('Email Lookup Results')
                    .setDescription(`Here are the OSINT results for ${query}:`);
                
                // Add links to other OSINT tools
                if (domain.toLowerCase() === 'gmail.com') {
                    embed.addFields({ 
                        name: 'Gmail OSINT Tool', 
                        value: `[View Results](https://gmail-osint.activetk.jp/${username})`
                    });
                }
                
                embed.addFields(
                    { name: 'Epieos OSINT', value: `[View Results](https://epieos.com/?q=${query})` },
                    { name: 'EmailRep Lookup', value: `[View Results](https://emailrep.io/${query})` },
                    { name: 'Have I Been Pwned', value: `[View Results](https://haveibeenpwned.com/account/${query})` },
                    { name: 'Google Calendar ICS', value: `[Download Calendar](https://calendar.google.com/calendar/ical/${query}/public/basic.ics)` }
                    // Maps review link will be added separately after JSON parsing
                );
                break;
                
            case 'gaia':
                // Sanitize input
                sanitizedQuery = query.replace(/[^0-9]/g, '');
                outputFilePath = path.join(resultsDir, `gaia_${sanitizedQuery}_${timestamp}.json`);
                
                // Build command
                ghuntCommand = `ghunt gaia ${sanitizedQuery}`;
                ghuntCommand += ` --json ${outputFilePath}`;
                if (useDriver) ghuntCommand += ' --driver';
                
                embed.setTitle('Gaia ID Lookup Results')
                    .setDescription(`Results for Gaia ID: ${query}`);
                
                // Add Google Maps reviews link and Calendar ICS
                embed.addFields(
                    { name: 'Google Maps Reviews', value: `[View Reviews](https://www.google.com/maps/contrib/${query}/reviews)` },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
                
            case 'drive':
                // Sanitize URL (basic sanitization, as URLs are complex)
                sanitizedQuery = query.replace(/['"]/g, '');
                const driveFileId = extractDriveId(sanitizedQuery);
                outputFilePath = path.join(resultsDir, `drive_${driveFileId}_${timestamp}.json`);
                
                // Build command
                ghuntCommand = `ghunt drive "${sanitizedQuery}"`;
                ghuntCommand += ` --json ${outputFilePath}`;
                
                embed.setTitle('Google Drive Analysis')
                    .setDescription(`Results for Drive URL: ${query}`);
                
                // Add Google Maps reviews and Calendar ICS links
                embed.addFields(
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
                
            case 'geolocate':
                // Validate BSSID format
                const bssidRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
                if (!bssidRegex.test(query)) {
                    return interaction.editReply({
                        content: 'Please provide a valid BSSID in the format XX:XX:XX:XX:XX:XX',
                        ephemeral: true
                    });
                }
                
                // Sanitize input
                sanitizedQuery = query.replace(/[^0-9A-Fa-f:]/g, '');
                outputFilePath = path.join(resultsDir, `geolocate_${sanitizedQuery.replace(/:/g, '')}_${timestamp}.json`);
                
                // Build command
                ghuntCommand = `ghunt geolocate ${sanitizedQuery}`;
                ghuntCommand += ` --json ${outputFilePath}`;
                
                embed.setTitle('BSSID Geolocation Results')
                    .setDescription(`Geolocation results for BSSID: ${query}`);
                
                // Add Google Maps reviews and Calendar ICS links
                embed.addFields(
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' },
                    { name: 'Google Calendar ICS', value: 'Use with email when available' }
                );
                break;
                
            case 'spiderdal':
                // Sanitize domain
                sanitizedQuery = query.replace(/[^a-zA-Z0-9-.]/g, '');
                outputFilePath = path.join(resultsDir, `spiderdal_${sanitizedQuery}_${timestamp}.json`);
                
                // Build command
                ghuntCommand = `ghunt spiderdal ${sanitizedQuery}`;
                ghuntCommand += ` --json ${outputFilePath}`;
                
                embed.setTitle('Digital Asset Links Analysis')
                    .setDescription(`Results for domain: ${query}`);
                
                // Add Google Calendar ICS link for the domain and Maps reviews
                embed.addFields(
                    { name: 'Google Calendar ICS', value: `[Calendar ICS](https://calendar.google.com/calendar/ical/${sanitizedQuery}/public/basic.ics)` },
                    { name: 'Google Maps Reviews', value: 'Use with Gaia ID when available' }
                );
                break;
                
            default:
                return interaction.editReply({
                    content: 'Invalid search type. Please try again.',
                    ephemeral: true
                });
        }
        
        // Execute GHunt command
        try {
            await new Promise((resolve, reject) => {
                exec(ghuntCommand, (error, stdout, stderr) => {
                    if (error && error.code !== 0) {
                        console.error(`GHunt execution error: ${error}`);
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
            
            // Check if the output file exists
            if (fs.existsSync(outputFilePath)) {
                // Create attachment
                const attachment = new AttachmentBuilder(outputFilePath, { 
                    name: path.basename(outputFilePath),
                    description: `GHunt ${searchType} results`
                });
                
                // Add a field to the embed about the attachment
                embed.addFields({ 
                    name: 'GHunt Results', 
                    value: 'GHunt results are attached as a JSON file' 
                });
                
                // If this is an email search, try to extract the Gaia ID for Maps reviews
                if (searchType === 'email') {
                    try {
                        const jsonData = fs.readFileSync(outputFilePath, 'utf8');
                        const ghuntResults = JSON.parse(jsonData);
                        
                        // Extract personId (Gaia ID) if available
                        if (ghuntResults && ghuntResults.personId) {
                            const gaiaId = ghuntResults.personId;
                            embed.addFields({ 
                                name: 'Google Maps Reviews', 
                                value: `[View Reviews](https://www.google.com/maps/contrib/${gaiaId}/reviews)` 
                            });
                        }
                    } catch (jsonError) {
                        console.error(`Error parsing JSON results: ${jsonError}`);
                    }
                }
                
                // Generate HTML report for all search types
                try {
                    let ghuntResults = {};
                    if (fs.existsSync(outputFilePath)) {
                        const jsonData = fs.readFileSync(outputFilePath, 'utf8');
                        ghuntResults = JSON.parse(jsonData);
                    }
                    
                    // Generate HTML report
                    const htmlReportPath = path.join(resultsDir, `report_${sanitizedQuery}_${timestamp}.html`);
                    const htmlContent = generateHtmlReport(ghuntResults, searchType, query, userTag, timestamp);
                    fs.writeFileSync(htmlReportPath, htmlContent);
                    
                    // Add HTML report as attachment
                    const htmlAttachment = new AttachmentBuilder(htmlReportPath, {
                        name: `GHunt_Report_${searchType}_${timestamp}.html`,
                        description: 'GHunt results in HTML format'
                    });
                    
                    // Send the reply with the embed and both attachments
                    await interaction.editReply({ 
                        embeds: [embed],
                        files: [attachment, htmlAttachment]
                    });
                } catch (htmlError) {
                    console.error(`Error generating HTML report: ${htmlError}`);
                    // If HTML generation fails, send just the JSON
                    await interaction.editReply({ 
                        embeds: [embed],
                        files: [attachment]
                    });
                }
            } else {
                // GHunt command ran but didn't produce a file
                embed.addFields({ 
                    name: 'GHunt Results', 
                    value: 'GHunt command executed but no results were found' 
                });
                
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            // Handle GHunt errors
            console.error(`Error running GHunt: ${error}`);
            embed.addFields({ 
                name: 'GHunt Error', 
                value: 'Error running GHunt command. Check server logs for details.' 
            });
            
            await interaction.editReply({ embeds: [embed] });
        }
    },
};

// Helper function to extract Drive ID from URL
function extractDriveId(url) {
    try {
        const idMatch = url.match(/[-\w]{25,}/);
        return idMatch ? idMatch[0] : 'unknown';
    } catch (error) {
        return 'unknown';
    }
}
