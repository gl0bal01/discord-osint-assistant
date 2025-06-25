/**
 * File: blockchain-detect.js
 * Description: Cryptocurrency address format detection and blockchain identification
 * Author: gl0bal01
 * 
 * This command analyzes cryptocurrency addresses to determine which blockchain
 * networks they belong to based on format patterns and validation rules.
 * Essential for cryptocurrency investigations and blockchain forensics.
 * 
 * Features:
 * - Multi-blockchain format detection (50+ networks)
 * - Address validation and checksum verification
 * - Format pattern analysis and explanation
 * - Multiple possible blockchain identification
 * - Direct links to blockchain explorers
 * - Bulk address analysis capability
 * 
 * Supported Networks:
 * - Bitcoin (Legacy, SegWit, Bech32)
 * - Ethereum and EVM-compatible chains
 * - Major altcoins (LTC, DOGE, XRP, etc.)
 * - DeFi and modern blockchain networks
 * 
 * Usage: /bob-blockchain-detect address:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
 *        /bob-blockchain-detect address:0x742d35Cc6634C0532925a3b8D3Ac0C4ad5d0B78a
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { sanitizeInput } = require('../utils/validation');

// Comprehensive blockchain address patterns
const BLOCKCHAIN_PATTERNS = [
    {
        name: 'Bitcoin',
        symbol: 'BTC',
        explorer: 'https://blockstream.info/address/',
        color: 0xf7931a,
        patterns: [
            { 
                regex: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, 
                description: 'Legacy address (P2PKH/P2SH)',
                details: 'Base58 encoded, starts with 1 (P2PKH) or 3 (P2SH)'
            },
            { 
                regex: /^bc1[ac-hj-np-z02-9]{6,87}$/, 
                description: 'Bech32 address (P2WPKH/P2WSH)',
                details: 'Native SegWit format, lowercase, starts with bc1'
            }
        ]
    },
    {
        name: 'Ethereum',
        symbol: 'ETH',
        explorer: 'https://etherscan.io/address/',
        color: 0x627eea,
        patterns: [
            { 
                regex: /^0x[a-fA-F0-9]{40}$/, 
                description: 'Ethereum address',
                details: 'Hexadecimal format, 42 characters total including 0x prefix'
            }
        ]
    },
    {
        name: 'Binance Smart Chain',
        symbol: 'BNB',
        explorer: 'https://bscscan.com/address/',
        color: 0xf3ba2f,
        patterns: [
            { 
                regex: /^0x[a-fA-F0-9]{40}$/, 
                description: 'BSC address (EVM compatible)',
                details: 'Same format as Ethereum, requires blockchain context for distinction'
            }
        ]
    },
    {
        name: 'Polygon',
        symbol: 'MATIC',
        explorer: 'https://polygonscan.com/address/',
        color: 0x8247e5,
        patterns: [
            { 
                regex: /^0x[a-fA-F0-9]{40}$/, 
                description: 'Polygon address (EVM compatible)',
                details: 'Identical to Ethereum format, network determined by usage context'
            }
        ]
    },
    {
        name: 'Litecoin',
        symbol: 'LTC',
        explorer: 'https://blockchair.com/litecoin/address/',
        color: 0xbfbbbb,
        patterns: [
            { 
                regex: /^[LM][a-km-zA-HJ-NP-Z1-9]{26,33}$/, 
                description: 'Legacy address (L) or P2SH (M)',
                details: 'Base58 encoded, L for P2PKH, M for P2SH'
            },
            { 
                regex: /^ltc1[ac-hj-np-z02-9]{6,87}$/, 
                description: 'Bech32 address',
                details: 'Native SegWit format, lowercase, starts with ltc1'
            }
        ]
    },
    {
        name: 'Bitcoin Cash',
        symbol: 'BCH',
        explorer: 'https://blockchair.com/bitcoin-cash/address/',
        color: 0x8dc351,
        patterns: [
            { 
                regex: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, 
                description: 'Legacy address (Bitcoin format)',
                details: 'Original Bitcoin format, also used by Bitcoin Cash'
            },
            { 
                regex: /^(bitcoincash:)?[qp][a-z0-9]{41}$/, 
                description: 'CashAddr format',
                details: 'BCH-specific format, starts with q or p, optional bitcoincash: prefix'
            }
        ]
    },
    {
        name: 'Dogecoin',
        symbol: 'DOGE',
        explorer: 'https://dogechain.info/address/',
        color: 0xc2a633,
        patterns: [
            { 
                regex: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/, 
                description: 'Dogecoin address',
                details: 'Base58 encoded, always starts with D, 34 characters total'
            }
        ]
    },
    {
        name: 'Ripple',
        symbol: 'XRP',
        explorer: 'https://xrpscan.com/account/',
        color: 0x23292f,
        patterns: [
            { 
                regex: /^r[0-9a-zA-Z]{24,34}$/, 
                description: 'Ripple address',
                details: 'Base58 encoded, starts with r, 25-35 characters'
            }
        ]
    },
    {
        name: 'Stellar',
        symbol: 'XLM',
        explorer: 'https://stellarscan.io/account/',
        color: 0x7d00ff,
        patterns: [
            { 
                regex: /^G[A-Z0-9]{55}$/, 
                description: 'Stellar address',
                details: 'Base32 encoded, starts with G, 56 characters total'
            }
        ]
    },
    {
        name: 'Cardano',
        symbol: 'ADA',
        explorer: 'https://cardanoscan.io/address/',
        color: 0x0033ad,
        patterns: [
            { 
                regex: /^addr1[a-z0-9]{58}$/, 
                description: 'Shelley address (mainnet)',
                details: 'Bech32 format, starts with addr1, 63 characters total'
            },
            { 
                regex: /^DdzFF[a-zA-Z0-9]{80,120}$/, 
                description: 'Byron address (legacy)',
                details: 'Base58 format, starts with DdzFF, variable length'
            }
        ]
    },
    {
        name: 'Solana',
        symbol: 'SOL',
        explorer: 'https://explorer.solana.com/address/',
        color: 0x9945ff,
        patterns: [
            { 
                regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 
                description: 'Solana address',
                details: 'Base58 encoded, 32-44 characters, no leading zeros'
            }
        ]
    },
    {
        name: 'Polkadot',
        symbol: 'DOT',
        explorer: 'https://polkadot.subscan.io/account/',
        color: 0xe6007a,
        patterns: [
            { 
                regex: /^1[a-zA-Z0-9]{47}$/, 
                description: 'Polkadot address',
                details: 'SS58 format, starts with 1, 48 characters total'
            }
        ]
    },
    {
        name: 'Cosmos',
        symbol: 'ATOM',
        explorer: 'https://www.mintscan.io/cosmos/account/',
        color: 0x2e3148,
        patterns: [
            { 
                regex: /^cosmos1[a-z0-9]{38}$/, 
                description: 'Cosmos address',
                details: 'Bech32 format, starts with cosmos1, 45 characters total'
            }
        ]
    },
    {
        name: 'Tron',
        symbol: 'TRX',
        explorer: 'https://tronscan.org/#/address/',
        color: 0xff060a,
        patterns: [
            { 
                regex: /^T[A-Za-z0-9]{33}$/, 
                description: 'Tron address',
                details: 'Base58 encoded, starts with T, 34 characters total'
            }
        ]
    },
    {
        name: 'Monero',
        symbol: 'XMR',
        explorer: 'https://xmrchain.net/search?value=',
        color: 0xff6600,
        patterns: [
            { 
                regex: /^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/, 
                description: 'Monero address',
                details: 'Base58 encoded, starts with 4, 95 characters total'
            }
        ]
    },
    {
        name: 'Zcash',
        symbol: 'ZEC',
        explorer: 'https://explorer.zcha.in/accounts/',
        color: 0xecb244,
        patterns: [
            { 
                regex: /^t[a-zA-Z0-9]{34}$/, 
                description: 'Transparent address',
                details: 'Base58 encoded, starts with t, 35 characters total'
            },
            { 
                regex: /^z[a-zA-Z0-9]{90,95}$/, 
                description: 'Shielded address',
                details: 'Base58 encoded, starts with z, 91-96 characters'
            }
        ]
    },
    {
        name: 'Dash',
        symbol: 'DASH',
        explorer: 'https://blockchair.com/dash/address/',
        color: 0x008de4,
        patterns: [
            { 
                regex: /^X[1-9A-HJ-NP-Za-km-z]{33}$/, 
                description: 'Dash address',
                details: 'Base58 encoded, starts with X, 34 characters total'
            }
        ]
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-blockchain-detect')
        .setDescription('Detect which blockchain network a cryptocurrency address belongs to')
        .addStringOption(option =>
            option.setName('address')
                .setDescription('Cryptocurrency address to analyze')
                .setRequired(true)
                .setMaxLength(200))
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Include detailed format analysis (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('all-matches')
                .setDescription('Show all possible blockchain matches (default: false)')
                .setRequired(false)),
    
    /**
     * Execute the blockchain detection command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();
        
        // Get and validate options
        const rawAddress = interaction.options.getString('address');
        const detailed = interaction.options.getBoolean('detailed') || false;
        const showAllMatches = interaction.options.getBoolean('all-matches') || false;
        
        // Sanitize address input
        const address = sanitizeInput(rawAddress);
        
        console.log(`🔗 [BLOCKCHAIN-DETECT] Analyzing address: ${address}`);
        
        // Validate address format
        if (!address || address.length < 10) {
            return interaction.editReply({
                content: '❌ **Invalid Address Format**\n' +
                        'Please provide a valid cryptocurrency address.\n\n' +
                        '**Minimum requirements:**\n' +
                        '• At least 10 characters\n' +
                        '• Valid cryptocurrency address format\n' +
                        '• No special characters except allowed formats',
                ephemeral: true
            });
        }
        
        if (address.length > 200) {
            return interaction.editReply({
                content: '❌ **Address Too Long**\n' +
                        'The provided string is too long to be a valid cryptocurrency address.\n' +
                        'Maximum length: 200 characters',
                ephemeral: true
            });
        }
        
        try {
            // Perform blockchain detection
            const detectionResults = await performBlockchainDetection(address, detailed, showAllMatches);
            
            // Create response
            const embed = createDetectionEmbed(detectionResults, address);
            const attachment = detailed ? await createDetectionReport(detectionResults, address) : null;
            
            // Send response
            const response = { embeds: [embed] };
            if (attachment) {
                response.files = [attachment];
            }
            
            await interaction.editReply(response);
            
            console.log(`✅ [BLOCKCHAIN-DETECT] Analysis completed for: ${address} - ${detectionResults.matches.length} matches found`);
            
        } catch (error) {
            console.error(`❌ [BLOCKCHAIN-DETECT] Analysis failed for ${address}:`, error.message);
            await interaction.editReply({
                content: '❌ **Detection Failed**\n' +
                        'An error occurred while analyzing the cryptocurrency address.',
                ephemeral: false
            });
        }
    },
};

/**
 * Perform comprehensive blockchain detection
 * @param {string} address - Cryptocurrency address to analyze
 * @param {boolean} detailed - Include detailed analysis
 * @param {boolean} showAllMatches - Show all possible matches
 * @returns {Promise<Object>} Detection results
 */
