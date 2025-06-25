/**
 * File: redirect-chain-enhanced.js
 * Description: Advanced URL redirect chain analysis for digital forensics and security research
 * Author: gl0bal01
 * 
 * This command provides comprehensive analysis of URL redirect chains, enabling investigators
 * to trace malicious redirects, identify tracking mechanisms, analyze security vulnerabilities,
 * and understand web traffic routing patterns. Essential for phishing investigations, malware
 * analysis, and digital forensics operations.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const tls = require('tls');

// Cache for historical comparison
const redirectCache = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-redirect-check')
        .setDescription('Check URL redirects with advanced security analysis')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to check for redirects')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('json')
                .setDescription('Output in JSON format')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('headers')
                .setDescription('Include full response headers in the analysis')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('timeout')
                .setDescription('Request timeout in seconds (default: 10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30))
        .addBooleanOption(option =>
            option.setName('deep')
                .setDescription('Perform deep analysis including content scanning')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('export')
                .setDescription('Export format (csv, mermaid)')
                .setRequired(false)
                .addChoices(
                    { name: 'CSV', value: 'csv' },
                    { name: 'Mermaid Diagram', value: 'mermaid' }
                )),

    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            const url = interaction.options.getString('url');
            const jsonOutput = interaction.options.getBoolean('json') || false;
            const includeHeaders = interaction.options.getBoolean('headers') || true;
            const timeout = (interaction.options.getInteger('timeout') || 10) * 1000;
            const deepAnalysis = interaction.options.getBoolean('deep') || true;
            const exportFormat = interaction.options.getString('export');
            
            // Validate URL format
            if (!isValidUrl(url)) {
                return interaction.editReply('Please provide a valid URL starting with http:// or https://');
            }

            await interaction.editReply(`🔍 Analyzing redirect chain for: ${url}\nThis may take a moment...`);
            
            // Analyze the redirect chain
            const result = await analyzeRedirectChain(url, includeHeaders, timeout, deepAnalysis);
            
            // Perform security analysis
            const securityAnalysis = await performSecurityAnalysis(result);
            
            // Compare with historical data
            const historicalComparison = compareWithHistory(url, result);
            
            // Handle export formats
            if (exportFormat) {
                const tempDir = path.join(__dirname, '..', 'temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const randomId = crypto.randomBytes(4).toString('hex');
                let filePath, content, fileName;
                
                if (exportFormat === 'csv') {
                    content = generateCSVReport(result);
                    fileName = 'redirect_analysis.csv';
                    filePath = path.join(tempDir, `redirects_${randomId}.csv`);
                } else if (exportFormat === 'mermaid') {
                    content = generateMermaidDiagram(result);
                    fileName = 'redirect_diagram.mmd';
                    filePath = path.join(tempDir, `redirects_${randomId}.mmd`);
                }
                
                fs.writeFileSync(filePath, content);
                const attachment = new AttachmentBuilder(filePath, { name: fileName });
                
                await interaction.editReply({
                    content: `📊 Export complete for: ${url}`,
                    files: [attachment]
                });
                
                setTimeout(() => {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (error) {
                        console.error('Error cleaning up temp file:', error);
                    }
                }, 5000);
                
                return;
            }
            
            // If JSON output is requested
            if (jsonOutput) {
                const fullResult = {
                    ...result,
                    security_analysis: securityAnalysis,
                    historical_comparison: historicalComparison,
                    timestamp: new Date().toISOString()
                };
                
                const tempDir = path.join(__dirname, '..', 'temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const randomId = crypto.randomBytes(4).toString('hex');
                const filePath = path.join(tempDir, `redirects_${randomId}.json`);
                
                fs.writeFileSync(filePath, JSON.stringify(fullResult, null, 2));
                
                const attachment = new AttachmentBuilder(filePath, { 
                    name: 'redirect_analysis.json'
                });
                
                await interaction.editReply({
                    content: `✅ Redirect analysis complete for: ${url}`,
                    files: [attachment]
                });
                
                setTimeout(() => {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (error) {
                        console.error('Error cleaning up temp file:', error);
                    }
                }, 5000);
                
                return;
            }
            
            // Create embeds for the response
            const embeds = [];
            
            // Main analysis embed
            const mainEmbed = createMainEmbed(result, securityAnalysis);
            embeds.push(mainEmbed);
            
            // Security analysis embed if issues found
            if (securityAnalysis.suspiciousIndicators.length > 0 || 
                securityAnalysis.trackingInfo.parameters.length > 0) {
                const securityEmbed = createSecurityEmbed(securityAnalysis);
                embeds.push(securityEmbed);
            }
            
            // Historical comparison embed if changes detected
            if (historicalComparison.changed) {
                const historyEmbed = createHistoryEmbed(historicalComparison);
                embeds.push(historyEmbed);
            }
            
            // Send the embeds
            await interaction.editReply({ embeds: embeds });
            
            // Send webhook notification if suspicious
            if (securityAnalysis.suspiciousIndicators.length > 0) {
                await notifyWebhook(url, result, securityAnalysis.suspiciousIndicators);
            }
            
        } catch (error) {
            console.error('Error in redirect-chain command:', error);
            await interaction.editReply(`❌ Error: ${error.message}`);
        }
    },
};

/**
 * Create main analysis embed
 */
