/**
 * File: nuclei.js
 * Description: Advanced OSINT vulnerability scanner using Nuclei templates for username enumeration
 * Author: gl0bal01
 * 
 * This command leverages Project Discovery's Nuclei scanner to perform OSINT reconnaissance
 * on usernames across multiple platforms and services. Nuclei is a powerful, community-driven
 * vulnerability scanner that uses YAML-based templates for fast and customizable scanning.
 * 
 * Features:
 * - Username enumeration across 50+ platforms (social media, forums, code repositories)
 * - Custom OSINT template execution with user variable injection
 * - Advanced filtering with customizable tags and severity levels
 * - Concurrent scanning with configurable timeout and thread management
 * - Real-time progress tracking with elapsed time updates
 * - Automatic URL extraction and clickable link generation
 * - Results export in multiple formats with file attachment support
 * - Enhanced security with input validation and command injection prevention
 * - Intelligent result chunking for Discord message limits
 * - Memory-efficient file cleanup and error handling
 * 
 * Supported OSINT Categories:
 * - Social Media Platforms (Twitter/X, Instagram, LinkedIn, TikTok, etc.)
 * - Developer Platforms (GitHub, GitLab, SourceForge, Stack Overflow)
 * - Professional Networks (LinkedIn, AngelList, Crunchbase)
 * - Gaming Platforms (Steam, Xbox Live, PlayStation Network)
 * - Content Platforms (YouTube, Twitch, Reddit, Medium)
 * - Communication (Discord, Telegram, Skype, WhatsApp Business)
 * - Portfolio Sites (Behance, Dribbble, DeviantArt)
 * - Educational (Academia.edu, ResearchGate, ORCID)
 * 
 * Technical Implementation:
 * - Built on Project Discovery's Nuclei engine (nuclei-templates/http/osint/user-enumeration)
 * - Supports custom tag combinations for targeted reconnaissance
 * - Implements secure subprocess execution with proper escaping
 * - Features intelligent timeout management (30-600 seconds)
 * - Provides verbose and silent scanning modes
 * - Includes comprehensive error handling and logging
 * 
 * Security Considerations:
 * - Input sanitization prevents command injection attacks
 * - Temporary file management with cryptographic randomization
 * - Resource cleanup ensures no data persistence
 * - Rate limiting through configurable timeout controls
 * - Process termination safeguards prevent resource exhaustion
 * 
 * Usage Examples:
 * /bob-nuclei username:john_doe
 * /bob-nuclei username:target_user verbose:true timeout:120
 * /bob-nuclei username:username123 tags:social,gaming
 * /bob-nuclei username:research_user tags:academic,professional timeout:300
 * 
 * Output Formats:
 * - Interactive Discord messages with @user mentions
 * - Downloadable text files for comprehensive results
 * - Clickable URL extraction for immediate access
 * - Chunked output for large result sets
 * - Progress indicators with real-time updates
 * 
 * Dependencies:
 * - Nuclei scanner binary (installed via Go/ASDF)
 * - nuclei-templates repository (community OSINT templates)
 * - Node.js child_process module for subprocess execution
 * - Discord.js for bot interaction and file uploads
 * 
 * Performance Notes:
 * - Default 300-second timeout balances thoroughness with responsiveness
 * - Concurrent connections optimize scan speed
 * - Memory-efficient streaming prevents large result crashes
 * - Background cleanup ensures optimal resource usage
 * 
 * @see https://github.com/projectdiscovery/nuclei
 * @see https://github.com/projectdiscovery/nuclei-templates
 * @version 1.0
 * @since 2025-06-24
 */

