/**
 * File: hostio.js
 * Description: Command to get domain information from host.io API
 * Author: gl0bal01
 * 
 * This command interfaces with the host.io API to retrieve comprehensive domain
 * information and related domains based on various criteria.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Available field types for search by field subcommand
const FIELD_TYPES = [
    { name: 'IP Address', value: 'ip', description: 'Find domains by IP address' },
    { name: 'Name Server', value: 'ns', description: 'Find domains by nameserver' },
    { name: 'MX Record', value: 'mx', description: 'Find domains by mail exchange record' },
    { name: 'Analytics ID', value: 'analytics', description: 'Find domains by Google Analytics ID' },
    { name: 'Adsense ID', value: 'adsense', description: 'Find domains by Google Adsense ID' },
    { name: 'ASN', value: 'asn', description: 'Find domains by Autonomous System Number' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-hostio')
        .setDescription('Get domain information from host.io')
        .addSubcommand(subcommand =>
            subcommand
                .setName('full')
                .setDescription('Get full domain information')
                .addStringOption(option =>
                    option.setName('domain')
                        .setDescription('The domain to look up')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('domains')
                .setDescription('Get domains by field and value')
                .addStringOption(option =>
                    option.setName('field')
                        .setDescription('The field to search by')
                        .setRequired(true)
                        .addChoices(...FIELD_TYPES))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('The value to search for')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Limit the number of domains returned (default: 100)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('related')
                .setDescription('Find domains related to a given domain')
                .addStringOption(option =>
                    option.setName('domain')
                        .setDescription('The domain to find related domains for')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Limit the number of domains returned (default: 100)')
                        .setRequired(false))),
    
    async execute(interaction) {
        // Defer the reply as API requests may take time
        await interaction.deferReply();

        try {
            // Get API token from environment variables
            const token = process.env.HOSTIO_API_KEY;
            if (!token) {
                return interaction.editReply('Error: HOSTIO_API_KEY not found in environment variables. Please contact the administrator.');
            }
            
            // Create a unique ID for this request for tracking and file naming
            const requestId = crypto.randomBytes(6).toString('hex');
            
            // Send initial status message
            await interaction.editReply(`Processing request ID ${requestId}...`);
            
            // Create temp directory for output files if needed
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const subcommand = interaction.options.getSubcommand();
            let apiResponse = null;
            let endpoint = '';
            let params = { token };
            let filename = '';
            
            // Build request based on subcommand
            if (subcommand === 'full') {
                const domain = interaction.options.getString('domain');
                
                // Validate domain
                if (!isValidDomain(domain)) {
                    return interaction.editReply('Please provide a valid domain name (e.g., example.com).');
                }
                
                endpoint = `https://host.io/api/full/${domain}`;
                filename = `hostio_full_${domain.replace(/\./g, '_')}_${requestId}.json`;
                
                // Update status
                await interaction.editReply(`Fetching full information for domain: ${domain} (ID: ${requestId})...`);
            } 
            else if (subcommand === 'domains') {
                const field = interaction.options.getString('field');
                const value = interaction.options.getString('value');
                const limit = interaction.options.getInteger('limit');
                
                // Validate input based on field type
                if (!validateFieldValue(field, value)) {
                    return interaction.editReply(`Invalid value format for field: ${field}. Please check your input.`);
                }
                
                endpoint = `https://host.io/api/domains/${field}/${value}`;
                if (limit) params.limit = limit;
                
                filename = `hostio_domains_${field}_${value.replace(/[^a-zA-Z0-9]/g, '_')}_${requestId}.json`;
                
                // Update status
                await interaction.editReply(`Searching for domains with ${field} = ${value} (ID: ${requestId})...`);
            }
            else if (subcommand === 'related') {
                const domain = interaction.options.getString('domain');
                const limit = interaction.options.getInteger('limit');
                
                // Validate domain
                if (!isValidDomain(domain)) {
                    return interaction.editReply('Please provide a valid domain name (e.g., example.com).');
                }
                
                endpoint = `https://host.io/api/related/${domain}`;
                if (limit) params.limit = limit;
                
                filename = `hostio_related_${domain.replace(/\./g, '_')}_${requestId}.json`;
                
                // Update status
                await interaction.editReply(`Finding domains related to: ${domain} (ID: ${requestId})...`);
            }
            
            try {
                // Make API request
                const response = await axios.get(endpoint, { 
                    params,
                    timeout: 15000  // 15 second timeout
                });
                
                apiResponse = response.data;
            } catch (apiError) {
                return handleApiError(apiError, interaction);
            }
            
            // Save the API response to a file
            const filePath = path.join(tempDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(apiResponse, null, 2));
            
            // Create an attachment
            const attachment = new AttachmentBuilder(filePath, { name: filename });
            
            // Prepare a user-friendly message based on the subcommand and response
            let summaryMessage = '';
            
            if (subcommand === 'full') {
                const domain = interaction.options.getString('domain');
                summaryMessage = `Full domain information for "${domain}"`;
                
                // Add some basic info if available
                if (apiResponse.web && apiResponse.web.title) {
                    summaryMessage += `\nTitle: ${apiResponse.web.title}`;
                }
                if (apiResponse.dns && apiResponse.dns.a && apiResponse.dns.a.length) {
                    summaryMessage += `\nIP: ${apiResponse.dns.a[0]}`;
                }
            } 
            else if (subcommand === 'domains') {
                const field = interaction.options.getString('field');
                const value = interaction.options.getString('value');
                
                // Get count of domains if available
                const domainCount = apiResponse.domains ? apiResponse.domains.length : 'Unknown';
                summaryMessage = `Found ${domainCount} domains with ${field} = "${value}"`;
            }
            else if (subcommand === 'related') {
                const domain = interaction.options.getString('domain');
                
                // Get count of related domains if available
                const domainCount = apiResponse.domains ? apiResponse.domains.length : 'Unknown';
                summaryMessage = `Found ${domainCount} domains related to "${domain}"`;
            }
            
            // Send the result
            await interaction.editReply({
                content: `${summaryMessage}\nRequest ID: ${requestId}`,
                files: [attachment]
            });
            
            // Clean up the temporary file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error deleting temporary file:', error);
                }
            }, 5000);
            
        } catch (error) {
            console.error('Error in hostio command:', error);
            await interaction.editReply(`An unexpected error occurred: ${error.message}`);
        }
    },
};

/**
 * Handle API errors and provide appropriate response
 * @param {Error} error - The error object
 * @param {Object} interaction - Discord interaction object
 */