function createMainEmbed(result, securityAnalysis) {
    const redirectCount = result.redirect_chain.length;
    const riskLevel = calculateRiskLevel(result, securityAnalysis);
    const embedColor = riskLevel === 'high' ? 0xFF0000 : 
                      riskLevel === 'medium' ? 0xFFA500 : 0x00FF00;
    
    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('🔗 URL Redirect Analysis')
        .setDescription(`Analysis for: \`${result.initial_url}\``)
        .addFields({ 
            name: '📊 Summary', 
            value: `• **Total redirects:** ${redirectCount}\n` +
                   `• **Risk level:** ${riskLevel.toUpperCase()}\n` +
                   `• **Final status:** ${result.final_destination.status}\n` +
                   `• **Response time:** ${result.total_time_ms}ms\n` +
                   `• **HTTPS upgrade:** ${result.httpsUpgrade ? '✅ Yes' : '❌ No'}`
        });
    
    // Add redirect chain
    if (redirectCount > 0) {
        let redirectText = '';
        result.redirect_chain.forEach((redirect, index) => {
            const icon = redirect.status.startsWith('3') ? '↪️' : '⚠️';
            redirectText += `${icon} **${index + 1}.** \`${redirect.status}\` `;
            
            // Truncate long URLs
            const displayUrl = redirect.url.length > 50 ? 
                redirect.url.substring(0, 47) + '...' : redirect.url;
            redirectText += `${displayUrl}\n`;
            
            if (redirect.time_ms) {
                redirectText += `   ⏱️ ${redirect.time_ms}ms`;
            }
            
            if (redirect.server) {
                redirectText += ` | 🖥️ ${redirect.server}`;
            }
            
            redirectText += '\n';
        });
        
        embed.addFields({ 
            name: '🔀 Redirect Chain', 
            value: redirectText.trim() 
        });
    }
    
    // Add final destination
    const finalDest = result.final_destination;
    let finalDestText = `${finalDest.status.startsWith('2') ? '✅' : '❌'} \`${finalDest.status}\` ${finalDest.url}\n`;
    
    if (finalDest.time_ms) {
        finalDestText += `⏱️ Response time: ${finalDest.time_ms}ms\n`;
    }
    
    if (finalDest.server) {
        finalDestText += `🖥️ Server: ${finalDest.server}\n`;
    }
    
    if (finalDest.contentType) {
        finalDestText += `📄 Content: ${finalDest.contentType}\n`;
    }
    
    if (result.dnsInfo) {
        finalDestText += `🌐 IP: ${result.dnsInfo.addresses.join(', ')}\n`;
    }
    
    embed.addFields({ 
        name: '🎯 Final Destination', 
        value: finalDestText 
    });
    
    // Add timestamp
    embed.setTimestamp();
    
    return embed;
}

