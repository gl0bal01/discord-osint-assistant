/**
 * File: whoxy.js
 * Description: Comprehensive WHOIS history and reverse lookup analysis
 * Author: gl0bal01
 * 
 * This command provides advanced WHOIS intelligence capabilities including:
 * - Historical WHOIS record analysis for domains
 * - Reverse WHOIS searches by registrant details
 * - Account balance monitoring for Whoxy API
 * - Domain ownership pattern analysis
 * - Export functionality for investigation workflows
 * 
 * Features:
 * - Multi-format search support (domain, email, name, company)
 * - Historical change tracking and timeline analysis
 * - Risk assessment for domain ownership patterns
 * - Bulk result export for further analysis
 * - Privacy-aware redaction options
 * 
 * Usage: /bob-whoxy type:history domain:example.com
 *        /bob-whoxy type:reverse identifier:email value:admin@example.com
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { isValidDomain, isValidEmail, sanitizeInput } = require('../utils/validation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-whoxy')
        .setDescription('Advanced WHOIS analysis and domain intelligence gathering')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('Type of WHOIS analysis to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'WHOIS History', value: 'history' },
                    { name: 'Reverse WHOIS', value: 'reverse' },
                    { name: 'Account Balance', value: 'balance' }
                ))
        .addStringOption(option => 
            option.setName('domain')
                .setDescription('Domain to analyze (required for WHOIS history)')
                .setRequired(false)
                .setMaxLength(253))
        .addStringOption(option => 
            option.setName('identifier')
                .setDescription('Search field for reverse WHOIS lookups')
                .setRequired(false)
                .addChoices(
                    { name: 'Registrant Name', value: 'name' },
                    { name: 'Email Address', value: 'email' },
                    { name: 'Company/Organization', value: 'company' },
                    { name: 'Keyword Search', value: 'keyword' }
                ))
        .addStringOption(option => 
            option.setName('value')
                .setDescription('Search value for reverse WHOIS (e.g., john@example.com)')
                .setRequired(false)
                .setMaxLength(100))
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Include detailed analysis and timeline (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('privacy-mode')
                .setDescription('Redact potentially sensitive information (default: false)')
                .setRequired(false)),
    
    /**
     * Execute the WHOIS analysis command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();
        
        // Get and validate command options
        const requestType = interaction.options.getString('type');
        const rawDomain = interaction.options.getString('domain');
        const identifier = interaction.options.getString('identifier');
        const rawValue = interaction.options.getString('value');
        const detailed = interaction.options.getBoolean('detailed') || false;
        const privacyMode = interaction.options.getBoolean('privacy-mode') || false;
        
        // Sanitize inputs
        const domain = rawDomain ? sanitizeInput(rawDomain) : null;
        const searchValue = rawValue ? sanitizeInput(rawValue) : null;
        
        console.log(`🔍 [WHOXY] Starting ${requestType} analysis`);
        
        // Validate API key
        const apiKey = process.env.WHOXY_API_KEY;
        if (!apiKey) {
            return interaction.editReply({
                content: '❌ **Configuration Error**\n' +
                        'Whoxy API key is not configured. Please contact the administrator.\n\n' +
                        '**Setup Instructions:**\n' +
                        '1. Get API key from https://www.whoxy.com/\n' +
                        '2. Add WHOXY_API_KEY to environment variables',
                ephemeral: true
            });
        }
        
        try {
            // Execute the appropriate analysis
            let analysisData;
            
            switch (requestType) {
                case 'balance':
                    analysisData = await performBalanceCheck(apiKey);
                    break;
                case 'history':
                    if (!domain) {
                        return interaction.editReply({
                            content: '❌ **Missing Domain**\n' +
                                    'Please provide a domain name for WHOIS history analysis.',
                            ephemeral: true
                        });
                    }
                    analysisData = await performHistoryAnalysis(domain, apiKey, detailed, privacyMode);
                    break;
                case 'reverse':
                    if (!identifier || !searchValue) {
                        return interaction.editReply({
                            content: '❌ **Missing Search Parameters**\n' +
                                    'Please provide both an identifier type and search value for reverse WHOIS lookup.',
                            ephemeral: true
                        });
                    }
                    analysisData = await performReverseAnalysis(identifier, searchValue, apiKey, detailed, privacyMode);
                    break;
                default:
                    return interaction.editReply({
                        content: '❌ **Invalid Request Type**\n' +
                                'Please select a valid analysis type.',
                        ephemeral: true
                    });
            }
            
            // Create response
            const embed = createWhoxyEmbed(analysisData, requestType);
            const attachment = detailed ? await createDetailedReport(analysisData, requestType) : null;
            
            // Send response
            const response = { embeds: [embed] };
            if (attachment) {
                response.files = [attachment];
            }
            
            await interaction.editReply(response);
            
            console.log(`✅ [WHOXY] Successfully completed ${requestType} analysis`);
            
        } catch (error) {
            console.error(`❌ [WHOXY] Error during ${requestType} analysis:`, error.message);
            await handleWhoxyError(interaction, error, requestType);
        }
    },
};

/**
 * Perform account balance check
 * @param {string} apiKey - Whoxy API key
 * @returns {Promise<Object>} Balance analysis data
 */
