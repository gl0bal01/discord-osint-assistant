/**
 * File: dns.js
 * Description: DNS information retrieval command for domain reconnaissance
 * Author: gl0bal01
 * 
 * This command provides comprehensive DNS information for domain analysis including:
 * - DNS records (A, AAAA, MX, TXT, CNAME, NS)
 * - Domain configuration details
 * - Nameserver information
 * - Security records (SPF, DKIM, DMARC)
 * 
 * Dependencies:
 * - DNSDumpster API (requires DNSDUMPSTER_TOKEN in .env)
 * - Axios for HTTP requests
 * 
 * Usage: /bob-dns domain:example.com
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { isValidDomain, sanitizeInput } = require('../utils/validation');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-dns')
        .setDescription('Retrieve comprehensive DNS information for a domain')
        .addStringOption(option => 
            option.setName('domain')
                .setDescription('The domain to analyze (e.g., example.com)')
                .setRequired(true)
                .setMaxLength(253)), // RFC compliant domain length limit
    
    /**
     * Execute the DNS lookup command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        // Defer reply to handle longer processing times
        await interaction.deferReply();

        // Get and validate domain input
        const rawDomain = interaction.options.getString('domain');
        const domain = sanitizeInput(rawDomain);
        
        // Validate domain format
        if (!isValidDomain(domain)) {
            return interaction.editReply({
                content: '❌ **Invalid Domain Format**\n' +
                        'Please provide a valid domain name (e.g., `example.com`).\n' +
                        '• Domain must contain only letters, numbers, dots, and hyphens\n' +
                        '• Must have a valid TLD extension\n' +
                        '• Maximum length: 253 characters',
                ephemeral: true
            });
        }
        
        // Check for required API token
        const apiToken = process.env.DNSDUMPSTER_TOKEN;
        if (!apiToken) {
            return interaction.editReply({
                content: '❌ **Configuration Error**\n' +
                        'DNSDumpster API token is not configured. Please contact the administrator.',
                ephemeral: true
            });
        }
        
        try {
            console.log(`🔍 [DNS] Starting DNS lookup for domain: ${domain}`);
            
            // Make API request to DNSDumpster with timeout
            const response = await axios.get(`https://api.dnsdumpster.com/domain/${domain}`, {
                headers: {
                    'X-API-Key': apiToken,
                    'User-Agent': 'Discord-OSINT-Assistant/2.0'
                },
                timeout: 15000 // 15 second timeout
            });
            
            const dnsData = response.data;
            
            // Check if we received valid data
            if (!dnsData || Object.keys(dnsData).length === 0) {
                return interaction.editReply({
                    content: `❌ **No DNS Information Found**\n` +
                            `No DNS records were found for \`${domain}\`.\n\n` +
                            `**Possible reasons:**\n` +
                            `• Domain does not exist\n` +
                            `• Domain has no public DNS records\n` +
                            `• Temporary DNS resolution issues`,
                    ephemeral: false
                });
            }

            // Format the response data
            const formattedData = formatDnsData(dnsData, domain);
            
            // Check Discord message limits
            if (formattedData.length <= 2000) {
                // Send as single message
                return interaction.editReply({
                    content: `🔍 **DNS Analysis Results for \`${domain}\`**\n\`\`\`json\n${formattedData}\n\`\`\``
                });
            } else {
                // Split into multiple messages
                const chunks = splitIntoChunks(formattedData, 1900); // Leave room for formatting
                
                // Send first chunk as edit
                await interaction.editReply({
                    content: `🔍 **DNS Analysis Results for \`${domain}\`** (Part 1/${chunks.length})\n\`\`\`json\n${chunks[0]}\n\`\`\``
                });
                
                // Send remaining chunks as follow-ups
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({
                        content: `📋 **DNS Data Continuation** (Part ${i + 1}/${chunks.length})\n\`\`\`json\n${chunks[i]}\n\`\`\``
                    });
                }
            }

            console.log(`✅ [DNS] Successfully completed DNS lookup for: ${domain}`);

        } catch (error) {
            console.error(`❌ [DNS] Error during DNS lookup for ${domain}:`, error.message);
            
            // Handle different types of errors
            let errorMessage = '❌ **DNS Lookup Failed**\n';
            
            if (error.response) {
                const statusCode = error.response.status;
                
                switch (statusCode) {
                    case 401:
                    case 403:
                        errorMessage += 'Authentication failed. Invalid API key or unauthorized access.';
                        break;
                    case 404:
                        errorMessage += `Domain \`${domain}\` not found or has no DNS records.`;
                        break;
                    case 429:
                        errorMessage += 'Rate limit exceeded. Please wait before trying again.\n' +
                                      '• DNSDumpster limits: 1 request per 2 seconds';
                        break;
                    case 500:
                    case 502:
                    case 503:
                        errorMessage += 'DNS service is temporarily unavailable. Please try again later.';
                        break;
                    default:
                        errorMessage += `API error (${statusCode}): ${error.response.statusText || 'Unknown error'}`;
                }
                
                // Log detailed error for debugging
                console.error(`[DNS] API Error Details:`, {
                    status: statusCode,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
                
            } else if (error.code === 'ECONNABORTED') {
                errorMessage += 'Request timed out. The DNS service may be slow or unavailable.';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                errorMessage += 'Cannot connect to DNS service. Please check your internet connection.';
            } else {
                errorMessage += `Unexpected error: ${error.message}`;
            }
            
            return interaction.editReply({
                content: errorMessage,
                ephemeral: false
            });
        }
    },
};

/**
 * Format DNS data for display
 * @param {Object} data - Raw DNS data from API
 * @param {string} domain - Original domain queried
 * @returns {string} Formatted DNS information
 */
function formatDnsData(data, domain) {
    try {
        // Create a clean, readable format
        const formatted = {
            domain: domain,
            timestamp: new Date().toISOString(),
            records: data
        };
        
        return JSON.stringify(formatted, null, 2);
    } catch (error) {
        console.error('[DNS] Error formatting data:', error);
        return JSON.stringify(data, null, 2);
    }
}

/**
 * Split text into chunks that fit Discord message limits
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum length per chunk
 * @returns {Array<string>} Array of text chunks
 */
function splitIntoChunks(text, maxLength) {
    const chunks = [];
    const lines = text.split('\n');
    let currentChunk = '';
    
    for (const line of lines) {
        // Check if adding this line would exceed the limit
        if (currentChunk.length + line.length + 1 > maxLength) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    
    // Add the last chunk if it has content
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}
