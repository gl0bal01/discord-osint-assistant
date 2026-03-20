/**
 * File: linkook.js
 * Description: Command to search for usernames across social platforms using Linkook
 * Author: gl0bal01
 * 
 * This command interfaces with the Linkook tool to find username presence across
 * various social media platforms and websites, similar to Sherlock or Maigret.
 * 
 * A discord wrapper around https://github.com/JackJuly/linkook
 */

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { safeSpawn } = require('../utils/process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-linkook')
        .setDescription('Search for a username across social platforms using Linkook')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('The username to search for')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('raw')
                .setDescription('Return raw result files')
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            const username = interaction.options.getString('username');
            const rawMode = interaction.options.getBoolean('raw') ?? false;
            
            // Validate username
            if (!username || username.trim() === '') {
                return interaction.editReply('Please provide a valid username to search for.');
            }
            
            // Sanitize username to prevent command injection
            const sanitizedUsername = username.replace(/[^a-zA-Z0-9_.-]/g, '_');
            if (sanitizedUsername !== username) {
                return interaction.editReply('Username contains invalid characters. Please use only letters, numbers, dots, underscores, and hyphens.');
            }
            
            // Create temp directory for output
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Create a unique output directory for this run
            const randomId = crypto.randomBytes(4).toString('hex');
            const outputDir = path.join(tempDir, `linkook_${sanitizedUsername}_${randomId}`);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // Build command arguments
            const args = [
                sanitizedUsername,
                '--scan-all',
                '--output', outputDir
            ];
            
            // Send initial progress message
            await interaction.editReply(`Running Linkook search for username: ${sanitizedUsername}...\nThis may take a moment while scanning multiple platforms.`);
            
            // Execute Linkook and handle results
            await runLinkook(args, interaction, outputDir, sanitizedUsername, rawMode);
            
        } catch (error) {
            console.error('Linkook error:', error);
            const errorMsg = error.message.includes('ENOENT') || error.message.includes('Failed to start process')
                ? 'Linkook is not installed or not found in PATH. Please contact the administrator.'
                : 'An error occurred while processing your request. Please try again later.';
            await interaction.editReply(errorMsg);
        }
    },
};

/**
 * Run the Linkook command and handle its output
 * @param {string[]} args - Command arguments
 * @param {Object} interaction - Discord interaction
 * @param {string} outputDir - Path to the output directory
 * @param {string} username - Username being searched
 * @param {boolean} rawMode - Whether to return raw result files
 */
async function runLinkook(args, interaction, outputDir, username, rawMode) {
    try {
        // Use safeSpawn for safe env and buffer limits
        const { stdout, stderr, code } = await safeSpawn('linkook', args, {
            timeout: 180000 // 3 minute timeout
        });

        // Extract found sites from stdout
        const foundSites = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
            if (line.includes('[+]') || line.includes('FOUND:')) {
                const siteName = line.match(/\[([^\]]+)\]/) || line.match(/FOUND: ([^\s]+)/);
                if (siteName && siteName[1]) {
                    foundSites.push(siteName[1]);
                }
            }
        }

        if (code !== 0 && stdout.trim() === '' && foundSites.length === 0) {
            throw new Error(`Linkook process exited with code ${code}: ${stderr}`);
        }

        // Check if there are any result files
        const resultFiles = fs.readdirSync(outputDir);
        if (resultFiles.length === 0) {
            if (foundSites.length > 0) {
                await interaction.editReply(`Found ${foundSites.length} sites for username "${username}", but no result files were created.\n\nSites: ${foundSites.join(', ')}`);
            } else {
                await interaction.editReply(`No results found for username "${username}". The username might not exist on any of the scanned platforms.`);
            }
            return;
        }

        // Raw mode - return all result files
        if (rawMode) {
            const attachments = [];
            const filesToSend = resultFiles.slice(0, 10);

            for (const file of filesToSend) {
                const filePath = path.join(outputDir, file);
                const attachment = new AttachmentBuilder(filePath, { name: file });
                attachments.push(attachment);
            }

            let message = `Found results for username "${username}" on ${foundSites.length} platforms.`;
            if (resultFiles.length > 10) {
                message += `\nShowing 10/${resultFiles.length} result files due to Discord limits.`;
            }

            await interaction.editReply({
                content: message,
                files: attachments
            });
        }
        // Standard mode - consolidate results
        else {
            const summaryPath = path.join(outputDir, `${username}_summary.txt`);
            let summaryContent = `LINKOOK RESULTS FOR USERNAME: ${username}\n`;
            summaryContent += `SCAN COMPLETED: ${new Date().toISOString()}\n\n`;

            if (foundSites.length > 0) {
                summaryContent += `FOUND ON ${foundSites.length} SITES:\n`;
                summaryContent += foundSites.join('\n');
                summaryContent += '\n\n';
            }

            for (const file of resultFiles) {
                const filePath = path.join(outputDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    summaryContent += `=== ${file} ===\n`;
                    summaryContent += content;
                    summaryContent += '\n\n';
                } catch (error) {
                    console.error(`Error reading result file ${file}:`, error);
                }
            }

            fs.writeFileSync(summaryPath, summaryContent);

            const attachment = new AttachmentBuilder(summaryPath, {
                name: `linkook_${username}_results.txt`
            });

            await interaction.editReply({
                content: `Username "${username}" found on ${foundSites.length} platforms. Complete results attached.`,
                files: [attachment]
            });
        }
    } finally {
        // Clean up temporary directory after a delay
        setTimeout(() => {
            try {
                const files = fs.readdirSync(outputDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(outputDir, file));
                }
                fs.rmdirSync(outputDir);
            } catch (error) {
                console.error('Error cleaning up output directory:', error);
            }
        }, 5000);
    }
}