async function performBalanceCheck(apiKey) {
    const response = await axios.get(`https://api.whoxy.com/?key=${apiKey}&account=balance`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Discord-OSINT-Assistant/2.0' }
    });
    
    return {
        type: 'balance',
        data: response.data,
        timestamp: new Date().toISOString(),
        success: true
    };
}

/**
 * Perform WHOIS history analysis
 * @param {string} domain - Domain to analyze
 * @param {string} apiKey - Whoxy API key
 * @param {boolean} detailed - Include detailed analysis
 * @param {boolean} privacyMode - Redact sensitive information
 * @returns {Promise<Object>} History analysis data
 */
async function performHistoryAnalysis(domain, apiKey, detailed, privacyMode) {
    // Validate domain format
    if (!isValidDomain(domain)) {
        throw new Error('Invalid domain format. Please provide a valid domain name.');
    }
    
    const response = await axios.get(`https://api.whoxy.com/?key=${apiKey}&history=${domain}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Discord-OSINT-Assistant/2.0' }
    });
    
    const data = response.data;
    let processedData = data;
    
    // Apply privacy mode if requested
    if (privacyMode && data.whois_records) {
        processedData = {
            ...data,
            whois_records: data.whois_records.map(record => redactSensitiveInfo(record))
        };
    }
    
    // Perform detailed analysis if requested
    let analysis = null;
    if (detailed && data.whois_records && data.whois_records.length > 0) {
        analysis = analyzeWHOISHistory(data.whois_records);
    }
    
    return {
        type: 'history',
        domain: domain,
        data: processedData,
        analysis: analysis,
        recordCount: data.whois_records ? data.whois_records.length : 0,
        timestamp: new Date().toISOString(),
        success: data.status === 1 || data.status === '1'
    };
}

/**
 * Perform reverse WHOIS analysis
 * @param {string} identifier - Search field type
 * @param {string} searchValue - Value to search for
 * @param {string} apiKey - Whoxy API key
 * @param {boolean} detailed - Include detailed analysis
 * @param {boolean} privacyMode - Redact sensitive information
 * @returns {Promise<Object>} Reverse analysis data
 */
async function performReverseAnalysis(identifier, searchValue, apiKey, detailed, privacyMode) {
    // Validate search value based on identifier type
    if (identifier === 'email' && !isValidEmail(searchValue)) {
        throw new Error('Invalid email format for email search.');
    }
    
    const encodedValue = encodeURIComponent(searchValue);
    const response = await axios.get(`https://api.whoxy.com/?key=${apiKey}&reverse=whois&${identifier}=${encodedValue}`, {
        timeout: 20000,
        headers: { 'User-Agent': 'Discord-OSINT-Assistant/2.0' }
    });
    
    const data = response.data;
    let processedData = data;
    
    // Apply privacy mode if requested
    if (privacyMode && data.search_result) {
        processedData = {
            ...data,
            search_result: data.search_result.map(result => redactSensitiveInfo(result))
        };
    }
    
    // Perform detailed analysis if requested
    let analysis = null;
    if (detailed && data.search_result && data.search_result.length > 0) {
        analysis = analyzeReverseResults(data.search_result, identifier, searchValue);
    }
    
    return {
        type: 'reverse',
        identifier: identifier,
        searchValue: searchValue,
        data: processedData,
        analysis: analysis,
        resultCount: data.search_result ? data.search_result.length : 0,
        timestamp: new Date().toISOString(),
        success: data.status === 1 || data.status === '1'
    };
}