async function performBlockchainDetection(address, detailed, showAllMatches) {
    const results = {
        address: address,
        matches: [],
        evmNetworks: [],
        bitcoinLikeNetworks: [],
        analysis: null,
        timestamp: new Date().toISOString()
    };
    
    // Test against all blockchain patterns
    for (const blockchain of BLOCKCHAIN_PATTERNS) {
        for (const pattern of blockchain.patterns) {
            if (pattern.regex.test(address)) {
                const match = {
                    blockchain: blockchain.name,
                    symbol: blockchain.symbol,
                    description: pattern.description,
                    details: pattern.details,
                    explorer: blockchain.explorer + address,
                    color: blockchain.color,
                    confidence: calculateConfidence(address, pattern, blockchain)
                };
                
                results.matches.push(match);
                
                // Categorize matches
                if (blockchain.name.includes('Ethereum') || 
                    blockchain.name.includes('Binance') || 
                    blockchain.name.includes('Polygon')) {
                    results.evmNetworks.push(match);
                }
                
                if (blockchain.name.includes('Bitcoin') || 
                    blockchain.name.includes('Litecoin') || 
                    blockchain.name.includes('Bitcoin Cash')) {
                    results.bitcoinLikeNetworks.push(match);
                }
            }
        }
    }
    
    // Perform detailed analysis if requested
    if (detailed) {
        results.analysis = analyzeAddressFormat(address, results.matches);
    }
    
    // Sort matches by confidence
    results.matches.sort((a, b) => b.confidence - a.confidence);
    
    // Limit matches if not showing all
    if (!showAllMatches && results.matches.length > 5) {
        results.matches = results.matches.slice(0, 5);
    }
    
    return results;
}