/**
 * Create security analysis embed
 */
function createSecurityEmbed(securityAnalysis) {
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔒 Security Analysis')
        .setDescription('Potential security concerns detected');
    
    // Suspicious indicators
    if (securityAnalysis.suspiciousIndicators.length > 0) {
        embed.addFields({
            name: '⚠️ Suspicious Indicators',
            value: securityAnalysis.suspiciousIndicators.map(i => `• ${i}`).join('\n')
        });
    }
    
    // Tracking parameters
    if (securityAnalysis.trackingInfo.parameters.length > 0) {
        const trackingText = securityAnalysis.trackingInfo.parameters
            .slice(0, 10)
            .map(t => `• \`${t.param}\`: ${t.value.substring(0, 30)}...`)
            .join('\n');
        
        embed.addFields({
            name: '👁️ Tracking Parameters Detected',
            value: trackingText + 
                   (securityAnalysis.trackingInfo.parameters.length > 10 ? 
                    `\n... and ${securityAnalysis.trackingInfo.parameters.length - 10} more` : '')
        });
    }
    
    // Certificate info
    if (securityAnalysis.certificateInfo) {
        const cert = securityAnalysis.certificateInfo;
        embed.addFields({
            name: '🔐 SSL Certificate',
            value: `• **Issuer:** ${cert.issuer}\n` +
                   `• **Valid from:** ${cert.valid_from}\n` +
                   `• **Valid to:** ${cert.valid_to}\n` +
                   `• **Days remaining:** ${cert.daysRemaining}`
        });
    }
    
    // Content analysis
    if (securityAnalysis.contentAnalysis) {
        const content = securityAnalysis.contentAnalysis;
        let contentText = '';
        
        if (content.hasJavaScript) contentText += '• JavaScript detected\n';
        if (content.hasIframes) contentText += '• iFrames detected\n';
        if (content.suspiciousPatterns.length > 0) {
            contentText += `• Suspicious patterns: ${content.suspiciousPatterns.join(', ')}\n`;
        }
        if (content.externalResources.length > 0) {
            contentText += `• External resources: ${content.externalResources.length} found\n`;
        }
        
        if (contentText) {
            embed.addFields({
                name: '📄 Content Analysis',
                value: contentText
            });
        }
    }
    
    return embed;
}

/**
 * Create historical comparison embed
 */
function createHistoryEmbed(historicalComparison) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📈 Historical Changes Detected')
        .setDescription('This URL has changed since last analysis');
    
    const changesText = historicalComparison.differences
        .map(diff => {
            switch (diff.type) {
                case 'redirect_count':
                    return `• Redirect count: ${diff.old} → ${diff.new}`;
                case 'final_destination':
                    return `• Final destination changed:\n  Old: ${diff.old}\n  New: ${diff.new}`;
                case 'status_code':
                    return `• Status code: ${diff.old} → ${diff.new}`;
                default:
                    return `• ${diff.type}: Changed`;
            }
        })
        .join('\n');
    
    embed.addFields({
        name: '🔄 Changes',
        value: changesText
    });
    
    if (historicalComparison.lastChecked) {
        embed.addFields({
            name: '🕐 Last Checked',
            value: new Date(historicalComparison.lastChecked).toLocaleString()
        });
    }
    
    return embed;
}

/**
 * Calculate risk level based on analysis
 */
