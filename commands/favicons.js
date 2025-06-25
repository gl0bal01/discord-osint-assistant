/**
 * Favicon Hash Discord Bot Command
 * ================================
 * 
 * A comprehensive Discord slash command for extracting website favicons and generating
 * Shodan-compatible hash searches for reconnaissance and asset discovery.
 * 
 * Features:
 * - Smart favicon detection with multiple fallback strategies
 * - Shodan MurmurHash3 calculation for favicon fingerprinting
 * - Multiple hash formats (MD5, SHA1, SHA256) for cross-platform compatibility
 * - Censys and Shodan search URL generation
 * - Raw JSON data export with comprehensive metadata
 * - Intelligent content-type detection and validation
 * - Robust error handling and timeout management
 * - Automatic temporary file cleanup
 * 
 * Use Cases:
 * - OSINT (Open Source Intelligence) gathering
 * - Asset discovery and enumeration
 * - Finding similar websites or infrastructure
 * - Security research and reconnaissance
 * - Brand monitoring and trademark analysis
 * 
 * Security Features:
 * - URL validation and sanitization
 * - Content-type verification
 * - File size limits and timeout controls
 * - Secure temporary file handling
 * - Input validation and error boundaries
 * 
 * Supported Search Platforms:
 * - Shodan (Internet-connected device search engine)
 * - Censys (Internet-wide scanning platform)
 * - Custom hash exports for other platforms
 * 
 * Technical Details:
 * - Uses MurmurHash3 algorithm (same as Shodan)
 * - Supports multiple favicon formats (ICO, PNG, SVG, etc.)
 * - Handles both absolute and relative favicon URLs
 * - Progressive favicon discovery with quality preference
 * 
 * Author: gl0bal01
 * Version: 2.0
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const crypto = require('crypto');
const murmurhash = require('murmurhash');

// Configuration constants
const CONFIG = {
    REQUEST_TIMEOUT: parseInt(process.env.FAVICON_TIMEOUT) || 15000, // 15 seconds
    FAVICON_TIMEOUT: parseInt(process.env.FAVICON_DL_TIMEOUT) || 10000, // 10 seconds
    MAX_FILE_SIZE: parseInt(process.env.MAX_FAVICON_SIZE) || 5 * 1024 * 1024, // 5MB
    CLEANUP_DELAY: parseInt(process.env.CLEANUP_DELAY) || 30000, // 30 seconds
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    TEMP_PREFIX: 'favicon-analysis'
};

// Favicon discovery selectors in order of preference
const FAVICON_SELECTORS = [
    // High-resolution and modern formats first
    'link[rel="icon"][type="image/svg+xml"]',
    'link[rel="icon"][sizes*="192"]',
    'link[rel="icon"][sizes*="180"]',
    'link[rel="icon"][sizes*="152"]',
    'link[rel="icon"][sizes*="144"]',
    'link[rel="icon"][sizes*="120"]',
    'link[rel="icon"][sizes*="96"]',
    'link[rel="icon"][sizes*="72"]',
    'link[rel="icon"][sizes*="64"]',
    'link[rel="icon"][sizes*="48"]',
    'link[rel="icon"][sizes*="32"]',
    'link[rel="icon"][sizes*="16"]',
    // Generic favicon links
    'link[rel="shortcut icon"]',
    'link[rel="icon"]',
    // Apple touch icons (often high quality)
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel="apple-touch-icon"]',
    // Microsoft tile icons
    'meta[name="msapplication-TileImage"]',
    // Manifest icons
    'link[rel="manifest"]'
];

// Supported image MIME types
const SUPPORTED_IMAGE_TYPES = [
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/ico',
    'image/icon',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp'
];

/**
 * Validates and normalizes a URL
 * @param {string} urlString - The URL to validate
 * @returns {URL} - Parsed URL object
 * @throws {Error} - If URL is invalid
 */
const validateUrl = (urlString) => {
    try {
        const parsedUrl = new URL(urlString);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('URL must use HTTP or HTTPS protocol');
        }
        return parsedUrl;
    } catch (error) {
        throw new Error(`Invalid URL: ${error.message}`);
    }
};

