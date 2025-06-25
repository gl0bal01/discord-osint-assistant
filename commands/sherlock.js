/**
 * File: sherlock.js
 * Description: Username investigation across multiple social media platforms
 * Author: gl0bal01
 * 
 * This command leverages the Sherlock tool to search for usernames across
 * hundreds of social networking sites, providing comprehensive username
 * reconnaissance for OSINT investigations.
 * 
 * Features:
 * - Multi-platform username search (400+ sites)
 * - Configurable timeout and verbosity settings
 * - Real-time progress updates during scanning
 * - Secure output handling with automatic cleanup
 * - Results formatted with direct clickable links
 * 
 * Dependencies:
 * - Sherlock tool (external Python application)
 * - Internet connection for platform queries
 * 
 * Installation:
 * pip install sherlock-project
 * 
 * Usage: /sherlock username:john_doe verbose:true timeout:300
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { isValidUsername, sanitizeInput } = require('../utils/validation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-sherlock')
        .setDescription('Search for username across multiple social media platforms')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The username to search for (alphanumeric, dots, underscores, hyphens)')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(50))
        .addBooleanOption(option =>
            option.setName('verbose')
                .setDescription('Show detailed scan information and progress (default: false)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('timeout')
                .setDescription('Maximum scan time in seconds (30-600, default: 300)')
                .setMinValue(30)
                .setMaxValue(600)
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('include-nsfw')
                .setDescription('Include NSFW/adult platforms in search (default: false)')
                .setRequired(false)),
    
    /**
     * Execute the Sherlock username search command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();
        
        // Get and validate command options
        const rawUsername = interaction.options.getString('username');
        const username = sanitizeInput(rawUsername);
        const verbose = interaction.options.getBoolean('verbose') || false;
        const customTimeout = interaction.options.getInteger('timeout') || 300;
        const includeNsfw = interaction.options.getBoolean('include-nsfw') || false;
        
        // Validate username format
        if (!isValidUsername(username)) {
            return await interaction.editReply({
                content: '❌ **Invalid Username Format**\n' +
                        'Username must be 3-50 characters and contain only:\n' +
                        '• Letters (a-z, A-Z)\n' +
                        '• Numbers (0-9)\n' +
                        '• Dots (.), underscores (_), hyphens (-)\n\n' +
                        '**Examples:** `john_doe`, `user123`, `test.user`',
                ephemeral: true
            });
        }
        
        // Generate unique output filename to prevent conflicts
        const randomId = crypto.randomBytes(8).toString('hex');
        const timestamp = Date.now();
        const outputDir = path.join(__dirname, '../temp');
        const outputFile = path.join(outputDir, `sherlock_${username}_${timestamp}_${randomId}.txt`);
        
        console.log(`🕵️ [SHERLOCK] Starting username search for: ${username}`);
        
        try {
            // Ensure temp directory exists
            await fs.mkdir(outputDir, { recursive: true });
            
            // Build Sherlock command
            const sherlockPath = process.env.SHERLOCK_PATH || 'sherlock';
            let command = `"${sherlockPath}" "${username}"`;
            
            // Add command options
            if (verbose) {
                command += ' --verbose';
            }
            
            if (!includeNsfw) {
                command += ' --nsfw'; // This flag excludes NSFW sites in Sherlock
            }
            
            // Redirect output to file
            command += ` > "${outputFile}" 2>&1`;
            
            console.log(`🔧 [SHERLOCK] Executing command: ${command}`);
            
            // Send initial status message
            await interaction.editReply({
                content: `🕵️ **Username Investigation Started**\n` +
                        `🎯 **Target:** \`${username}\`\n` +
                        `⏱️ **Timeout:** ${customTimeout} seconds\n` +
                        `🔍 **Platforms:** 400+ social networks\n` +
                        `📊 **Mode:** ${verbose ? 'Verbose' : 'Standard'}\n\n` +
                        `⏳ Scanning in progress... This may take several minutes.`
            });
            
            // Execute Sherlock with comprehensive error handling
            const results = await executeSherlockScan(command, customTimeout, interaction, username);
            
            // Process and format results
            await processSherlockResults(interaction, outputFile, username, results);
            
        } catch (error) {
            console.error(`❌ [SHERLOCK] Error during scan for ${username}:`, error.message);
            await handleSherlockError(interaction, error, username);
        } finally {
            // Clean up output file
            await cleanupOutputFile(outputFile);
        }
    },
};

/**
 * Execute Sherlock scan with timeout and progress tracking
 * @param {string} command - Sherlock command to execute
 * @param {number} timeout - Timeout in seconds
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} username - Username being searched
 * @returns {Promise<Object>} Scan results
 */