function calculateRiskLevel(result, securityAnalysis) {
    let riskScore = 0;
    
    // High risk indicators
    if (securityAnalysis.suspiciousIndicators.includes('URL shortener chain detected')) riskScore += 3;
    if (securityAnalysis.suspiciousIndicators.includes('Suspicious TLD detected')) riskScore += 3;
    if (securityAnalysis.suspiciousIndicators.includes('Mixed content (HTTPS → HTTP) detected')) riskScore += 3;
    if (securityAnalysis.suspiciousIndicators.includes('Internationalized domain name')) riskScore += 2;
    
    // Medium risk indicators
    if (result.redirect_chain.length > 5) riskScore += 2;
    if (securityAnalysis.trackingInfo.parameters.length > 5) riskScore += 1;
    if (!result.httpsUpgrade && result.initial_url.startsWith('http://')) riskScore += 1;
    
    // Determine risk level
    if (riskScore >= 5) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
}

/**
 * Check if a string is a valid URL
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return url.startsWith('http://') || url.startsWith('https://');
    } catch (e) {
        return false;
    }
}

/**
 * Analyze a URL's redirect chain with enhanced features
 */
async function analyzeRedirectChain(url, includeHeaders = false, timeout = 10000, deepAnalysis = false) {
    const startTime = Date.now();
    const redirectChain = [];
    let currentUrl = url;
    let finalDestination;
    let totalTime = 0;
    let httpsUpgrade = false;

    while (true) {
        try {
            const requestStartTime = Date.now();
            
            const response = await robustRequest(currentUrl, {
                maxRedirects: 0,
                validateStatus: null,
                timeout: timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const requestTime = Date.now() - requestStartTime;
            totalTime += requestTime;
            
            const status = response.status;
            
            // Check for HTTPS upgrade
            if (currentUrl.startsWith('http://') && response.headers.location?.startsWith('https://')) {
                httpsUpgrade = true;
            }
            
            // Prepare redirect info
            const redirectInfo = {
                status: status.toString(),
                url: currentUrl,
                time_ms: requestTime,
                server: response.headers.server || null,
                contentType: response.headers['content-type'] || null
            };
            
            if (includeHeaders) {
                redirectInfo.headers = response.headers;
            }
            
            if (status >= 300 && status < 400 && response.headers.location) {
                // It's a redirect
                const location = response.headers.location;
                const redirectUrl = new URL(location, currentUrl).href;
                redirectInfo.url = redirectUrl;
                
                redirectChain.push(redirectInfo);
                currentUrl = redirectUrl;
                
                // Safety check
                if (redirectChain.length > 10) {
                    throw new Error('Too many redirects (possible redirect loop)');
                }
            } else {
                // Final destination
                finalDestination = redirectInfo;
                
                // Deep analysis if requested
                if (deepAnalysis && status >= 200 && status < 300) {
                    finalDestination.contentAnalysis = await analyzeContent(currentUrl, response.headers);
                }
                
                break;
            }
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                finalDestination = {
                    status: status.toString(),
                    url: currentUrl,
                    time_ms: Date.now() - requestStartTime,
                    error: 'Request failed'
                };
                break;
            } else {
                throw error;
            }
        }
    }

    // Get DNS info for final destination
    let dnsInfo = null;
    try {
        const finalUrl = new URL(finalDestination.url);
        dnsInfo = await resolveDNS(finalUrl.hostname);
    } catch (error) {
        // DNS resolution failed, continue without it
    }

    return {
        initial_url: url,
        redirect_chain: redirectChain,
        final_destination: finalDestination,
        total_time_ms: totalTime,
        total_redirects: redirectChain.length,
        httpsUpgrade: httpsUpgrade,
        dnsInfo: dnsInfo
    };
}

/**
 * Robust request with retry logic
 */
async function robustRequest(url, options, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await axios.get(url, options);
        } catch (error) {
            lastError = error;
            
            // Don't retry on certain errors
            if (error.response?.status < 500 || error.code === 'ENOTFOUND') {
                throw error;
            }
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    
    throw lastError;
}

/**
 * Perform comprehensive security analysis
 */
async function performSecurityAnalysis(result) {
    const analysis = {
        suspiciousIndicators: [],
        trackingInfo: { parameters: [] },
        certificateInfo: null,
        contentAnalysis: result.final_destination.contentAnalysis || null
    };
    
    // Detect suspicious patterns
    analysis.suspiciousIndicators = detectSuspiciousPatterns(result);
    
    // Detect tracking
    analysis.trackingInfo = detectAdvancedTracking(result.initial_url);
    result.redirect_chain.forEach(redirect => {
        const tracking = detectAdvancedTracking(redirect.url);
        analysis.trackingInfo.parameters.push(...tracking.parameters);
    });
    
    // Get certificate info for HTTPS URLs
    if (result.final_destination.url.startsWith('https://')) {
        try {
            analysis.certificateInfo = await analyzeCertificate(result.final_destination.url);
        } catch (error) {
            // Certificate analysis failed
        }
    }
    
    // Check for mixed content
    if (detectMixedContent(result)) {
        analysis.suspiciousIndicators.push('Mixed content (HTTPS → HTTP) detected');
    }
    
    return analysis;
}

/**
 * Detect suspicious redirect patterns
 */
function detectSuspiciousPatterns(result) {
    const suspiciousIndicators = [];
    
    // URL shortener chains
    const shorteners = ['bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 't.co', 'short.link', 'tiny.cc'];
    const shortenerCount = result.redirect_chain.filter(r => 
        shorteners.some(s => r.url.includes(s))
    ).length;
    
    if (shortenerCount > 1) {
        suspiciousIndicators.push('URL shortener chain detected');
    } else if (shortenerCount === 1) {
        suspiciousIndicators.push('URL shortener detected');
    }
    
    // Suspicious TLDs
    const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.click', '.download'];
    if (result.redirect_chain.some(r => suspiciousTLDs.some(tld => r.url.includes(tld)))) {
        suspiciousIndicators.push('Suspicious TLD detected');
    }
    
    // IDN homograph
    if (result.redirect_chain.some(r => r.url.includes('xn--'))) {
        suspiciousIndicators.push('Internationalized domain name (possible homograph attack)');
    }
    
    // Excessive redirects
    if (result.total_redirects > 5) {
        suspiciousIndicators.push(`Excessive redirects (${result.total_redirects})`);
    }
    
    // Non-standard ports
    const nonStandardPorts = result.redirect_chain.some(r => {
        const url = new URL(r.url);
        return url.port && url.port !== '80' && url.port !== '443';
    });
    
    if (nonStandardPorts) {
        suspiciousIndicators.push('Non-standard port detected');
    }
    
    return suspiciousIndicators;
}

/**
 * Detect mixed content in redirect chain
 */
function detectMixedContent(result) {
    let foundHttps = false;
    
    if (result.initial_url.startsWith('https://')) {
        foundHttps = true;
    }
    
    for (const redirect of result.redirect_chain) {
        if (redirect.url.startsWith('https://')) {
            foundHttps = true;
        } else if (foundHttps && redirect.url.startsWith('http://')) {
            return true;
        }
    }
    
    if (foundHttps && result.final_destination.url.startsWith('http://')) {
        return true;
    }
    
    return false;
}

/**
 * Advanced tracking parameter detection
 */
function detectAdvancedTracking(url) {
    const trackingInfo = {
        parameters: [],
        pixels: [],
        fingerprinting: false
    };
    
    const expandedTrackingParams = [
        // Marketing
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid',
        // Analytics
        '_ga', '_gid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi',
        // Social
        '__twitter_impression', 'fb_action_ids', 'fb_action_types', 'twclid',
        // E-commerce
        'affiliate', 'partner', 'ref', 'referrer', 'source', 'campaign',
        // Email
        'mkt_tok', 'trk', 'trkInfo', 'eid', 'mid',
        // Adobe
        's_kwcid', 'ef_id', 'adobe_mc',
        // Other
        'pk_campaign', 'pk_source', 'pk_medium', 'piwik_campaign'
    ];
    
    try {
        const urlObj = new URL(url);
        for (const [key, value] of urlObj.searchParams) {
            const lowerKey = key.toLowerCase();
            if (expandedTrackingParams.some(param => lowerKey.includes(param))) {
                trackingInfo.parameters.push({ 
                    param: key, 
                    value: value.substring(0, 50) // Truncate long values
                });
            }
        }
    } catch (error) {
        // Invalid URL
    }
    
    return trackingInfo;
}

/**
 * Analyze SSL certificate
 */
async function analyzeCertificate(url) {
    return new Promise((resolve, reject) => {
        try {
            const { hostname } = new URL(url);
            const options = {
                host: hostname,
                port: 443,
                servername: hostname,
                rejectUnauthorized: false
            };
            
            const socket = tls.connect(options, () => {
                const cert = socket.getPeerCertificate();
                
                if (!cert || !cert.subject) {
                    socket.end();
                    reject(new Error('No certificate found'));
                    return;
                }
                
                const validFrom = new Date(cert.valid_from);
                const validTo = new Date(cert.valid_to);
                const now = new Date();
                const daysRemaining = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
                
                const certInfo = {
                    subject: cert.subject.CN || cert.subject.O || 'Unknown',
                    issuer: cert.issuer.CN || cert.issuer.O || 'Unknown',
                    valid_from: validFrom.toISOString(),
                    valid_to: validTo.toISOString(),
                    daysRemaining: daysRemaining,
                    fingerprint: cert.fingerprint,
                    serialNumber: cert.serialNumber
                };
                
                socket.end();
                resolve(certInfo);
            });
            
            socket.on('error', (error) => {
                reject(error);
            });
            
            socket.setTimeout(5000, () => {
                socket.end();
                reject(new Error('Certificate check timeout'));
            });
            
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Analyze content for security issues
 */
async function analyzeContent(url, headers) {
    const contentAnalysis = {
        hasJavaScript: false,
        hasIframes: false,
        externalResources: [],
        suspiciousPatterns: []
    };
    
    if (!headers['content-type']?.includes('text/html')) {
        return contentAnalysis;
    }
    
    try {
        const response = await axios.get(url, {
            maxRedirects: 0,
            timeout: 5000,
            responseType: 'text',
            maxContentLength: 1024 * 1024, // 1MB limit
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const html = response.data;
        
        // Check for JavaScript
        contentAnalysis.hasJavaScript = /<script/i.test(html);
        
        // Check for iframes
        contentAnalysis.hasIframes = /<iframe/i.test(html);
        
        // Extract external resources
        const resourceMatches = html.match(/(?:src|href)=["']([^"']+)["']/gi) || [];
        const uniqueResources = new Set();
        
        resourceMatches.forEach(match => {
            const urlMatch = match.match(/["']([^"']+)["']/);
            if (urlMatch && urlMatch[1].startsWith('http')) {
                uniqueResources.add(urlMatch[1]);
            }
        });
        
        contentAnalysis.externalResources = Array.from(uniqueResources).slice(0, 20);
        
        // Check for obfuscation
        if (/eval\s*\(|unescape\s*\(|String\.fromCharCode|atob\s*\(/i.test(html)) {
            contentAnalysis.suspiciousPatterns.push('JavaScript obfuscation');
        }
        
        // Check for suspicious redirects
        if (/window\.location|meta\s+http-equiv=["']refresh/i.test(html)) {
            contentAnalysis.suspiciousPatterns.push('Client-side redirect');
        }
        
        // Check for hidden elements
        if (/display:\s*none|visibility:\s*hidden|opacity:\s*0/i.test(html)) {
            contentAnalysis.suspiciousPatterns.push('Hidden elements');
        }
        
    } catch (error) {
        // Content analysis failed
    }
    
    return contentAnalysis;
}

/**
 * Resolve DNS information
 */
async function resolveDNS(hostname) {
    try {
        const addresses = await dns.resolve4(hostname);
        const reverses = await Promise.all(
            addresses.map(addr => dns.reverse(addr).catch(() => null))
        );
        
        return {
            addresses,
            reverses: reverses.filter(Boolean).flat()
        };
    } catch (error) {
        return null;
    }
}

/**
 * Compare with historical data
 */
function compareWithHistory(url, currentResult) {
    const comparison = {
        changed: false,
        differences: [],
        lastChecked: null
    };
    
    const cacheKey = crypto.createHash('md5').update(url).digest('hex');
    const historicalData = redirectCache.get(cacheKey);
    
    if (historicalData) {
        comparison.lastChecked = historicalData.timestamp;
        
        // Compare redirect counts
        if (historicalData.total_redirects !== currentResult.total_redirects) {
            comparison.changed = true;
            comparison.differences.push({
                type: 'redirect_count',
                old: historicalData.total_redirects,
                new: currentResult.total_redirects
            });
        }
        
        // Compare final destination
        if (historicalData.final_destination.url !== currentResult.final_destination.url) {
            comparison.changed = true;
            comparison.differences.push({
                type: 'final_destination',
                old: historicalData.final_destination.url,
                new: currentResult.final_destination.url
            });
        }
        
        // Compare status codes
        if (historicalData.final_destination.status !== currentResult.final_destination.status) {
            comparison.changed = true;
            comparison.differences.push({
                type: 'status_code',
                old: historicalData.final_destination.status,
                new: currentResult.final_destination.status
            });
        }
    }
    
    // Store current result
    redirectCache.set(cacheKey, {
        ...currentResult,
        timestamp: new Date().toISOString()
    });
    
    // Limit cache size
    if (redirectCache.size > 1000) {
        const firstKey = redirectCache.keys().next().value;
        redirectCache.delete(firstKey);
    }
    
    return comparison;
}

/**
 * Generate CSV report
 */
function generateCSVReport(result) {
    let csv = 'Step,Status,URL,Time(ms),Server,Content-Type,Notes\n';
    
    // Initial URL
    csv += `0,Initial,-,${result.initial_url},-,-,-\n`;
    
    // Redirect chain
    result.redirect_chain.forEach((redirect, index) => {
        const server = redirect.server || '-';
        const contentType = redirect.contentType || '-';
        const notes = redirect.status.startsWith('3') ? 'Redirect' : 'Non-redirect response';
        csv += `${index + 1},${redirect.status},${redirect.url},${redirect.time_ms || '-'},${server},${contentType},${notes}\n`;
    });
    
    // Final destination
    const finalServer = result.final_destination.server || '-';
    const finalContentType = result.final_destination.contentType || '-';
    const finalNotes = result.final_destination.error || 'Final destination';
    csv += `${result.redirect_chain.length + 1},${result.final_destination.status},${result.final_destination.url},${result.final_destination.time_ms || '-'},${finalServer},${finalContentType},${finalNotes}\n`;
    
    // Summary
    csv += '\nSummary\n';
    csv += `Total Redirects,${result.total_redirects}\n`;
    csv += `Total Time (ms),${result.total_time_ms}\n`;
    csv += `HTTPS Upgrade,${result.httpsUpgrade ? 'Yes' : 'No'}\n`;
    
    if (result.dnsInfo) {
        csv += `IP Addresses,"${result.dnsInfo.addresses.join(', ')}"\n`;
    }
    
    return csv;
}

/**
 * Generate Mermaid diagram
 */
function generateMermaidDiagram(result) {
    let mermaid = 'graph TD\n';
    let nodeId = 0;
    
    // Styling
    mermaid += '    classDef redirect fill:#FFA500,stroke:#FF6347,stroke-width:2px,color:#fff\n';
    mermaid += '    classDef success fill:#00FF00,stroke:#228B22,stroke-width:2px,color:#000\n';
    mermaid += '    classDef error fill:#FF0000,stroke:#8B0000,stroke-width:2px,color:#fff\n';
    mermaid += '    classDef initial fill:#87CEEB,stroke:#4682B4,stroke-width:2px,color:#000\n\n';
    
    // Initial URL
    const initialUrl = truncateUrl(result.initial_url, 40);
    mermaid += `    A["🌐 ${initialUrl}"]:::initial\n`;
    let prevNode = 'A';
    
    // Redirect chain
    result.redirect_chain.forEach((redirect, index) => {
        const currentNode = String.fromCharCode(66 + index); // B, C, D...
        const url = truncateUrl(redirect.url, 40);
        const nodeClass = redirect.status.startsWith('3') ? 'redirect' : 'error';
        
        mermaid += `    ${currentNode}["${url}"]:::${nodeClass}\n`;
        mermaid += `    ${prevNode} -->|"${redirect.status} (${redirect.time_ms}ms)"| ${currentNode}\n`;
        prevNode = currentNode;
    });
    
    // Final destination
    const finalNode = String.fromCharCode(66 + result.redirect_chain.length);
    const finalUrl = truncateUrl(result.final_destination.url, 40);
    const finalClass = result.final_destination.status.startsWith('2') ? 'success' : 'error';
    
    mermaid += `    ${finalNode}["🎯 ${finalUrl}"]:::${finalClass}\n`;
    if (result.redirect_chain.length > 0) {
        mermaid += `    ${prevNode} -->|"${result.final_destination.status} (${result.final_destination.time_ms}ms)"| ${finalNode}\n`;
    }
    
    // Add summary box
    mermaid += `\n    subgraph Summary\n`;
    mermaid += `        S1["Total redirects: ${result.total_redirects}"]\n`;
    mermaid += `        S2["Total time: ${result.total_time_ms}ms"]\n`;
    mermaid += `        S3["HTTPS upgrade: ${result.httpsUpgrade ? '✅' : '❌'}"]\n`;
    mermaid += `    end\n`;
    
    return mermaid;
}

/**
 * Truncate URL for display
 */
function truncateUrl(url, maxLength = 30) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const path = urlObj.pathname + urlObj.search;
        
        if (domain.length + path.length <= maxLength) {
            return domain + path;
        }
        
        if (domain.length > maxLength - 3) {
            return domain.substring(0, maxLength - 3) + '...';
        }
        
        const remainingLength = maxLength - domain.length - 3;
        return domain + path.substring(0, remainingLength) + '...';
    } catch (error) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }
}

/**
 * Send webhook notification for suspicious URLs
 */
async function notifyWebhook(url, result, suspiciousIndicators) {
    // Only send if webhook URL is configured
    if (!process.env.SECURITY_WEBHOOK_URL) return;
    
    try {
        const payload = {
            embeds: [{
                title: '⚠️ Suspicious URL Detected',
                color: 0xFF0000,
                fields: [
                    {
                        name: 'URL',
                        value: `\`${url}\``,
                        inline: false
                    },
                    {
                        name: 'Suspicious Indicators',
                        value: suspiciousIndicators.map(i => `• ${i}`).join('\n'),
                        inline: false
                    },
                    {
                        name: 'Redirect Count',
                        value: result.total_redirects.toString(),
                        inline: true
                    },
                    {
                        name: 'Final Destination',
                        value: `\`${truncateUrl(result.final_destination.url, 50)}\``,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        
        await axios.post(process.env.SECURITY_WEBHOOK_URL, payload);
    } catch (error) {
        console.error('Failed to send webhook notification:', error);
    }
}

// Clean up old cache entries periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, value] of redirectCache.entries()) {
        const timestamp = new Date(value.timestamp).getTime();
        if (now - timestamp > maxAge) {
            redirectCache.delete(key);
        }
    }
}, 60 * 60 * 1000); // Run every hour