/**
 * Creates a secure temporary directory
 * @returns {Promise<string>} - Path to temporary directory
 */
const createTempDirectory = async () => {
    const randomId = crypto.randomBytes(12).toString('hex');
    const tempDir = path.join(os.tmpdir(), `${CONFIG.TEMP_PREFIX}-${randomId}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
};

/**
 * Safely cleans up temporary directory and files
 * @param {string} tempDir - Path to temporary directory
 */
const cleanupTempDirectory = async (tempDir) => {
    if (!tempDir || !fsSync.existsSync(tempDir)) return;
    
    try {
        const files = await fs.readdir(tempDir);
        for (const file of files) {
            await fs.unlink(path.join(tempDir, file));
        }
        await fs.rmdir(tempDir);
        console.log(`Cleaned up temporary directory: ${tempDir}`);
    } catch (error) {
        console.error(`Error cleaning up temp directory ${tempDir}:`, error);
    }
};

/**
 * Extracts favicon URLs from HTML content
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {Array} - Array of favicon candidate objects
 */
const extractFaviconCandidates = (html, baseUrl) => {
    const $ = cheerio.load(html);
    const candidates = [];
    
    // Check each selector in order of preference
    for (const selector of FAVICON_SELECTORS) {
        const elements = $(selector);
        
        elements.each((index, element) => {
            const $el = $(element);
            let faviconUrl = null;
            
            // Handle different types of elements
            if ($el.is('link')) {
                faviconUrl = $el.attr('href');
            } else if ($el.is('meta') && $el.attr('name') === 'msapplication-TileImage') {
                faviconUrl = $el.attr('content');
            }
            
            if (faviconUrl) {
                try {
                    const absoluteUrl = new URL(faviconUrl, baseUrl).href;
                    
                    // Avoid duplicates
                    if (!candidates.find(c => c.url === absoluteUrl)) {
                        candidates.push({
                            url: absoluteUrl,
                            originalUrl: faviconUrl,
                            rel: $el.attr('rel') || 'meta',
                            sizes: $el.attr('sizes') || 'unknown',
                            type: $el.attr('type') || 'unknown',
                            priority: FAVICON_SELECTORS.indexOf(selector)
                        });
                    }
                } catch (urlError) {
                    console.warn(`Invalid favicon URL: ${faviconUrl}`);
                }
            }
        });
    }
    
    // Add default favicon.ico as fallback
    try {
        const defaultFaviconUrl = new URL('/favicon.ico', baseUrl).href;
        if (!candidates.find(c => c.url === defaultFaviconUrl)) {
            candidates.push({
                url: defaultFaviconUrl,
                originalUrl: '/favicon.ico',
                rel: 'default',
                sizes: 'unknown',
                type: 'image/x-icon',
                priority: 999 // Lowest priority
            });
        }
    } catch (error) {
        console.warn('Could not create default favicon URL');
    }
    
    // Sort by priority (lower number = higher priority)
    return candidates.sort((a, b) => a.priority - b.priority);
};

/**
 * Downloads and validates favicon data
 * @param {string} faviconUrl - URL of the favicon
 * @returns {Promise<Buffer>} - Favicon data buffer
 */
const downloadFavicon = async (faviconUrl) => {
    const response = await axios.get(faviconUrl, {
        responseType: 'arraybuffer',
        timeout: CONFIG.FAVICON_TIMEOUT,
        maxContentLength: CONFIG.MAX_FILE_SIZE,
        maxBodyLength: CONFIG.MAX_FILE_SIZE,
        headers: {
            'User-Agent': CONFIG.USER_AGENT,
            'Accept': 'image/*,*/*;q=0.8'
        },
        validateStatus: (status) => status >= 200 && status < 400
    });
    
    const contentType = response.headers['content-type'] || '';
    
    // Validate content type
    if (!SUPPORTED_IMAGE_TYPES.some(type => contentType.toLowerCase().includes(type.toLowerCase()))) {
        throw new Error(`Unsupported content type: ${contentType}`);
    }
    
    return {
        data: Buffer.from(response.data),
        contentType,
        size: response.data.length
    };
};

/**
 * Calculates various hashes for favicon data
 * @param {Buffer} faviconBuffer - Favicon data buffer
 * @returns {Object} - Object containing various hash values
 */
const calculateHashes = (faviconBuffer) => {
    const base64 = faviconBuffer.toString('base64');
    
    return {
        murmurhash3: murmurhash.v3(base64),
        md5: crypto.createHash('md5').update(faviconBuffer).digest('hex'),
        sha1: crypto.createHash('sha1').update(faviconBuffer).digest('hex'),
        sha256: crypto.createHash('sha256').update(faviconBuffer).digest('hex'),
        base64: base64
    };
};

/**
 * Generates search URLs for various platforms
 * @param {Object} hashes - Hash values object
 * @returns {Object} - Search URLs for different platforms
 */
const generateSearchUrls = (hashes) => {
    return {
        shodan: `https://www.shodan.io/search?query=http.favicon.hash%3A${hashes.murmurhash3}`,
        censys: `https://search.censys.io/search?resource=hosts&q=services.http.response.favicons.md5_hash%3D${hashes.md5}`,
        binaryedge: `https://app.binaryedge.io/services/query?query=web.favicon.mmh3%3A${hashes.murmurhash3}`,
        zoomeye: `https://www.zoomeye.org/searchResult?q=iconhash%3A%22${hashes.murmurhash3}%22`
    };
};