async function executeSherlockScan(command, timeout, interaction, username) {
    return new Promise((resolve, reject) => {
        let timeoutId;
        let progressInterval;
        let elapsedTime = 0;
        const maxTime = timeout * 1000;
        const progressUpdateInterval = 30000; // Update every 30 seconds
        
        // Start the Sherlock process
        const childProcess = exec(command, {
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        }, (error, stdout, stderr) => {
            clearTimeout(timeoutId);
            clearInterval(progressInterval);
            
            if (error && !error.killed) {
                return reject(error);
            }
            
            resolve({
                stdout: stdout || '',
                stderr: stderr || '',
                killed: error?.killed || false
            });
        });
        
        // Set up progress updates
        progressInterval = setInterval(async () => {
            elapsedTime += progressUpdateInterval;
            const minutes = Math.floor(elapsedTime / 60000);
            const seconds = Math.floor((elapsedTime % 60000) / 1000);
            
            try {
                await interaction.editReply({
                    content: `🕵️ **Username Investigation in Progress**\n` +
                            `🎯 **Target:** \`${username}\`\n` +
                            `⏱️ **Elapsed:** ${minutes}m ${seconds}s\n` +
                            `🔍 **Status:** Scanning platforms...\n\n` +
                            `⏳ Please wait while checking 400+ social networks.`
                });
            } catch (updateError) {
                console.warn('[SHERLOCK] Failed to update progress:', updateError.message);
            }
        }, progressUpdateInterval);
        
        // Set timeout to kill process if it runs too long
        timeoutId = setTimeout(() => {
            clearInterval(progressInterval);
            childProcess.kill('SIGTERM');
            
            // Force kill if SIGTERM doesn't work
            setTimeout(() => {
                if (!childProcess.killed) {
                    childProcess.kill('SIGKILL');
                }
            }, 5000);
            
            reject(new Error(`Scan timed out after ${timeout} seconds`));
        }, maxTime);
        
        // Handle process errors
        childProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            clearInterval(progressInterval);
            reject(new Error(`Process error: ${error.message}`));
        });
    });
}

/**
 * Process Sherlock results and send formatted response
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} outputFile - Path to Sherlock output file
 * @param {string} username - Username that was searched
 * @param {Object} results - Sherlock execution results
 */
async function processSherlockResults(interaction, outputFile, username, results) {
    try {
        // Read output file content
        let fileContent = '';
        try {
            fileContent = await fs.readFile(outputFile, 'utf8');
        } catch (readError) {
            console.warn('[SHERLOCK] Could not read output file:', readError.message);
            fileContent = results.stdout || '';
        }
        
        console.log(`📊 [SHERLOCK] Processing results for ${username} (${fileContent.length} characters)`);
        
        if (!fileContent.trim()) {
            return await interaction.editReply({
                content: `❌ **No Results Generated**\n` +
                        `The scan for \`${username}\` completed but produced no output.\n\n` +
                        `**Possible causes:**\n` +
                        `• Sherlock tool is not properly installed\n` +
                        `• Network connectivity issues\n` +
                        `• Username contains invalid characters\n` +
                        `• All platforms were unreachable`
            });
        }
        
        // Parse results to extract found profiles
        const foundProfiles = parseSherlockOutput(fileContent);
        
        // Create response message
        let responseMessage = `🕵️ **Username Investigation Results**\n`;
        responseMessage += `🎯 **Target:** \`${username}\`\n`;
        responseMessage += `📊 **Scan Status:** ${results.killed ? 'Timed out' : 'Completed'}\n`;
        
        if (foundProfiles.length > 0) {
            responseMessage += `✅ **Profiles Found:** ${foundProfiles.length}\n\n`;
            
            // Add direct links (limited by Discord message length)
            const maxLinksInMessage = 10;
            const displayLinks = foundProfiles.slice(0, maxLinksInMessage);
            
            responseMessage += `**🔗 Direct Links:**\n`;
            displayLinks.forEach((profile, index) => {
                responseMessage += `${index + 1}. **${profile.platform}**: ${profile.url}\n`;
            });
            
            if (foundProfiles.length > maxLinksInMessage) {
                responseMessage += `\n*... and ${foundProfiles.length - maxLinksInMessage} more (see attached file)*\n`;
            }
            
        } else {
            responseMessage += `❌ **No Profiles Found**\n\n`;
            responseMessage += `No matching profiles were discovered across the scanned platforms.`;
        }
        
        // Check Discord message limits and truncate if necessary
        if (responseMessage.length > 1900) {
            responseMessage = responseMessage.substring(0, 1900) + '\n\n*[Message truncated - see attached file for complete results]*';
        }
        
        // Create attachment with full results
        const attachment = new AttachmentBuilder(
            Buffer.from(fileContent, 'utf8'),
            { name: `sherlock_${username}_results.txt` }
        );
        
        // Send final response
        await interaction.editReply({
            content: responseMessage,
            files: [attachment]
        });
        
        console.log(`✅ [SHERLOCK] Successfully completed scan for ${username} - ${foundProfiles.length} profiles found`);
        
    } catch (error) {
        console.error('[SHERLOCK] Error processing results:', error);
        await interaction.editReply({
            content: `❌ **Error Processing Results**\n` +
                    `The scan completed but there was an error processing the output.\n` +
                    `Error: ${error.message}`,
            ephemeral: false
        });
    }
}