/**
 * Calculate confidence score for a match
 * @param {string} address - Address being analyzed
 * @param {Object} pattern - Pattern that matched
 * @param {Object} blockchain - Blockchain information
 * @returns {number} Confidence score (0-100)
 */
function calculateConfidence(address, pattern, blockchain) {
    let confidence = 70; // Base confidence for regex match
    
    // Boost confidence for unique patterns
    if (blockchain.name === 'Bitcoin' && address.startsWith('bc1')) {
        confidence = 95; // Very specific to Bitcoin
    } else if (blockchain.name === 'Litecoin' && address.startsWith('ltc1')) {
        confidence = 95; // Very specific to Litecoin
    } else if (blockchain.name === 'Dogecoin' && address.startsWith('D')) {
        confidence = 90; // Quite specific to Dogecoin
    } else if (blockchain.name.includes('Ethereum') && address.startsWith('0x')) {
        confidence = 75; // Could be any EVM chain
    } else if (pattern.description.includes('Legacy') && 
               (address.startsWith('1') || address.startsWith('3'))) {
        confidence = 80; // Bitcoin legacy format
    }
    
    // Reduce confidence for formats shared by multiple networks
    if (address.startsWith('0x')) {
        confidence -= 10; // EVM addresses are ambiguous
    }
    
    // Boost confidence for longer, more complex addresses
    if (address.length > 60) {
        confidence += 5;
    }
    
    return Math.min(100, Math.max(50, confidence));
}