function handleApiError(error, interaction) {
    console.error('Error with host.io API:', error);
    
    let errorMessage = 'An error occurred while fetching domain information.';
    
    if (error.response) {
        const status = error.response.status;
        
        if (status === 404) {
            errorMessage = 'No information found for this domain or value.';
        } else if (status === 401) {
            errorMessage = 'API authentication failed. Please check the API token.';
        } else if (status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
        } else {
            errorMessage = `API error: ${status} - ${error.response.statusText || 'Unknown error'}`;
        }
    } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'The request timed out. The host.io API may be experiencing issues.';
    } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'Could not reach the host.io API server. Please check your network connection.';
    } else {
        errorMessage = `Error: ${error.message}`;
    }
    
    return interaction.editReply(errorMessage);
}

/**
 * Validate domain format
 * @param {string} domain - Domain to validate
 * @returns {boolean} Whether domain is valid
 */
function isValidDomain(domain) {
    // Basic domain validation (alphanumeric with hyphens, at least one dot)
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
}

/**
 * Validate field values based on field type
 * @param {string} field - Field type
 * @param {string} value - Value to validate
 * @returns {boolean} Whether value is valid for field
 */
function validateFieldValue(field, value) {
    if (!value || value.trim() === '') return false;
    
    switch (field) {
        case 'ip':
            // Basic IPv4 validation (not perfect but catches obvious errors)
            return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
            
        case 'ns':
        case 'mx':
            // Domain name validation
            return isValidDomain(value);
            
        case 'analytics':
            // Google Analytics typically starts with UA- or G- followed by digits
            return /^(UA|G)-\d+(-\d+)?$/.test(value);
            
        case 'adsense':
            // Google Adsense IDs are typically pub- followed by digits
            return /^pub-\d+$/.test(value);
            
        case 'asn':
            // ASN is typically AS followed by a number, or just a number
            return /^(AS)?\d+$/.test(value);
            
        default:
            // Default allow all for unknown field types
            return true;
    }
}
