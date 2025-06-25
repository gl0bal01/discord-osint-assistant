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

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const { spawn } = require('child_process');
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
            const rawMode = interaction.options.getBoolean('raw') || false;
            
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
            console.error('Error in linkook command:', error);
            await interaction.editReply(`An error occurred: ${error.message}`);
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
    return new Promise((resolve, reject) => {
        // Variables to capture process output
        let stdoutData = '';
        let stderrData = '';
        let foundSites = [];
        
        // Spawn the Linkook process
        const linkookProcess = spawn('linkook', args);
        
        // Collect stdout data
        linkookProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            
            // Try to extract found sites from the output
            const lines = output.split('\n');
            for (const line of lines) {
                // Extract site names based on common output patterns
                // This may need adjustment based on Linkook's actual output format
                if (line.includes('[+]') || line.includes('FOUND:')) {
                    const siteName = line.match(/\[([^\]]+)\]/) || line.match(/FOUND: ([^\s]+)/);
                    if (siteName && siteName[1]) {
                        foundSites.push(siteName[1]);
                    }
                }
            }
            
            // Provide periodic updates
            if (foundSites.length > 0 && foundSites.length % 5 === 0) {
                interaction.editReply(`Found ${foundSites.length} sites for username "${username}" so far...`).catch(() => {});
            }
        });
        
        // Collect stderr data
        linkookProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        
        // Set a timeout to kill the process if it takes too long
        const timeout = setTimeout(() => {
            linkookProcess.kill();
            reject(new Error('Linkook process timed out after 3 minutes. Try again later.'));
        }, 180000); // 3 minute timeout
        
        // Handle process completion
        linkookProcess.on('close', async (code) => {
            clearTimeout(timeout);
            
            if (code !== 0 && stdoutData.trim() === '' && foundSites.length === 0) {
                reject(new Error(`Linkook process exited with code ${code}: ${stderrData}`));
                return;
            }
            
            try {
                // Check if there are any result files
                const resultFiles = fs.readdirSync(outputDir);
                if (resultFiles.length === 0) {
                    // No files but we might have console output
                    if (foundSites.length > 0) {
                        await interaction.editReply(`Found ${foundSites.length} sites for username "${username}", but no result files were created.\n\nSites: ${foundSites.join(', ')}`);
                    } else {
                        await interaction.editReply(`No results found for username "${username}". The username might not exist on any of the scanned platforms.`);
                    }
                    resolve();
                    return;
                }
                
                // Raw mode - return all result files
                if (rawMode) {
                    const attachments = [];
                    
                    // Limit to 10 files to avoid Discord limits
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
                    // Create a summary file
                    const summaryPath = path.join(outputDir, `${username}_summary.txt`);
                    let summaryContent = `LINKOOK RESULTS FOR USERNAME: ${username}\n`;
                    summaryContent += `SCAN COMPLETED: ${new Date().toISOString()}\n\n`;
                    
                    if (foundSites.length > 0) {
                        summaryContent += `FOUND ON ${foundSites.length} SITES:\n`;
                        summaryContent += foundSites.join('\n');
                        summaryContent += '\n\n';
                    }
                    
                    // Add content from result files
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
                    
                    // Write the summary file
                    fs.writeFileSync(summaryPath, summaryContent);
                    
                    // Create attachment with the summary file
                    const attachment = new AttachmentBuilder(summaryPath, { 
                        name: `linkook_${username}_results.txt` 
                    });
                    
                    await interaction.editReply({
                        content: `Username "${username}" found on ${foundSites.length} platforms. Complete results attached.`,
                        files: [attachment]
                    });
                }
                
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                // Clean up temporary directory after a delay
                setTimeout(() => {
                    try {
                        // Delete all files in the directory
                        const files = fs.readdirSync(outputDir);
                        for (const file of files) {
                            fs.unlinkSync(path.join(outputDir, file));
                        }
                        // Delete the directory
                        fs.rmdirSync(outputDir);
                    } catch (error) {
                        console.error('Error cleaning up output directory:', error);
                    }
                }, 5000);
            }
        });
        
        // Handle process errors
        linkookProcess.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start Linkook process: ${error.message}`));
        });
    });
}