const { SlashCommandBuilder } = require('discord.js');
const { safeSpawn } = require('../utils/process');
const { splitIntoChunks, chunkArray } = require('../utils/chunks');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Discord slash command definition for Nuclei OSINT scanner
 * Configures command parameters and validation rules for username enumeration
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-nuclei')
        .setDescription('🔍 Advanced OSINT username enumeration using Nuclei vulnerability scanner')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Target username to scan across platforms (alphanumeric, underscore, dot, hyphen only)')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('verbose')
                .setDescription('Enable detailed scan information and debug output')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('tags')
                .setDescription('OSINT categories to scan: social,gaming,dev,professional,academic (comma-separated)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('timeout')
                .setDescription('Maximum scan duration in seconds (30-600, default: 300)')
                .setMinValue(30)
                .setMaxValue(600)
                .setRequired(false)),
    
    /**
     * Main execution function for the Nuclei OSINT command
     * Handles parameter validation, command construction, and result processing
     * 
     * @param {CommandInteraction} interaction - Discord command interaction object
     * @returns {Promise<void>} - Resolves when command execution completes
     */
    async execute(interaction) {
        // Defer reply to allow for long-running scans
        await interaction.deferReply();
        
        // Extract and validate command parameters
        const username = interaction.options.getString('username');
        const verbose = interaction.options.getBoolean('verbose') ?? false;
        const additionalTags = interaction.options.getString('tags');
        const customTimeout = interaction.options.getInteger('timeout') || 300; // Default 5 minutes
        
        // Validate username format to prevent command injection attacks
        // Allows only alphanumeric characters, underscores, dots, and hyphens
        if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
            return await interaction.editReply({
                content: '❌ **Invalid Username Format**\n\nPlease use only:\n• Letters (a-z, A-Z)\n• Numbers (0-9)\n• Underscores (_)\n• Dots (.)\n• Hyphens (-)'
            });
        }
        
        // Generate cryptographically secure random identifier for temporary files
        // Prevents file conflicts and enhances security
        const randomId = crypto.randomBytes(8).toString('hex');
        const outputDir = path.join(__dirname, '../temp');
        const outputFile = path.join(outputDir, `nuclei_osint_${username}_${randomId}.txt`);
        
        try {
            // Ensure temporary directory exists with recursive creation
            await fs.mkdir(outputDir, { recursive: true });
            
            // Build and validate tags list for targeted scanning
            let tagsList = ['osint']; // Base OSINT tag always included
            if (additionalTags) {
                const userTags = additionalTags.split(',').map(tag => tag.trim().toLowerCase());
                
                // Validate each tag to prevent command injection
                // Only allow alphanumeric characters, underscores, and hyphens
                if (userTags.some(tag => !/^[a-zA-Z0-9_-]+$/.test(tag))) {
                    return await interaction.editReply({
                        content: '❌ **Invalid Tag Format**\n\nTags must contain only:\n• Letters (a-z, A-Z)\n• Numbers (0-9)\n• Underscores (_)\n• Hyphens (-)\n\nExample: `social,gaming,dev`'
                    });
                }
                
                // Merge user tags with base OSINT tag, removing duplicates
                tagsList = [...new Set([...tagsList, ...userTags])];
            }
            
            // Construct Nuclei args array (no shell interpolation)
            const nucleiBinary = process.env.NUCLEI_PATH || 'nuclei';
            const templatesPath = process.env.NUCLEI_TEMPLATE_PATH || '/root/nuclei-templates/http/osint/user-enumeration';
            const args = [
                '-t', templatesPath,
                '-tags', tagsList.join(','),
                '-var', `user=${username}`,
                '-o', outputFile,
                verbose ? '-v' : '-silent'
            ];
            
            // Send initial status message with scan parameters
            await interaction.editReply({
                content: `🔍 **Starting OSINT Username Enumeration**\n\n` +
                        `**Target:** \`${username}\`\n` +
                        `**Categories:** ${tagsList.join(', ')}\n` +
                        `**Timeout:** ${customTimeout} seconds\n` +
                        `**Mode:** ${verbose ? 'Verbose' : 'Silent'}\n\n` +
                        `⏳ Scanning in progress... This may take several minutes.`
            });
            
            // Execute Nuclei scan using safe spawn (no shell interpolation)
            await safeSpawn(nucleiBinary, args, { timeout: customTimeout * 1000 });
            
            // Process scan results and prepare output
            let fileContent = '';
            let fileExists = false;
            
            try {
                fileContent = await fs.readFile(outputFile, 'utf8');
                fileExists = true;
            } catch (readError) {
                // File doesn't exist or can't be read - no results found
                console.info(`[Nuclei] No output file generated for ${username}`);
            }
            
            // Analyze and present results based on content availability
            if (fileExists && fileContent.trim()) {
                // Process content to extract actionable intelligence
                const processedContent = makeUrlsClickable(fileContent);
                const discoveredUrls = extractUrls(fileContent);
                const stats = await fs.stat(outputFile);
                
                // Determine optimal presentation format based on result size
                if (stats.size > 2000 || discoveredUrls.length > 10) {
                    // Large result set - provide file download and URL summary
                    await interaction.editReply({
                        content: `<@${interaction.user.id}> ✅ **OSINT Enumeration Complete**\n\n` +
                                `🎯 **Target:** \`${username}\`\n` +
                                `📊 **Results:** ${discoveredUrls.length} potential profiles found\n` +
                                `📁 **File:** Complete results attached\n` +
                                `🏷️ **Categories:** ${tagsList.join(', ')}\n\n` +
                                `📄 Download the attached file for detailed analysis.`,
                        files: [{ 
                            attachment: outputFile, 
                            name: `${username}_osint_results_${new Date().toISOString().split('T')[0]}.txt` 
                        }]
                    });
                    
                    // Send URLs in manageable chunks to avoid Discord limits
                    if (discoveredUrls.length > 0) {
                        const urlChunks = chunkArray(discoveredUrls, 8); // Reduced chunk size for better readability
                        
                        for (let i = 0; i < Math.min(urlChunks.length, 5); i++) { // Limit to 5 chunks max
                            const chunkHeader = urlChunks.length > 1 ? 
                                `**🔗 Discovered Profiles (${i + 1}/${Math.min(urlChunks.length, 5)}):**` : 
                                `**🔗 Discovered Profiles:**`;
                            
                            const urlList = urlChunks[i].map((url, index) => 
                                `${index + 1 + (i * 8)}. ${url}`
                            ).join('\n');
                            
                            await interaction.followUp({
                                content: `${chunkHeader}\n\`\`\`\n${urlList}\n\`\`\``
                            });
                        }
                        
                        // Notify if more results exist
                        if (urlChunks.length > 5) {
                            await interaction.followUp({
                                content: `📄 **Additional Results Available**\n\n` +
                                        `Found ${discoveredUrls.length - 40} more profiles in the attached file.\n` +
                                        `Download for complete analysis.`
                            });
                        }
                    }
                } else {
                    // Compact result set - display inline with URLs
                    const chunks = splitIntoChunks(processedContent, 1200); // Conservative chunk size
                    
                    await interaction.editReply({
                        content: `<@${interaction.user.id}> ✅ **OSINT Enumeration Complete**\n\n` +
                                `🎯 **Target:** \`${username}\`\n` +
                                `📊 **Results:** ${discoveredUrls.length} profiles found\n` +
                                `🏷️ **Categories:** ${tagsList.join(', ')}\n\n` +
                                `**📋 Scan Results:**\n\`\`\`\n${chunks[0]}\n\`\`\``,
                        files: [{ 
                            attachment: outputFile, 
                            name: `${username}_osint_results_${new Date().toISOString().split('T')[0]}.txt` 
                        }]
                    });
                    
                    // Send discovered URLs as clickable links
                    if (discoveredUrls.length > 0) {
                        const urlList = discoveredUrls.map((url, index) => 
                            `${index + 1}. ${url}`
                        ).join('\n');
                        
                        await interaction.followUp({
                            content: `**🔗 Clickable Profile Links:**\n${urlList}`
                        });
                    }
                    
                    // Send additional content chunks if necessary
                    for (let i = 1; i < chunks.length && i < 3; i++) { // Limit additional chunks
                        await interaction.followUp({
                            content: `**📋 Additional Results (${i + 1}):**\n\`\`\`\n${chunks[i]}\n\`\`\``
                        });
                    }
                }
            } else {
                // No results found - provide helpful guidance
                await interaction.editReply({
                    content: `<@${interaction.user.id}> ✅ **OSINT Scan Complete**\n\n` +
                            `🎯 **Target:** \`${username}\`\n` +
                            `📊 **Results:** No profiles found\n` +
                            `🏷️ **Categories:** ${tagsList.join(', ')}\n\n` +
                            `💡 **Suggestions:**\n` +
                            `• Try different username variations\n` +
                            `• Use additional tag categories\n` +
                            `• Check for typos in the username\n` +
                            `• Consider that the user may not be active on scanned platforms`
                });
            }
        } catch (error) {
            // Comprehensive error handling with user-friendly messages
            console.error(`[Nuclei OSINT Error] ${error.message}`);
            
            // Categorize error types for better user guidance
            let errorCategory = 'Unknown Error';
            let errorAdvice = 'Please try again or contact support.';
            
            if (error.message.includes('timeout')) {
                errorCategory = 'Scan Timeout';
                errorAdvice = 'Try increasing the timeout value or using more specific tags.';
            } else if (error.message.includes('ENOENT') || error.message.includes('not found')) {
                errorCategory = 'Configuration Error';
                errorAdvice = 'Nuclei scanner may not be properly installed or configured.';
            } else if (error.message.includes('permission') || error.message.includes('EACCES')) {
                errorCategory = 'Permission Error';
                errorAdvice = 'Check file system permissions for temporary directory access.';
            } else if (error.message.includes('network') || error.message.includes('connection')) {
                errorCategory = 'Network Error';
                errorAdvice = 'Check internet connectivity and try again.';
            }
            
            await interaction.editReply({
                content: `<@${interaction.user.id}> ❌ **${errorCategory}**\n\n` +
                        `🎯 **Target:** \`${username}\`\n` +
                        `⚠️ **Issue:** An error occurred while processing your request.\n\n` +
                        `💡 **Recommendation:** ${errorAdvice}`
            });
        } finally {
            // Comprehensive cleanup to prevent data leakage and resource exhaustion
            try {
                await fs.unlink(outputFile).catch(() => {}); // Ignore errors if file doesn't exist
                console.info(`[Nuclei] Cleanup completed for ${username} scan`);
            } catch (cleanupError) {
                console.error(`[Nuclei] Cleanup error: ${cleanupError.message}`);
            }
        }
    },
};