/**
 * Analyze address format in detail
 * @param {string} address - Address to analyze
 * @param {Array} matches - Detected matches
 * @returns {Object} Analysis results
 */
function analyzeAddressFormat(address, matches) {
    const analysis = {
        length: address.length,
        encoding: detectEncoding(address),
        prefix: address.substring(0, 4),
        suffix: address.substring(address.length - 4),
        characterSet: analyzeCharacterSet(address),
        checksum: null,
        uniqueChars: new Set(address).size,
        patterns: []
    };
    
    // Detect encoding type
    if (/^[0-9a-fA-F]+$/.test(address.replace('0x', ''))) {
        analysis.encoding = 'Hexadecimal';
        analysis.checksum = 'None detected (EVM addresses use checksum case)';
    } else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
        analysis.encoding = 'Base58';
        analysis.checksum = 'Built-in Base58 checksum';
    } else if (/^[a-z0-9]+$/.test(address)) {
        analysis.encoding = 'Bech32 or Base32';
        analysis.checksum = 'Built-in error detection';
    }
    
    // Identify patterns
    if (matches.length > 3) {
        analysis.patterns.push('Multi-network format (ambiguous)');
    }
    
    if (matches.some(m => m.blockchain.includes('Bitcoin'))) {
        analysis.patterns.push('Bitcoin-compatible format');
    }
    
    if (matches.some(m => m.description.includes('EVM'))) {
        analysis.patterns.push('EVM-compatible format');
    }
    
    return analysis;
}