/**
 * Redact sensitive information from WHOIS records
 * @param {Object} record - WHOIS record to redact
 * @returns {Object} Redacted record
 */
function redactSensitiveInfo(record) {
    const sensitiveFields = [
        'registrant_contact_phone', 'admin_contact_phone', 'tech_contact_phone',
        'registrant_contact_street1', 'admin_contact_street1', 'tech_contact_street1',
        'registrant_contact_postal_code', 'admin_contact_postal_code', 'tech_contact_postal_code'
    ];
    
    const redacted = { ...record };
    
    sensitiveFields.forEach(field => {
        if (redacted[field]) {
            redacted[field] = '[REDACTED]';
        }
    });
    
    return redacted;
}

/**
 * Analyze WHOIS history for patterns and changes
 * @param {Array} records - WHOIS history records
 * @returns {Object} Analysis results
 */
function analyzeWHOISHistory(records) {
    const analysis = {
        totalRecords: records.length,
        dateRange: null,
        registrantChanges: 0,
        emailChanges: 0,
        nameserverChanges: 0,
        patterns: [],
        timeline: []
    };
    
    if (records.length === 0) return analysis;
    
    // Sort records by date
    const sortedRecords = records.sort((a, b) => 
        new Date(a.create_date || a.date_created || 0) - new Date(b.create_date || b.date_created || 0)
    );
    
    // Determine date range
    const firstRecord = sortedRecords[0];
    const lastRecord = sortedRecords[sortedRecords.length - 1];
    analysis.dateRange = {
        start: firstRecord.create_date || firstRecord.date_created,
        end: lastRecord.create_date || lastRecord.date_created
    };
    
    // Track changes
    let previousRecord = null;
    
    sortedRecords.forEach((record, index) => {
        if (previousRecord) {
            // Check for registrant changes
            if (record.registrant_contact_email !== previousRecord.registrant_contact_email) {
                analysis.emailChanges++;
            }
            
            if (record.registrant_contact_name !== previousRecord.registrant_contact_name) {
                analysis.registrantChanges++;
            }
            
            // Check for nameserver changes
            if (JSON.stringify(record.name_servers) !== JSON.stringify(previousRecord.name_servers)) {
                analysis.nameserverChanges++;
            }
        }
        
        // Build timeline entry
        analysis.timeline.push({
            date: record.create_date || record.date_created,
            registrant: record.registrant_contact_name,
            email: record.registrant_contact_email,
            nameservers: record.name_servers || []
        });
        
        previousRecord = record;
    });
    
    // Identify patterns
    if (analysis.emailChanges > 3) {
        analysis.patterns.push('High email change frequency (potential ownership transfers)');
    }
    
    if (analysis.registrantChanges > 2) {
        analysis.patterns.push('Multiple registrant changes detected');
    }
    
    if (analysis.nameserverChanges > 5) {
        analysis.patterns.push('Frequent nameserver changes (possible hosting migrations)');
    }
    
    return analysis;
}

/**
 * Analyze reverse WHOIS results for patterns
 * @param {Array} results - Reverse search results
 * @param {string} identifier - Search identifier type
 * @param {string} searchValue - Search value
 * @returns {Object} Analysis results
 */