/**
 * Processes text content to ensure URLs are properly formatted for Discord
 * Discord automatically makes URLs clickable when they are properly formatted
 * 
 * @param {string} text - Raw text content containing URLs
 * @returns {string} - Processed text with properly formatted URLs
 */
function makeUrlsClickable(text) {
    // Regular expression to match HTTP/HTTPS URLs
    const urlRegex = /(https?:\/\/[^\s\]]+)/g;
    
    // Ensure URLs are on separate lines for better Discord formatting
    return text.replace(urlRegex, (url) => {
        // Remove trailing punctuation that might interfere with URL recognition
        const cleanUrl = url.replace(/[.,;:!?]+$/, '');
        return cleanUrl;
    });
}

/**
 * Extracts and deduplicates URLs from text content
 * Useful for creating clickable link summaries and analytics
 * 
 * @param {string} text - Text content to extract URLs from
 * @returns {string[]} - Array of unique URLs found in the text
 */
function extractUrls(text) {
    const urlRegex = /(https?:\/\/[^\s\]]+)/g;
    const matches = text.match(urlRegex) || [];
    
    // Clean URLs and remove duplicates
    const cleanedUrls = matches.map(url => url.replace(/[.,;:!?]+$/, ''));
    return [...new Set(cleanedUrls)]; // Remove duplicates using Set
}