/**
 * Parse Sherlock output to extract found profiles
 * @param {string} content - Raw Sherlock output
 * @returns {Array<Object>} Array of found profile objects
 */
function parseSherlockOutput(content) {
    const foundProfiles = [];
    const lines = content.split('\n');
    
    // Sherlock output patterns
    const patterns = [
        // Standard format: [+] Platform: https://url
        /\[\+\]\s+([^:]+):\s+(https?:\/\/[^\s]+)/gi,
        // Alternative format: [+] Platform - https://url
        /\[\+\]\s+([^-]+)-\s+(https?:\/\/[^\s]+)/gi,
        // Verbose format may include additional info
        /\[\+\]\s+(.+?):\s+(https?:\/\/\S+)(?:\s|$)/gi
    ];
    
    for (const line of lines) {
        for (const pattern of patterns) {
            pattern.lastIndex = 0; // Reset regex state
            const match = pattern.exec(line);
            
            if (match) {
                const platform = match[1].trim();
                const url = match[2].trim();
                
                // Validate URL and avoid duplicates
                if (isValidUrl(url) && !foundProfiles.some(p => p.url === url)) {
                    foundProfiles.push({
                        platform: platform,
                        url: url,
                        raw: line.trim()
                    });
                }
                break; // Move to next line after finding a match
            }
        }
    }
    
    // Sort profiles alphabetically by platform name
    foundProfiles.sort((a, b) => a.platform.localeCompare(b.platform));
    
    return foundProfiles;
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} Whether URL is valid
 */
function isValidUrl(url) {
    try {
        const urlObj = new URL(url);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
        return false;
    }
}

/**
 * Handle Sherlock execution errors
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Error} error - The error that occurred
 * @param {string} username - Username being searched
 */
async function handleSherlockError(interaction, error, username) {
    let errorMessage = `❌ **Sherlock Scan Failed**\n`;
    errorMessage += `🎯 **Target:** \`${username}\`\n\n`;
    
    if (error.message.includes('timed out')) {
        errorMessage += `**⏱️ Timeout Error**\n`;
        errorMessage += `The scan exceeded the maximum time limit.\n\n`;
        errorMessage += `**Solutions:**\n`;
        errorMessage += `• Try again with a longer timeout\n`;
        errorMessage += `• Check your internet connection\n`;
        errorMessage += `• Some platforms may be temporarily unavailable`;
        
    } else if (error.code === 'ENOENT') {
        errorMessage += `**🔧 Tool Not Found**\n`;
        errorMessage += `Sherlock is not installed or not found in PATH.\n\n`;
        errorMessage += `**Installation:**\n`;
        errorMessage += `\`pip install sherlock-project\`\n\n`;
        errorMessage += `**Alternative:**\n`;
        errorMessage += `Set SHERLOCK_PATH in environment variables`;
        
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        errorMessage += `**🌐 Network Error**\n`;
        errorMessage += `Unable to connect to social media platforms.\n\n`;
        errorMessage += `**Possible causes:**\n`;
        errorMessage += `• Internet connection issues\n`;
        errorMessage += `• Firewall blocking connections\n`;
        errorMessage += `• DNS resolution problems`;
        
    } else {
        errorMessage += `**🚨 Unexpected Error**\n`;
        errorMessage += `\`${error.message.slice(0, 500)}\`\n\n`;
        errorMessage += `Please try again or contact the administrator if the problem persists.`;
    }
    
    await interaction.editReply({
        content: errorMessage,
        ephemeral: false
    });
}

/**
 * Clean up temporary output file
 * @param {string} outputFile - Path to the output file
 */
async function cleanupOutputFile(outputFile) {
    try {
        await fs.unlink(outputFile);
        console.log(`🗑️ [SHERLOCK] Cleaned up output file: ${path.basename(outputFile)}`);
    } catch (error) {
        console.warn(`⚠️ [SHERLOCK] Failed to cleanup file ${outputFile}:`, error.message);
    }
}