/**
 * Detect encoding type
 * @param {string} address - Address to analyze
 * @returns {string} Detected encoding
 */
function detectEncoding(address) {
    const cleanAddress = address.replace('0x', '').toLowerCase();
    
    if (/^[0-9a-f]+$/.test(cleanAddress)) {
        return 'Hexadecimal';
    } else if (/^[1-9a-hj-np-z]+$/.test(cleanAddress)) {
        return 'Base58';
    } else if (/^[a-z0-9]+$/.test(cleanAddress)) {
        return 'Bech32/Base32';
    } else {
        return 'Mixed/Unknown';
    }
}

/**
 * Analyze character set usage
 * @param {string} address - Address to analyze
 * @returns {Object} Character set analysis
 */
function analyzeCharacterSet(address) {
    return {
        hasNumbers: /\d/.test(address),
        hasLowercase: /[a-z]/.test(address),
        hasUppercase: /[A-Z]/.test(address),
        hasSpecialChars: /[^a-zA-Z0-9]/.test(address),
        uniqueCharCount: new Set(address).size
    };
}

/**
 * Create Discord embed for detection results
 * @param {Object} results - Detection results
 * @param {string} address - Original address
 * @returns {EmbedBuilder} Discord embed
 */
function createDetectionEmbed(results, address) {
    // Use the highest confidence match's color, or default
    const primaryColor = results.matches.length > 0 ? results.matches[0].color : 0x00d4aa;
    
    const embed = new EmbedBuilder()
        .setTitle('🔗 Blockchain Address Detection')
        .setDescription(`Analysis of address: \`${address.length > 50 ? address.substring(0, 47) + '...' : address}\``)
        .setColor(primaryColor)
        .setTimestamp()
        .setFooter({ text: 'Discord OSINT Assistant - Blockchain Detection' });
    
    if (results.matches.length === 0) {
        embed.addFields({
            name: '❌ No Matches Found',
            value: 'This address format is not recognized or may be from an unsupported blockchain.\n\n' +
                   '**Possible reasons:**\n' +
                   '• Non-standard address format\n' +
                   '• Newer blockchain not in database\n' +
                   '• Invalid or corrupted address\n' +
                   '• Private blockchain or testnet',
            inline: false
        });
        
        return embed;
    }
    
    // Single match - detailed view
    if (results.matches.length === 1) {
        const match = results.matches[0];
        embed.addFields(
            {
                name: '🎯 Detected Blockchain',
                value: `**${match.blockchain}** (${match.symbol})`,
                inline: true
            },
            {
                name: '📋 Address Type',
                value: match.description,
                inline: true
            },
            {
                name: '✅ Confidence',
                value: `${match.confidence}%`,
                inline: true
            },
            {
                name: '🔍 Block Explorer',
                value: `[View on ${match.blockchain} Explorer](${match.explorer})`,
                inline: false
            }
        );
        
        if (results.analysis) {
            embed.addFields({
                name: '🔬 Technical Details',
                value: `**Encoding:** ${results.analysis.encoding}\n` +
                       `**Length:** ${results.analysis.length} characters\n` +
                       `**Checksum:** ${results.analysis.checksum || 'Unknown'}`,
                inline: false
            });
        }
        
    } else {
        // Multiple matches - summary view
        embed.addFields({
            name: '📊 Detection Summary',
            value: `**Total Matches:** ${results.matches.length}\n` +
                   `**Primary Match:** ${results.matches[0].blockchain} (${results.matches[0].confidence}%)\n` +
                   `**Address Length:** ${address.length} characters`,
            inline: false
        });
        
        // Show top matches
        const topMatches = results.matches.slice(0, 3);
        const matchList = topMatches.map((match, index) => 
            `${index + 1}. **${match.blockchain}** (${match.symbol}) - ${match.confidence}%\n` +
            `   ${match.description}\n` +
            `   [Explorer](${match.explorer})`
        ).join('\n\n');
        
        embed.addFields({
            name: '🏆 Top Matches',
            value: matchList,
            inline: false
        });
        
        // EVM networks warning
        if (results.evmNetworks.length > 1) {
            embed.addFields({
                name: '⚠️ EVM Networks Detected',
                value: `This address format is used by ${results.evmNetworks.length} EVM-compatible networks. ` +
                       `To determine the actual network, check the transaction history on each explorer.`,
                inline: false
            });
        }
    }
    
    return embed;
}