function analyzeReverseResults(results, identifier, searchValue) {
    const analysis = {
        totalDomains: results.length,
        domainTypes: {},
        creationYears: {},
        patterns: [],
        riskFactors: []
    };
    
    results.forEach(result => {
        // Analyze domain extensions
        const extension = result.domain_name ? result.domain_name.split('.').pop().toLowerCase() : 'unknown';
        analysis.domainTypes[extension] = (analysis.domainTypes[extension] || 0) + 1;
        
        // Analyze creation years
        if (result.create_date) {
            const year = new Date(result.create_date).getFullYear();
            analysis.creationYears[year] = (analysis.creationYears[year] || 0) + 1;
        }
    });
    
    // Identify patterns
    if (analysis.totalDomains > 50) {
        analysis.patterns.push('High domain ownership count');
        analysis.riskFactors.push('Potentially bulk domain registration');
    }
    
    const recentDomains = results.filter(r => {
        const createDate = new Date(r.create_date);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        return createDate > oneYearAgo;
    }).length;
    
    if (recentDomains > 10) {
        analysis.patterns.push('High recent domain registration activity');
    }
    
    return analysis;
}

/**
 * Create Discord embed for WHOIS results
 * @param {Object} data - Analysis data
 * @param {string} type - Request type
 * @returns {EmbedBuilder} Discord embed
 */
function createWhoxyEmbed(data, type) {
    const embed = new EmbedBuilder()
        .setTitle('🔍 Whoxy WHOIS Analysis')
        .setColor(data.success ? 0x00d4aa : 0xff6b35)
        .setTimestamp()
        .setFooter({ text: 'Discord OSINT Assistant - Whoxy Analysis' });
    
    switch (type) {
        case 'balance':
            embed.setDescription('Account balance and API usage information');
            if (data.data.available_credits !== undefined) {
                embed.addFields({
                    name: '💰 Account Status',
                    value: `**Available Credits:** ${data.data.available_credits}\n` +
                           `**Total Queries:** ${data.data.total_queries || 'N/A'}\n` +
                           `**Account Type:** ${data.data.account_type || 'Standard'}`,
                    inline: false
                });
            }
            break;
            
        case 'history':
            embed.setDescription(`WHOIS history analysis for \`${data.domain}\``);
            embed.addFields({
                name: '📊 History Summary',
                value: `**Records Found:** ${data.recordCount}\n` +
                       `**Analysis Status:** ${data.success ? 'Success' : 'Failed'}\n` +
                       `**Domain:** ${data.domain}`,
                inline: true
            });
            
            if (data.analysis) {
                embed.addFields({
                    name: '📈 Change Analysis',
                    value: `**Registrant Changes:** ${data.analysis.registrantChanges}\n` +
                           `**Email Changes:** ${data.analysis.emailChanges}\n` +
                           `**Nameserver Changes:** ${data.analysis.nameserverChanges}`,
                    inline: true
                });
                
                if (data.analysis.patterns.length > 0) {
                    embed.addFields({
                        name: '🔍 Detected Patterns',
                        value: data.analysis.patterns.slice(0, 3).join('\n'),
                        inline: false
                    });
                }
            }
            break;
            
        case 'reverse':
            embed.setDescription(`Reverse WHOIS search results for ${data.identifier}: \`${data.searchValue}\``);
            embed.addFields({
                name: '📊 Search Results',
                value: `**Domains Found:** ${data.resultCount}\n` +
                       `**Search Type:** ${data.identifier}\n` +
                       `**Search Value:** ${data.searchValue}`,
                inline: true
            });
            
            if (data.analysis) {
                const topExtensions = Object.entries(data.analysis.domainTypes)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([ext, count]) => `.${ext} (${count})`)
                    .join(', ');
                
                embed.addFields({
                    name: '📈 Domain Analysis',
                    value: `**Total Domains:** ${data.analysis.totalDomains}\n` +
                           `**Top Extensions:** ${topExtensions || 'N/A'}\n` +
                           `**Risk Factors:** ${data.analysis.riskFactors.length}`,
                    inline: true
                });
                
                if (data.analysis.patterns.length > 0) {
                    embed.addFields({
                        name: '🔍 Ownership Patterns',
                        value: data.analysis.patterns.slice(0, 3).join('\n'),
                        inline: false
                    });
                }
            }
            break;
    }
    
    return embed;
}

/**
 * Create detailed analysis report
 * @param {Object} data - Analysis data
 * @param {string} type - Request type
 * @returns {Promise<AttachmentBuilder>} Discord attachment
 */
