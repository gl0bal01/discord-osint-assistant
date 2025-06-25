/**
 * File: maigret.js
 * Description: Maigret collects a dossier on a person by username only, checking for accounts on a huge number of sites and gathering all the available information from web pages. No API keys are required. Maigret is an easy-to-use and powerful fork of Sherlock.
 * Author: gl0bal01
 * 
 * A discord wrapper around https://github.com/soxoj/maigret
 */
const { SlashCommandBuilder } = require('@discordjs/builders');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-maigret')
        .setDescription('Run a Maigret OSINT scan')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The username to scan for')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('verbose')
                .setDescription('Show detailed scan information')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('timeout')
                .setDescription('Maximum scan time in seconds (default: 300)')
                .setMinValue(30)
                .setMaxValue(600)
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        // Get command options
        const username = interaction.options.getString('username');
        const verbose = interaction.options.getBoolean('verbose') || false;
        const customTimeout = interaction.options.getInteger('timeout') || 300; // Default 5 minutes
        
        // Validate username to prevent command injection
        if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
            return await interaction.editReply('Invalid username format. Please use only alphanumeric characters, underscores, dots, and hyphens.');
        }
        
        // Generate random filename to prevent conflicts and increase security
        const randomId = crypto.randomBytes(8).toString('hex');
        const outputDir = path.join(__dirname, '../temp');
        const outputFile = path.join(outputDir, `maigret_${username}_${randomId}.txt`);
        
        try {
            // Ensure temp directory exists
            await fs.mkdir(outputDir, { recursive: true });
            
            // Build the Maigret command using shell redirection to capture output
            const maigretPath = process.env.MAIGRET_PATH || 'maigret';
            let command = `"${maigretPath}" ${username} -a --no-progressbar --txt`;
            if (verbose) {
                command += ' --verbose ';
            }
            command += ` > "${outputFile}"`;
            
            // Send initial status message
            await interaction.editReply(`🔍 Starting OSINT scan for username: \`${username}\`\nThis may take a few moments...`);
            
            // Execute the command with timeout handling
            await new Promise((resolve, reject) => {
                let timeoutId;
                let progressInterval;
                let elapsedTime = 0;
                const maxTime = customTimeout * 1000; // Convert seconds to milliseconds
                const progressTime = 30000; // 30 seconds for progress updates
                
                const childProcess = exec(command, (error, stdout, stderr) => {
                    clearTimeout(timeoutId);
                    clearInterval(progressInterval);
                    
                    if (error) {
                        return reject(error);
                    } else {
                        return resolve(stdout);
                    }
                    
                    if (stderr && verbose) {
                        console.error(`Maigret stderr: ${stderr}`);
                    }
                });
                
                // Set progress update interval
                progressInterval = setInterval(async () => {
                    elapsedTime += progressTime;
                    await interaction.editReply(`🔍 Scanning username: \`${username}\`\nElapsed time: ${Math.floor(elapsedTime / 1000)} seconds...`);
                }, progressTime);
                
                // Set timeout to kill process if it runs too long
                timeoutId = setTimeout(() => {
                    clearInterval(progressInterval);
                    childProcess.kill('SIGTERM');
                    reject(new Error(`Scan timed out after ${customTimeout} seconds. Please try again later.`));
                }, maxTime);
                
                // Handle potential errors
                childProcess.on('error', (error) => {
                    clearTimeout(timeoutId);
                    clearInterval(progressInterval);
                    reject(new Error(`Process error: ${error.message}`));
                });
            });
            
            // Read output file content
            let fileContent;
            try {
                fileContent = await fs.readFile(outputFile, 'utf8');
            } catch (readError) {
                fileContent = '';
            }
            
            if (fileContent.trim()) {
                // Create embed for results
                const embed = new EmbedBuilder()
                    .setTitle(`OSINT Scan Results for ${username}`)
                    .setDescription('Scan completed successfully')
                    .setColor(0x00AE86)
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });
                
                // Check file size to decide how to display results
                const stats = await fs.stat(outputFile);
                
                if (stats.size > 2000) {
                    // File is too large for preview, just attach it
                    await interaction.editReply({
                        content: '✅ Scan completed! Results were too large to preview in Discord.',
                        embeds: [embed],
                        files: [{ attachment: outputFile, name: `${username}_results.txt` }]
                    });
                } else {
                    // Add a preview of the results to the embed
                    embed.addFields({ 
                        name: 'Results Preview', 
                        value: `\`\`\`\n${fileContent.slice(0, 1000)}${fileContent.length > 1000 ? '...' : ''}\n\`\`\`` 
                    });
                    
                    await interaction.editReply({
                        embeds: [embed],
                        files: [{ attachment: outputFile, name: `${username}_results.txt` }]
                    });
                }
            } else {
                // No results found
                const embed = new EmbedBuilder()
                    .setTitle(`OSINT Scan for ${username}`)
                    .setDescription('Scan completed with no findings')
                    .setColor(0xFFFF00)
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });
                
                await interaction.editReply({
                    embeds: [embed]
                });
            }
        } catch (error) {
            console.error(`Maigret scan error: ${error.message}`);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('Scan Error')
                .setDescription(`An error occurred while scanning for \`${username}\`:`)
                .addFields({ name: 'Error Details', value: `\`\`\`\n${error.message.slice(0, 1000)}\n\`\`\`` })
                .setColor(0xFF0000)
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [errorEmbed]
            });
        } finally {
            // Clean up the output file
            try {
                await fs.unlink(outputFile).catch(() => {}); // Ignore errors if file doesn't exist
            } catch (cleanupError) {
                console.error(`Error cleaning up file: ${cleanupError.message}`);
            }
        }
    },
};