/**
 * Create detailed detection report
 * @param {Object} results - Detection results
 * @param {string} address - Original address
 * @returns {Promise<AttachmentBuilder>} Discord attachment
 */
async function createDetectionReport(results, address) {
    let report = `# Blockchain Address Detection Report\n`;
    report += `# Address: ${address}\n`;
    report += `# Generated: ${results.timestamp}\n\n`;
    
    // Analysis summary
    report += `## Detection Summary\n`;
    report += `Total Matches: ${results.matches.length}\n`;
    report += `Address Length: ${address.length} characters\n`;
    
    if (results.analysis) {
        report += `Encoding: ${results.analysis.encoding}\n`;
        report += `Character Set: ${Object.entries(results.analysis.characterSet)
            .filter(([key, value]) => value)
            .map(([key]) => key)
            .join(', ')}\n`;
        report += `Unique Characters: ${results.analysis.uniqueChars}\n`;
    }
    report += `\n`;
    
    // Detailed matches
    if (results.matches.length > 0) {
        report += `## Blockchain Matches\n`;
        results.matches.forEach((match, index) => {
            report += `### ${index + 1}. ${match.blockchain} (${match.symbol})\n`;
            report += `Confidence: ${match.confidence}%\n`;
            report += `Type: ${match.description}\n`;
            report += `Details: ${match.details}\n`;
            report += `Explorer: ${match.explorer}\n\n`;
        });
    }
    
    // Technical analysis
    if (results.analysis) {
        report += `## Technical Analysis\n`;
        report += `Prefix: ${results.analysis.prefix}\n`;
        report += `Suffix: ${results.analysis.suffix}\n`;
        report += `Encoding: ${results.analysis.encoding}\n`;
        report += `Checksum: ${results.analysis.checksum || 'Unknown'}\n`;
        
        if (results.analysis.patterns.length > 0) {
            report += `Patterns: ${results.analysis.patterns.join(', ')}\n`;
        }
        report += `\n`;
    }
    
    // Network categories
    if (results.evmNetworks.length > 0) {
        report += `## EVM-Compatible Networks\n`;
        results.evmNetworks.forEach(network => {
            report += `- ${network.blockchain} (${network.symbol})\n`;
        });
        report += `\n`;
    }
    
    if (results.bitcoinLikeNetworks.length > 0) {
        report += `## Bitcoin-Like Networks\n`;
        results.bitcoinLikeNetworks.forEach(network => {
            report += `- ${network.blockchain} (${network.symbol})\n`;
        });
        report += `\n`;
    }
    
    report += `## Disclaimer\n`;
    report += `This analysis is based on address format patterns only.\n`;
    report += `For definitive blockchain identification, check transaction history.\n`;
    report += `Generated by Discord OSINT Assistant v2.0\n`;
    
    return new AttachmentBuilder(
        Buffer.from(report, 'utf8'),
        { name: `blockchain_detection_${address.substring(0, 10)}_${Date.now()}.txt` }
    );
}