async function createDetailedReport(data, type) {
    let report = `# Whoxy ${type.toUpperCase()} Analysis Report\n`;
    report += `# Generated: ${data.timestamp}\n`;
    report += `# Analysis Type: ${type}\n\n`;
    
    if (type === 'balance') {
        report += `## Account Information\n`;
        report += `Available Credits: ${data.data.available_credits || 'N/A'}\n`;
        report += `Total Queries: ${data.data.total_queries || 'N/A'}\n`;
        report += `Account Type: ${data.data.account_type || 'N/A'}\n\n`;
        
    } else if (type === 'history') {
        report += `## Domain: ${data.domain}\n`;
        report += `Records Found: ${data.recordCount}\n\n`;
        
        if (data.analysis && data.analysis.timeline) {
            report += `## Timeline Analysis\n`;
            data.analysis.timeline.forEach((entry, index) => {
                report += `### Record ${index + 1}\n`;
                report += `Date: ${entry.date}\n`;
                report += `Registrant: ${entry.registrant || 'N/A'}\n`;
                report += `Email: ${entry.email || 'N/A'}\n`;
                report += `Nameservers: ${entry.nameservers.join(', ') || 'N/A'}\n\n`;
            });
        }
        
    } else if (type === 'reverse') {
        report += `## Search Parameters\n`;
        report += `Search Type: ${data.identifier}\n`;
        report += `Search Value: ${data.searchValue}\n`;
        report += `Results Found: ${data.resultCount}\n\n`;
        
        if (data.data.search_result) {
            report += `## Domain Results\n`;
            data.data.search_result.forEach((result, index) => {
                report += `${index + 1}. ${result.domain_name}\n`;
                if (result.create_date) {
                    report += `   Created: ${result.create_date}\n`;
                }
                if (result.registrar_name) {
                    report += `   Registrar: ${result.registrar_name}\n`;
                }
                report += `\n`;
            });
        }
    }
    
    // Add raw data
    report += `## Raw Data\n`;
    report += '```json\n';
    report += JSON.stringify(data.data, null, 2);
    report += '\n```\n';
    
    report += `\n## Disclaimer\n`;
    report += `This analysis is based on publicly available WHOIS data.\n`;
    report += `Information should be verified through multiple sources.\n`;
    report += `Generated by Discord OSINT Assistant v2.0\n`;
    
    return new AttachmentBuilder(
        Buffer.from(report, 'utf8'),
        { name: `whoxy_${type}_${Date.now()}.txt` }
    );
}

/**
 * Handle Whoxy API errors
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Error} error - The error that occurred
 * @param {string} requestType - Type of request that failed
 */
async function handleWhoxyError(interaction, error, requestType) {
    let errorMessage = `❌ **Whoxy ${requestType.charAt(0).toUpperCase() + requestType.slice(1)} Failed**\n\n`;
    
    if (error.response) {
        const status = error.response.status;
        
        switch (status) {
            case 401:
            case 403:
                errorMessage += '**🔑 Authentication Error**\n';
                errorMessage += 'Invalid API key or unauthorized access. Please check configuration.';
                break;
            case 429:
                errorMessage += '**🚦 Rate Limit Exceeded**\n';
                errorMessage += 'Whoxy API rate limit reached. Please wait before trying again.';
                break;
            case 404:
                errorMessage += '**🔍 Not Found**\n';
                errorMessage += 'The requested domain or search criteria returned no results.';
                break;
            case 500:
            case 502:
            case 503:
                errorMessage += '**🛠️ Service Unavailable**\n';
                errorMessage += 'Whoxy API is temporarily unavailable. Please try again later.';
                break;
            default:
                errorMessage += `**🚨 API Error (${status})**\n`;
                errorMessage += `${error.response.statusText || 'Unknown error occurred'}`;
        }
        
    } else if (error.code === 'ECONNABORTED') {
        errorMessage += '**⏱️ Timeout Error**\n';
        errorMessage += 'The request timed out. Whoxy API may be experiencing high load.';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage += '**🌐 Network Error**\n';
        errorMessage += 'Cannot connect to Whoxy API. Please check your internet connection.';
    } else {
        errorMessage += '**🚨 Unexpected Error**\n';
        errorMessage += `${error.message}`;
    }
    
    await interaction.editReply({
        content: errorMessage,
        ephemeral: false
    });
}