/**
 * Creates a comprehensive result embed
 * @param {Object} data - Favicon analysis data
 * @param {string} filename - Attachment filename
 * @returns {EmbedBuilder} - Discord embed object
 */
const createResultEmbed = (data, filename) => {
    const embed = new EmbedBuilder()
        .setTitle(`🔍 Favicon Analysis: ${data.domain}`)
        .setDescription(`Favicon extracted and analyzed from **${data.pageTitle}**`)
        .setColor(0x00FF94)
        .setTimestamp()
        .setFooter({ text: 'Favicon Hash Analysis Tool' })
        .setThumbnail(`attachment://${filename}`)
        .addFields(
            {
                name: '📊 Technical Details',
                value: `**Type:** ${data.contentType}\n**Size:** ${(data.fileSize / 1024).toFixed(2)} KB\n**Source:** ${data.faviconSource}`,
                inline: true
            },
            {
                name: '🔢 Hash Values',
                value: `**MurmurHash3:** \`${data.hashes.murmurhash3}\`\n**MD5:** \`${data.hashes.md5.substring(0, 16)}...\`\n**SHA256:** \`${data.hashes.sha256.substring(0, 16)}...\``,
                inline: true
            },
            {
                name: '🔍 Search Platforms',
                value: `[Shodan](${data.searchUrls.shodan}) • [Censys](${data.searchUrls.censys})\n[BinaryEdge](${data.searchUrls.binaryedge}) • [ZoomEye](${data.searchUrls.zoomeye})`,
                inline: false
            }
        );
    
    // Add warning if default favicon was used
    if (data.faviconSource === 'default') {
        embed.addFields({
            name: '⚠️ Notice',
            value: 'Used default favicon.ico as no specific favicon was found in the page.',
            inline: false
        });
    }
    
    return embed;
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-favicon')
        .setDescription('Extract and analyze website favicons for OSINT and asset discovery')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('Target website URL (must include http:// or https://)')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('raw')
                .setDescription('Export raw JSON data with comprehensive hash information')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('verbose')
                .setDescription('Show detailed favicon discovery process and metadata')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('format')
                .setDescription('Preferred output format for hash values')
                .setRequired(false)
                .addChoices(
                    { name: 'Decimal (Shodan format)', value: 'decimal' },
                    { name: 'Hexadecimal', value: 'hex' },
                    { name: 'Both formats', value: 'both' }
                )),

    async execute(interaction) {
        let tempDir = null;
        
        try {
            await interaction.deferReply({ ephemeral: false });
            
            // Get and validate options
            const url = interaction.options.getString('url').trim();
            const returnRaw = interaction.options.getBoolean('raw') || false;
            const verbose = interaction.options.getBoolean('verbose') || false;
            const hashFormat = interaction.options.getString('format') || 'decimal';
            
            // Validate URL
            const parsedUrl = validateUrl(url);
            const domain = parsedUrl.hostname;
            
            // Create temporary directory
            tempDir = await createTempDirectory();
            
            // Update user with progress
            const progressEmbed = new EmbedBuilder()
                .setTitle('⏳ Analyzing Favicon')
                .setDescription(`Fetching webpage from **${domain}**...`)
                .setColor(0xFFFF00);
            await interaction.editReply({ embeds: [progressEmbed] });
            
            // Fetch webpage with comprehensive error handling
            let html, pageTitle;
            try {
                const response = await axios.get(url, {
                    timeout: CONFIG.REQUEST_TIMEOUT,
                    headers: { 'User-Agent': CONFIG.USER_AGENT },
                    maxRedirects: 5,
                    validateStatus: (status) => status >= 200 && status < 400
                });
                
                html = response.data;
                const $ = cheerio.load(html);
                pageTitle = $('title').text().trim() || domain;
                
            } catch (error) {
                let errorMessage = 'Failed to fetch webpage';
                
                if (error.code === 'ENOTFOUND') {
                    errorMessage = `Cannot resolve hostname: ${domain}`;
                } else if (error.code === 'ECONNABORTED') {
                    errorMessage = 'Request timeout - server may be slow or unresponsive';
                } else if (error.response) {
                    errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
                }
                
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Connection Error')
                    .setDescription(errorMessage)
                    .setColor(0xFF0000);
                
                return interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // Extract favicon candidates
            progressEmbed.setDescription(`Discovering favicons on **${domain}**...`);
            await interaction.editReply({ embeds: [progressEmbed] });
            
            const faviconCandidates = extractFaviconCandidates(html, url);
            
            if (verbose) {
                console.log(`Found ${faviconCandidates.length} favicon candidates for ${domain}`);
                faviconCandidates.forEach((candidate, index) => {
                    console.log(`  ${index + 1}. ${candidate.url} (${candidate.rel}, ${candidate.sizes})`);
                });
            }
            
            // Try to download favicon from candidates
            let faviconData = null;
            let faviconInfo = null;
            let successfulCandidate = null;
            
            for (const candidate of faviconCandidates) {
                try {
                    progressEmbed.setDescription(`Downloading favicon from **${candidate.url}**...`);
                    await interaction.editReply({ embeds: [progressEmbed] });
                    
                    faviconData = await downloadFavicon(candidate.url);
                    successfulCandidate = candidate;
                    
                    console.log(`Successfully downloaded favicon from ${candidate.url}`);
                    break;
                    
                } catch (error) {
                    if (verbose) {
                        console.log(`Failed to download ${candidate.url}: ${error.message}`);
                    }
                    continue;
                }
            }
            
            if (!faviconData) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ No Favicon Found')
                    .setDescription(`Could not find or download any favicons from **${domain}**`)
                    .addFields({
                        name: 'Attempted URLs',
                        value: faviconCandidates.slice(0, 5).map(c => `• ${c.url}`).join('\n') + 
                               (faviconCandidates.length > 5 ? `\n• ... and ${faviconCandidates.length - 5} more` : ''),
                        inline: false
                    })
                    .setColor(0xFF6B6B);
                
                return interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // Process favicon data
            progressEmbed.setDescription('Processing favicon and calculating hashes...');
            await interaction.editReply({ embeds: [progressEmbed] });
            
            // Determine file extension from content type
            let extension = 'ico';
            const contentTypeLower = faviconData.contentType.toLowerCase();
            if (contentTypeLower.includes('png')) extension = 'png';
            else if (contentTypeLower.includes('jpeg') || contentTypeLower.includes('jpg')) extension = 'jpg';
            else if (contentTypeLower.includes('gif')) extension = 'gif';
            else if (contentTypeLower.includes('svg')) extension = 'svg';
            else if (contentTypeLower.includes('webp')) extension = 'webp';
            else if (contentTypeLower.includes('bmp')) extension = 'bmp';
            
            // Save favicon file
            const filename = `favicon-${domain.replace(/\./g, '_')}.${extension}`;
            const filePath = path.join(tempDir, filename);
            await fs.writeFile(filePath, faviconData.data);
            
            // Calculate hashes
            const hashes = calculateHashes(faviconData.data);
            const searchUrls = generateSearchUrls(hashes);
            
            // Prepare comprehensive data object
            const analysisData = {
                domain,
                pageTitle,
                url,
                faviconUrl: successfulCandidate.url,
                faviconSource: successfulCandidate.rel,
                contentType: faviconData.contentType,
                fileSize: faviconData.size,
                filename,
                extension,
                hashes,
                searchUrls,
                timestamp: new Date().toISOString(),
                candidatesFound: faviconCandidates.length,
                metadata: {
                    sizes: successfulCandidate.sizes,
                    originalUrl: successfulCandidate.originalUrl,
                    priority: successfulCandidate.priority
                }
            };
            
            // Create file attachments
            const imageAttachment = new AttachmentBuilder(filePath, { 
                name: filename,
                description: `Favicon extracted from ${domain}`
            });
            
            const attachments = [imageAttachment];
            
            // Handle raw JSON export
            if (returnRaw) {
                const jsonPath = path.join(tempDir, `favicon-analysis-${domain.replace(/\./g, '_')}.json`);
                await fs.writeFile(jsonPath, JSON.stringify(analysisData, null, 2));
                
                const jsonAttachment = new AttachmentBuilder(jsonPath, { 
                    name: `favicon-analysis-${domain.replace(/\./g, '_')}.json`,
                    description: 'Complete favicon analysis data in JSON format'
                });
                
                attachments.push(jsonAttachment);
                
                // Send raw response
                const rawEmbed = new EmbedBuilder()
                    .setTitle('📁 Raw Favicon Data Export')
                    .setDescription(`Complete favicon analysis for **${domain}** exported to JSON`)
                    .addFields({
                        name: 'Export Contents',
                        value: `• Favicon image file (${extension.toUpperCase()})\n• Complete JSON metadata\n• All hash formats\n• Search platform URLs`,
                        inline: false
                    })
                    .setColor(0x9B59B6)
                    .setTimestamp();
                
                await interaction.editReply({
                    embeds: [rawEmbed],
                    files: attachments
                });
            } else {
                // Create and send formatted embed
                const resultEmbed = createResultEmbed(analysisData, filename);
                
                // Add verbose information if requested
                if (verbose) {
                    resultEmbed.addFields({
                        name: '🔍 Discovery Details',
                        value: `**Candidates Found:** ${faviconCandidates.length}\n**Source Priority:** ${successfulCandidate.priority + 1}\n**Original URL:** ${successfulCandidate.originalUrl}`,
                        inline: false
                    });
                }
                
                await interaction.editReply({
                    embeds: [resultEmbed],
                    files: attachments
                });
            }
            
        } catch (error) {
            console.error('Error in favicon command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Unexpected Error')
                .setDescription('An unexpected error occurred during favicon analysis')
                .addFields({
                    name: 'Error Details',
                    value: `\`\`\`\n${error.message}\n\`\`\``,
                    inline: false
                })
                .setColor(0xFF0000)
                .setTimestamp();
            
            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (replyError) {
                console.error('Failed to send error response:', replyError);
            }
            
        } finally {
            // Cleanup temporary files with delay
            if (tempDir) {
                setTimeout(async () => {
                    await cleanupTempDirectory(tempDir);
                }, CONFIG.CLEANUP_DELAY);
            }
        }
    },
};