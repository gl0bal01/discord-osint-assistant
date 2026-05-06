/**
 * File: blockchain.js
 * Description: Command to retrieve blockchain information (addresses, transactions, blocks)
 * Author: gl0bal01
 *
 * This command interfaces with various blockchain APIs to retrieve information about
 * wallet addresses, transactions, and blocks across different cryptocurrencies.
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSafeAxiosConfig, SIZE_10MB } = require('../utils/ssrf');
const { cleanupFile } = require('../utils/temp');
const { capField, safeAscii } = require('../utils/embed');

const MAX_CONTENT = SIZE_10MB;

// Define supported blockchains
const BLOCKCHAINS = [
    { name: 'Bitcoin', value: 'btc', symbol: 'BTC', explorer: 'https://www.blockchain.com/explorer/addresses/btc/' },
    { name: 'Ethereum', value: 'eth', symbol: 'ETH', explorer: 'https://etherscan.io/address/' },
    { name: 'Litecoin', value: 'ltc', symbol: 'LTC', explorer: 'https://blockchair.com/litecoin/address/' },
    { name: 'Bitcoin Cash', value: 'bch', symbol: 'BCH', explorer: 'https://blockchair.com/bitcoin-cash/address/' },
    { name: 'Dogecoin', value: 'doge', symbol: 'DOGE', explorer: 'https://dogechain.info/address/' },
    { name: 'Dash', value: 'dash', symbol: 'DASH', explorer: 'https://blockchair.com/dash/address/' },
    { name: 'Zcash', value: 'zec', symbol: 'ZEC', explorer: 'https://explorer.zcha.in/accounts/' },
    { name: 'Binance Smart Chain', value: 'bsc', symbol: 'BNB', explorer: 'https://bscscan.com/address/' },
    { name: 'Polygon', value: 'matic', symbol: 'MATIC', explorer: 'https://polygonscan.com/address/' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-blockchain')
        .setDescription('Retrieve blockchain information (addresses, transactions, blocks)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('address')
                .setDescription('Look up information about a blockchain address/wallet')
                .addStringOption(option =>
                    option.setName('blockchain')
                        .setDescription('The blockchain to query')
                        .setRequired(true)
                        .addChoices(...BLOCKCHAINS))
                .addStringOption(option =>
                    option.setName('address')
                        .setDescription('The blockchain address to look up')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('full')
                        .setDescription('Return full raw data as JSON')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transaction')
                .setDescription('Look up information about a blockchain transaction')
                .addStringOption(option =>
                    option.setName('blockchain')
                        .setDescription('The blockchain to query')
                        .setRequired(true)
                        .addChoices(...BLOCKCHAINS))
                .addStringOption(option =>
                    option.setName('txid')
                        .setDescription('The transaction ID/hash to look up')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('full')
                        .setDescription('Return full raw data as JSON')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('block')
                .setDescription('Look up information about a blockchain block')
                .addStringOption(option =>
                    option.setName('blockchain')
                        .setDescription('The blockchain to query')
                        .setRequired(true)
                        .addChoices(...BLOCKCHAINS))
                .addStringOption(option =>
                    option.setName('block')
                        .setDescription('The block height or hash to look up')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('full')
                        .setDescription('Return full raw data as JSON')
                        .setRequired(false))),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const blockchain = interaction.options.getString('blockchain');
            const fullData = interaction.options.getBoolean('full') ?? false;
            const subcommand = interaction.options.getSubcommand();

            // Create a temp directory if it doesn't exist
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Generate unique ID for this request
            const requestId = crypto.randomBytes(4).toString('hex');

            // Get blockchain details
            const blockchainInfo = BLOCKCHAINS.find(b => b.value === blockchain);
            if (!blockchainInfo) {
                return interaction.editReply(`Error: Unsupported blockchain '${blockchain}'.`);
            }

            // Handle different subcommands
            if (subcommand === 'address') {
                await handleAddressLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId);
            } else if (subcommand === 'transaction') {
                await handleTransactionLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId);
            } else if (subcommand === 'block') {
                await handleBlockLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId);
            }

        } catch (error) {
            console.error('Blockchain command error:', error.message);
            await interaction.editReply('An error occurred while processing your request. Please try again later.');
        }
    },
};

/**
 * Handle looking up a blockchain address
 * @param {Object} interaction - Discord interaction
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} blockchainInfo - Blockchain details
 * @param {boolean} fullData - Whether to return full raw data
 * @param {string} tempDir - Temporary directory path
 * @param {string} requestId - Unique request ID
 */
async function handleAddressLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId) {
    const address = interaction.options.getString('address');

    // Basic address validation
    if (!validateBlockchainAddress(blockchain, address)) {
        return interaction.editReply(`Invalid ${blockchainInfo.name} address format. Please check your input.`);
    }

    try {
        // Fetch address data using appropriate API for the blockchain
        const data = await fetchAddressData(blockchain, address);

        if (!data) {
            return interaction.editReply(`No data found for ${blockchainInfo.name} address: ${address}`);
        }

        // If full data is requested, return JSON file
        if (fullData) {
            const filePath = path.join(tempDir, `${blockchain}_address_${requestId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            const attachment = new AttachmentBuilder(filePath, {
                name: `${blockchain}_address_${address.substring(0, 8)}.json`
            });

            await interaction.editReply({
                content: `Full data for ${blockchainInfo.name} address: ${address}`,
                files: [attachment]
            });

            cleanupFile(filePath, 5000);
            return;
        }

        // Extract useful data based on blockchain
        const summary = extractAddressSummary(blockchain, data, blockchainInfo);

        // Create embed for address information
        const embed = new EmbedBuilder()
            .setTitle(`${blockchainInfo.name} Address Information`)
            .setDescription(capField(`Address: \`${address}\``))
            .setColor(0x4CAF50)
            .setURL(`${blockchainInfo.explorer}${address}`)
            .addFields(
                { name: 'Balance', value: capField(summary.balance), inline: true },
                { name: 'Total Received', value: capField(summary.totalReceived), inline: true },
                { name: 'Total Sent', value: capField(summary.totalSent), inline: true },
                { name: 'Transaction Count', value: capField(summary.txCount), inline: true }
            )
            .setFooter({ text: capField(`Data from ${summary.dataSource} • Block Explorer: ${blockchainInfo.explorer}${address}`) })
            .setTimestamp();

        // Add additional fields based on blockchain-specific data
        if (summary.additionalFields) {
            for (const field of summary.additionalFields) {
                embed.addFields({ name: field.name, value: capField(field.value), inline: field.inline || false });
            }
        }

        // Send the response
        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error fetching ${blockchainInfo.name} address:`, error.message);
        await interaction.editReply('An error occurred while processing your request. Please try again later.');
    }
}

/**
 * Handle looking up a blockchain transaction
 * @param {Object} interaction - Discord interaction
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} blockchainInfo - Blockchain details
 * @param {boolean} fullData - Whether to return full raw data
 * @param {string} tempDir - Temporary directory path
 * @param {string} requestId - Unique request ID
 */
async function handleTransactionLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId) {
    const txid = interaction.options.getString('txid');

    // Basic transaction ID validation
    if (!validateTransactionId(blockchain, txid)) {
        return interaction.editReply(`Invalid ${blockchainInfo.name} transaction ID format. Please check your input.`);
    }

    try {
        // Fetch transaction data using appropriate API for the blockchain
        const data = await fetchTransactionData(blockchain, txid);

        if (!data) {
            return interaction.editReply(`No data found for ${blockchainInfo.name} transaction: ${txid}`);
        }

        // If full data is requested, return JSON file
        if (fullData) {
            const filePath = path.join(tempDir, `${blockchain}_tx_${requestId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            const attachment = new AttachmentBuilder(filePath, {
                name: `${blockchain}_tx_${txid.substring(0, 8)}.json`
            });

            await interaction.editReply({
                content: `Full data for ${blockchainInfo.name} transaction: ${txid}`,
                files: [attachment]
            });

            cleanupFile(filePath, 5000);
            return;
        }

        // Extract useful data based on blockchain
        const summary = extractTransactionSummary(blockchain, data, blockchainInfo);

        // Create embed for transaction information
        const embed = new EmbedBuilder()
            .setTitle(`${blockchainInfo.name} Transaction Information`)
            .setDescription(capField(`Transaction ID: \`${txid}\``))
            .setColor(0x2196F3)
            .addFields(
                { name: 'Status', value: capField(summary.status), inline: true },
                { name: 'Block', value: capField(summary.block), inline: true },
                { name: 'Timestamp', value: capField(summary.timestamp), inline: true },
                { name: 'Amount', value: capField(summary.amount), inline: true },
                { name: 'Fee', value: capField(summary.fee), inline: true }
            )
            .setFooter({ text: capField(`Data from ${summary.dataSource}`) })
            .setTimestamp();

        // Add sender/recipient fields
        embed.addFields(
            { name: 'From', value: capField(summary.from || 'Unknown'), inline: false },
            { name: 'To', value: capField(summary.to || 'Unknown'), inline: false }
        );

        // Add additional fields based on blockchain-specific data
        if (summary.additionalFields) {
            for (const field of summary.additionalFields) {
                embed.addFields({ name: field.name, value: capField(field.value), inline: field.inline || false });
            }
        }

        // Set explorer URL for transaction
        if (summary.explorerUrl) {
            embed.setURL(summary.explorerUrl);
        }

        // Send the response
        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error fetching ${blockchainInfo.name} transaction:`, error.message);
        await interaction.editReply('An error occurred while processing your request. Please try again later.');
    }
}

/**
 * Handle looking up a blockchain block
 * @param {Object} interaction - Discord interaction
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} blockchainInfo - Blockchain details
 * @param {boolean} fullData - Whether to return full raw data
 * @param {string} tempDir - Temporary directory path
 * @param {string} requestId - Unique request ID
 */
async function handleBlockLookup(interaction, blockchain, blockchainInfo, fullData, tempDir, requestId) {
    const block = interaction.options.getString('block');

    // Determine if block is a height or hash
    const isHeight = /^\d+$/.test(block);
    const blockIdentifier = isHeight ? 'height' : 'hash';

    try {
        // Fetch block data using appropriate API for the blockchain
        const data = await fetchBlockData(blockchain, block, isHeight);

        if (!data) {
            return interaction.editReply(`No data found for ${blockchainInfo.name} block ${blockIdentifier}: ${block}`);
        }

        // If full data is requested, return JSON file
        if (fullData) {
            const filePath = path.join(tempDir, `${blockchain}_block_${requestId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            const attachment = new AttachmentBuilder(filePath, {
                name: `${blockchain}_block_${block.substring(0, 8)}.json`
            });

            await interaction.editReply({
                content: `Full data for ${blockchainInfo.name} block ${blockIdentifier}: ${block}`,
                files: [attachment]
            });

            cleanupFile(filePath, 5000);
            return;
        }

        // Extract useful data based on blockchain
        const summary = extractBlockSummary(blockchain, data, blockchainInfo);

        // Create embed for block information
        const embed = new EmbedBuilder()
            .setTitle(`${blockchainInfo.name} Block Information`)
            .setDescription(capField(`Block ${blockIdentifier}: \`${block}\``))
            .setColor(0xFF9800)
            .addFields(
                { name: 'Height', value: capField(summary.height), inline: true },
                { name: 'Hash', value: capField(summary.hash), inline: false },
                { name: 'Timestamp', value: capField(summary.timestamp), inline: true },
                { name: 'Transactions', value: capField(summary.txCount), inline: true },
                { name: 'Size', value: capField(summary.size), inline: true },
                { name: 'Difficulty', value: capField(summary.difficulty), inline: true },
                { name: 'Miner', value: safeAscii(summary.miner || 'Unknown'), inline: false }
            )
            .setFooter({ text: capField(`Data from ${summary.dataSource}`) })
            .setTimestamp();

        // Add additional fields based on blockchain-specific data
        if (summary.additionalFields) {
            for (const field of summary.additionalFields) {
                embed.addFields({ name: field.name, value: capField(field.value), inline: field.inline || false });
            }
        }

        // Set explorer URL for block
        if (summary.explorerUrl) {
            embed.setURL(summary.explorerUrl);
        }

        // Send the response
        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error fetching ${blockchainInfo.name} block:`, error.message);
        await interaction.editReply('An error occurred while processing your request. Please try again later.');
    }
}

/**
 * Validate blockchain address format
 * @param {string} blockchain - Blockchain identifier
 * @param {string} address - Address to validate
 * @returns {boolean} - Whether the address is valid
 * @throws {Error} - If blockchain is unknown/not whitelisted
 */
function validateBlockchainAddress(blockchain, address) {
    switch (blockchain) {
        case 'btc':
            // Bitcoin: legacy (P2PKH/P2SH) and native SegWit (bech32/bech32m)
            return /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{6,87})$/.test(address);
        case 'eth':
        case 'bsc':
        case 'matic':
            // Ethereum-style addresses: 0x + exactly 40 hex characters
            return /^0x[a-fA-F0-9]{40}$/.test(address);
        case 'ltc':
            // Litecoin: legacy (L/M) and native SegWit (ltc1)
            return /^(L[a-km-zA-HJ-NP-Z1-9]{26,33}|M[a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[a-z0-9]{6,87})$/.test(address);
        case 'bch':
            // Bitcoin Cash: cashaddr (q/p prefix) or legacy (1/3)
            return /^(bitcoincash:)?[qp][a-z0-9]{41,111}$/.test(address) ||
                   /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
        case 'doge':
            // Dogecoin addresses start with D, followed by 33 base58 chars
            return /^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
        case 'dash':
            // Dash addresses start with X, followed by 33 base58 chars
            return /^X[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
        case 'zec':
            // Zcash: transparent t-addr (t1/t3) or shielded z-addr (zs/zc)
            return /^t[13][a-km-zA-HJ-NP-Z1-9]{33}$/.test(address) ||
                   /^z[sc][a-km-zA-HJ-NP-Z1-9]{93,95}$/.test(address);
        default:
            throw new Error(`Unknown blockchain '${blockchain}': address validation refused.`);
    }
}

/**
 * Validate transaction ID format
 * @param {string} blockchain - Blockchain identifier
 * @param {string} txid - Transaction ID to validate
 * @returns {boolean} - Whether the transaction ID is valid
 */
function validateTransactionId(blockchain, txid) {
    // Most transaction IDs are 64-character hex strings
    return /^[a-fA-F0-9]{64}$/.test(txid);
}

/**
 * Fetch address data from appropriate API
 * @param {string} blockchain - Blockchain identifier
 * @param {string} address - Address to look up
 * @returns {Promise<Object>} - Address data
 */
async function fetchAddressData(blockchain, address) {
    const safeConfig = {
        ...getSafeAxiosConfig(),
        timeout: 10000,
        maxContentLength: MAX_CONTENT,
        maxBodyLength: MAX_CONTENT
    };

    switch (blockchain) {
        case 'btc': {
            const response = await axios.get(`https://blockchain.info/rawaddr/${address}`, safeConfig);
            return response.data;
        }
        case 'eth': {
            const response = await axios.get('https://api.etherscan.io/api', {
                params: {
                    module: 'account',
                    action: 'balance',
                    address,
                    tag: 'latest',
                    apikey: process.env.ETHERSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'ltc':
        case 'bch':
        case 'dash': {
            const response = await axios.get(
                `https://api.blockchair.com/${getBlockchairChain(blockchain)}/dashboards/address/${address}`,
                safeConfig
            );
            return response.data;
        }
        case 'doge': {
            const response = await axios.get(
                `https://dogechain.info/api/v1/address/balance/${address}`,
                safeConfig
            );
            return response.data;
        }
        case 'bsc': {
            const response = await axios.get('https://api.bscscan.com/api', {
                params: {
                    module: 'account',
                    action: 'balance',
                    address,
                    tag: 'latest',
                    apikey: process.env.BSCSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'matic': {
            const response = await axios.get('https://api.polygonscan.com/api', {
                params: {
                    module: 'account',
                    action: 'balance',
                    address,
                    tag: 'latest',
                    apikey: process.env.POLYGONSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'zec': {
            const response = await axios.get(
                `https://api.zcha.in/v2/mainnet/accounts/${address}`,
                safeConfig
            );
            return response.data;
        }
        default:
            throw new Error(`API not available for ${blockchain}`);
    }
}

/**
 * Fetch transaction data from appropriate API
 * @param {string} blockchain - Blockchain identifier
 * @param {string} txid - Transaction ID to look up
 * @returns {Promise<Object>} - Transaction data
 */
async function fetchTransactionData(blockchain, txid) {
    const safeConfig = {
        ...getSafeAxiosConfig(),
        timeout: 10000,
        maxContentLength: MAX_CONTENT,
        maxBodyLength: MAX_CONTENT
    };

    switch (blockchain) {
        case 'btc': {
            const response = await axios.get(`https://blockchain.info/rawtx/${txid}`, safeConfig);
            return response.data;
        }
        case 'eth': {
            const response = await axios.get('https://api.etherscan.io/api', {
                params: {
                    module: 'proxy',
                    action: 'eth_getTransactionByHash',
                    txhash: txid,
                    apikey: process.env.ETHERSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'ltc':
        case 'bch':
        case 'dash':
        case 'doge': {
            const chain = blockchain === 'doge' ? 'dogecoin' : getBlockchairChain(blockchain);
            const response = await axios.get(
                `https://api.blockchair.com/${chain}/dashboards/transaction/${txid}`,
                safeConfig
            );
            return response.data;
        }
        case 'bsc': {
            const response = await axios.get('https://api.bscscan.com/api', {
                params: {
                    module: 'proxy',
                    action: 'eth_getTransactionByHash',
                    txhash: txid,
                    apikey: process.env.BSCSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'matic': {
            const response = await axios.get('https://api.polygonscan.com/api', {
                params: {
                    module: 'proxy',
                    action: 'eth_getTransactionByHash',
                    txhash: txid,
                    apikey: process.env.POLYGONSCAN_API_KEY || ''
                },
                ...safeConfig
            });
            return response.data;
        }
        case 'zec': {
            const response = await axios.get(
                `https://api.zcha.in/v2/mainnet/transactions/${txid}`,
                safeConfig
            );
            return response.data;
        }
        default:
            throw new Error(`API not available for ${blockchain}`);
    }
}

/**
 * Fetch block data from appropriate API
 * @param {string} blockchain - Blockchain identifier
 * @param {string} block - Block height or hash to look up
 * @param {boolean} isHeight - Whether block is a height or hash
 * @returns {Promise<Object>} - Block data
 */
async function fetchBlockData(blockchain, block, isHeight) {
    const safeConfig = {
        ...getSafeAxiosConfig(),
        timeout: 10000,
        maxContentLength: MAX_CONTENT,
        maxBodyLength: MAX_CONTENT
    };

    switch (blockchain) {
        case 'btc': {
            const url = isHeight
                ? `https://blockchain.info/block-height/${block}?format=json`
                : `https://blockchain.info/rawblock/${block}`;
            const response = await axios.get(url, safeConfig);
            return response.data;
        }
        case 'eth': {
            const params = isHeight
                ? { module: 'proxy', action: 'eth_getBlockByNumber', tag: `0x${parseInt(block).toString(16)}`, boolean: 'true', apikey: process.env.ETHERSCAN_API_KEY || '' }
                : { module: 'proxy', action: 'eth_getBlockByHash', hash: block, boolean: 'true', apikey: process.env.ETHERSCAN_API_KEY || '' };
            const response = await axios.get('https://api.etherscan.io/api', { params, ...safeConfig });
            return response.data;
        }
        case 'ltc':
        case 'bch':
        case 'dash':
        case 'doge': {
            const blockParam = isHeight ? `height/${block}` : `hash/${block}`;
            const response = await axios.get(
                `https://api.blockchair.com/${getBlockchairChain(blockchain)}/dashboards/block/${blockParam}`,
                safeConfig
            );
            return response.data;
        }
        case 'bsc': {
            const params = isHeight
                ? { module: 'proxy', action: 'eth_getBlockByNumber', tag: `0x${parseInt(block).toString(16)}`, boolean: 'true', apikey: process.env.BSCSCAN_API_KEY || '' }
                : { module: 'proxy', action: 'eth_getBlockByHash', hash: block, boolean: 'true', apikey: process.env.BSCSCAN_API_KEY || '' };
            const response = await axios.get('https://api.bscscan.com/api', { params, ...safeConfig });
            return response.data;
        }
        case 'matic': {
            const params = isHeight
                ? { module: 'proxy', action: 'eth_getBlockByNumber', tag: `0x${parseInt(block).toString(16)}`, boolean: 'true', apikey: process.env.POLYGONSCAN_API_KEY || '' }
                : { module: 'proxy', action: 'eth_getBlockByHash', hash: block, boolean: 'true', apikey: process.env.POLYGONSCAN_API_KEY || '' };
            const response = await axios.get('https://api.polygonscan.com/api', { params, ...safeConfig });
            return response.data;
        }
        case 'zec': {
            const response = await axios.get(
                `https://api.zcha.in/v2/mainnet/blocks/${block}`,
                safeConfig
            );
            return response.data;
        }
        default:
            throw new Error(`API not available for ${blockchain}`);
    }
}

/**
 * Get Blockchair chain name from blockchain identifier
 * @param {string} blockchain - Blockchain identifier
 * @returns {string} - Blockchair chain name
 */
function getBlockchairChain(blockchain) {
    switch (blockchain) {
        case 'btc': return 'bitcoin';
        case 'ltc': return 'litecoin';
        case 'bch': return 'bitcoin-cash';
        case 'dash': return 'dash';
        case 'doge': return 'dogecoin';
        default: return blockchain;
    }
}

/**
 * Extract summary data from address API response
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} data - API response data
 * @param {Object} blockchainInfo - Blockchain details
 * @returns {Object} - Extracted summary data
 */
function extractAddressSummary(blockchain, data, blockchainInfo) {
    // Default summary structure
    const summary = {
        balance: '0 ' + blockchainInfo.symbol,
        totalReceived: '0 ' + blockchainInfo.symbol,
        totalSent: '0 ' + blockchainInfo.symbol,
        txCount: '0',
        dataSource: 'Blockchain APIs',
        additionalFields: []
    };

    // Extract data based on blockchain
    switch (blockchain) {
        case 'btc':
            // Blockchain.com Bitcoin API
            summary.balance = `${(data.final_balance / 100000000).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.totalReceived = `${(data.total_received / 100000000).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.totalSent = `${(data.total_sent / 100000000).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.txCount = data.n_tx.toString();
            summary.dataSource = 'Blockchain.info';
            break;
        case 'eth':
            // Etherscan API
            if (data.status === '1') {
                summary.balance = `${(parseInt(data.result) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.totalReceived = 'Need API key for this data';
                summary.totalSent = 'Need API key for this data';
                summary.txCount = 'Need API key for this data';
                summary.dataSource = 'Etherscan.io';
            }
            break;
        case 'ltc':
        case 'bch':
        case 'dash':
            // Blockchair API for these blockchains
            if (data.data && data.data[Object.keys(data.data)[0]]) {
                const addressData = data.data[Object.keys(data.data)[0]];
                summary.balance = `${addressData.address.balance / 1e8} ${blockchainInfo.symbol}`;
                summary.totalReceived = `${addressData.address.received / 1e8} ${blockchainInfo.symbol}`;
                summary.totalSent = `${addressData.address.spent / 1e8} ${blockchainInfo.symbol}`;
                summary.txCount = addressData.address.transaction_count.toString();
                summary.dataSource = 'Blockchair.com';
            }
            break;
        case 'doge':
            // DogeChain.info API
            if (data.success === 1) {
                summary.balance = `${parseFloat(data.balance).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.dataSource = 'DogeChain.info';
            }
            break;
        case 'bsc':
            // BscScan API
            if (data.status === '1') {
                summary.balance = `${(parseInt(data.result) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.dataSource = 'BscScan.com';
            }
            break;
        case 'matic':
            // PolygonScan API
            if (data.status === '1') {
                summary.balance = `${(parseInt(data.result) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.dataSource = 'PolygonScan.com';
            }
            break;
        case 'zec':
            // Zcash Explorer API
            summary.balance = `${parseFloat(data.balance).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.totalReceived = `${parseFloat(data.totalRecv).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.totalSent = `${parseFloat(data.totalSent).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.txCount = data.totalTx.toString();
            summary.dataSource = 'zcha.in';
            break;
    }

    return summary;
}

/**
 * Extract summary data from transaction API response
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} data - API response data
 * @param {Object} blockchainInfo - Blockchain details
 * @returns {Object} - Extracted summary data
 */
function extractTransactionSummary(blockchain, data, blockchainInfo) {
    // Default summary structure
    const summary = {
        status: 'Unknown',
        block: 'Unknown',
        timestamp: 'Unknown',
        amount: '0 ' + blockchainInfo.symbol,
        fee: '0 ' + blockchainInfo.symbol,
        from: 'Unknown',
        to: 'Unknown',
        dataSource: 'Blockchain APIs',
        additionalFields: []
    };

    // Extract data based on blockchain
    switch (blockchain) {
        case 'btc': {
            // Blockchain.com Bitcoin API
            summary.status = data.block_height ? 'Confirmed' : 'Pending';
            summary.block = data.block_height ? data.block_height.toString() : 'Pending';
            summary.timestamp = data.time ? new Date(data.time * 1000).toUTCString() : 'Pending';

            // Calculate total amount (sum of outputs)
            let totalAmount = 0;
            if (data.out && data.out.length > 0) {
                for (const output of data.out) {
                    totalAmount += output.value;
                }
            }
            summary.amount = `${(totalAmount / 100000000).toFixed(8)} ${blockchainInfo.symbol}`;

            // Calculate fee
            summary.fee = `${(data.fee / 100000000).toFixed(8)} ${blockchainInfo.symbol}`;

            // Get from/to addresses
            if (data.inputs && data.inputs.length > 0) {
                summary.from = data.inputs.map(input =>
                    input.prev_out && input.prev_out.addr ? input.prev_out.addr : 'Unknown'
                ).join('\n');
            }

            if (data.out && data.out.length > 0) {
                summary.to = data.out.map(output =>
                    output.addr ? output.addr : 'Unknown'
                ).join('\n');
            }

            summary.dataSource = 'Blockchain.info';
            summary.explorerUrl = `https://www.blockchain.com/explorer/transactions/btc/${data.hash}`;
            break;
        }

        case 'eth':
            // Etherscan API
            if (data.result) {
                const tx = data.result;
                summary.status = tx.blockNumber ? 'Confirmed' : 'Pending';
                summary.block = tx.blockNumber ? parseInt(tx.blockNumber, 16).toString() : 'Pending';
                summary.amount = `${(parseInt(tx.value, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.fee = tx.gas && tx.gasPrice ?
                    `${(parseInt(tx.gas, 16) * parseInt(tx.gasPrice, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}` :
                    'Unknown';
                summary.from = tx.from || 'Unknown';
                summary.to = tx.to || 'Unknown';
                summary.dataSource = 'Etherscan.io';
                summary.explorerUrl = `https://etherscan.io/tx/${tx.hash}`;
            }
            break;

        case 'ltc':
        case 'bch':
        case 'dash':
        case 'doge':
            // Blockchair API for these blockchains
            if (data.data && data.data[Object.keys(data.data)[0]]) {
                const txData = data.data[Object.keys(data.data)[0]];
                summary.status = txData.transaction.block_id ? 'Confirmed' : 'Pending';
                summary.block = txData.transaction.block_id ? txData.transaction.block_id.toString() : 'Pending';
                summary.timestamp = txData.transaction.time ? new Date(txData.transaction.time * 1000).toUTCString() : 'Pending';
                summary.amount = `${(txData.transaction.output_total / 1e8).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.fee = `${(txData.transaction.fee / 1e8).toFixed(8)} ${blockchainInfo.symbol}`;

                // Get from/to addresses from inputs/outputs
                if (txData.inputs && txData.inputs.length > 0) {
                    summary.from = txData.inputs.map(input =>
                        input.recipient || 'Unknown'
                    ).join('\n');
                }

                if (txData.outputs && txData.outputs.length > 0) {
                    summary.to = txData.outputs.map(output =>
                        output.recipient || 'Unknown'
                    ).join('\n');
                }

                summary.dataSource = 'Blockchair.com';
                summary.explorerUrl = `https://blockchair.com/${getBlockchairChain(blockchain)}/transaction/${Object.keys(data.data)[0]}`;
            }
            break;

        case 'bsc':
            // BscScan API
            if (data.result) {
                const tx = data.result;
                summary.status = tx.blockNumber ? 'Confirmed' : 'Pending';
                summary.block = tx.blockNumber ? parseInt(tx.blockNumber, 16).toString() : 'Pending';
                summary.amount = `${(parseInt(tx.value, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.fee = tx.gas && tx.gasPrice ?
                    `${(parseInt(tx.gas, 16) * parseInt(tx.gasPrice, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}` :
                    'Unknown';
                summary.from = tx.from || 'Unknown';
                summary.to = tx.to || 'Unknown';
                summary.dataSource = 'BscScan.com';
                summary.explorerUrl = `https://bscscan.com/tx/${tx.hash}`;
            }
            break;

        case 'matic':
            // PolygonScan API
            if (data.result) {
                const tx = data.result;
                summary.status = tx.blockNumber ? 'Confirmed' : 'Pending';
                summary.block = tx.blockNumber ? parseInt(tx.blockNumber, 16).toString() : 'Pending';
                summary.amount = `${(parseInt(tx.value, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}`;
                summary.fee = tx.gas && tx.gasPrice ?
                    `${(parseInt(tx.gas, 16) * parseInt(tx.gasPrice, 16) / 1e18).toFixed(8)} ${blockchainInfo.symbol}` :
                    'Unknown';
                summary.from = tx.from || 'Unknown';
                summary.to = tx.to || 'Unknown';
                summary.dataSource = 'PolygonScan.com';
                summary.explorerUrl = `https://polygonscan.com/tx/${tx.hash}`;
            }
            break;

        case 'zec':
            // Zcash Explorer API
            summary.status = data.confirmations > 0 ? 'Confirmed' : 'Pending';
            summary.block = data.blockHeight ? data.blockHeight.toString() : 'Pending';
            summary.timestamp = data.timestamp ? new Date(data.timestamp * 1000).toUTCString() : 'Pending';
            summary.amount = `${parseFloat(data.value).toFixed(8)} ${blockchainInfo.symbol}`;
            summary.fee = `${parseFloat(data.fee).toFixed(8)} ${blockchainInfo.symbol}`;

            // Join input/output addresses
            if (data.vin && data.vin.length > 0) {
                summary.from = data.vin.map(input =>
                    input.addresses ? input.addresses.join(', ') : 'Unknown'
                ).join('\n');
            }

            if (data.vout && data.vout.length > 0) {
                summary.to = data.vout.map(output =>
                    output.scriptPubKey && output.scriptPubKey.addresses ?
                    output.scriptPubKey.addresses.join(', ') : 'Unknown'
                ).join('\n');
            }

            summary.dataSource = 'zcha.in';
            summary.explorerUrl = `https://explorer.zcha.in/transactions/${data.hash}`;
            break;
    }

    return summary;
}

/**
 * Extract summary data from block API response
 * @param {string} blockchain - Blockchain identifier
 * @param {Object} data - API response data
 * @param {Object} blockchainInfo - Blockchain details
 * @returns {Object} - Extracted summary data
 */
function extractBlockSummary(blockchain, data, _blockchainInfo) {
    // Default summary structure
    const summary = {
        height: 'Unknown',
        hash: 'Unknown',
        timestamp: 'Unknown',
        txCount: '0',
        size: '0 bytes',
        difficulty: '0',
        miner: 'Unknown',
        dataSource: 'Blockchain APIs',
        additionalFields: []
    };

    // Extract data based on blockchain
    switch (blockchain) {
        case 'btc':
            // Blockchain.com Bitcoin API
            if (data.blocks && data.blocks.length > 0) {
                // If block-height was used, get the first block
                data = data.blocks[0];
            }

            summary.height = data.height.toString();
            summary.hash = data.hash;
            summary.timestamp = new Date(data.time * 1000).toUTCString();
            summary.txCount = data.n_tx.toString();
            summary.size = `${(data.size / 1024).toFixed(2)} KB`;
            summary.difficulty = data.difficulty.toLocaleString();

            // Try to get miner info from coinbase transaction
            if (data.tx && data.tx.length > 0 && data.tx[0].inputs && data.tx[0].inputs.length > 0) {
                const coinbase = data.tx[0].inputs[0].script;
                if (coinbase) {
                    try {
                        // Try to extract ASCII text from coinbase script
                        const hex = coinbase.replace(/^[0-9a-f]+/, ''); // Remove length byte
                        let text = '';
                        for (let i = 0; i < hex.length; i += 2) {
                            const charCode = parseInt(hex.substr(i, 2), 16);
                            if (charCode >= 32 && charCode <= 126) { // Printable ASCII
                                text += String.fromCharCode(charCode);
                            }
                        }
                        if (text.length > 0) {
                            summary.miner = text;
                        }
                    } catch (_e) {
                        // If parsing fails, just skip it
                    }
                }
            }

            summary.dataSource = 'Blockchain.info';
            summary.explorerUrl = `https://www.blockchain.com/explorer/blocks/btc/${data.hash}`;
            break;

        case 'eth':
            // Etherscan API
            if (data.result) {
                const block = data.result;
                summary.height = parseInt(block.number, 16).toString();
                summary.hash = block.hash;
                summary.timestamp = new Date(parseInt(block.timestamp, 16) * 1000).toUTCString();
                summary.txCount = block.transactions ? block.transactions.length.toString() : '0';
                summary.size = `${parseInt(block.size, 16).toLocaleString()} bytes`;
                summary.difficulty = parseInt(block.difficulty, 16).toLocaleString();
                summary.miner = block.miner || 'Unknown';

                // Add gas used and gas limit as additional fields
                summary.additionalFields.push({
                    name: 'Gas Used',
                    value: parseInt(block.gasUsed, 16).toLocaleString(),
                    inline: true
                });

                summary.additionalFields.push({
                    name: 'Gas Limit',
                    value: parseInt(block.gasLimit, 16).toLocaleString(),
                    inline: true
                });

                summary.dataSource = 'Etherscan.io';
                summary.explorerUrl = `https://etherscan.io/block/${summary.height}`;
            }
            break;

        case 'ltc':
        case 'bch':
        case 'dash':
        case 'doge':
            // Blockchair API for these blockchains
            if (data.data && data.data[Object.keys(data.data)[0]]) {
                const blockData = data.data[Object.keys(data.data)[0]];
                summary.height = blockData.block.id.toString();
                summary.hash = blockData.block.hash;
                summary.timestamp = new Date(blockData.block.time * 1000).toUTCString();
                summary.txCount = blockData.block.transaction_count.toString();
                summary.size = `${(blockData.block.size / 1024).toFixed(2)} KB`;
                summary.difficulty = blockData.block.difficulty.toLocaleString();

                // Try to get miner from coinbase data
                if (blockData.transactions && blockData.transactions.length > 0) {
                    const coinbaseData = blockData.transactions[0];
                    if (coinbaseData.output_address) {
                        summary.miner = coinbaseData.output_address;
                    }
                }

                summary.dataSource = 'Blockchair.com';
                summary.explorerUrl = `https://blockchair.com/${getBlockchairChain(blockchain)}/block/${summary.height}`;
            }
            break;

        case 'bsc':
            // BscScan API
            if (data.result) {
                const block = data.result;
                summary.height = parseInt(block.number, 16).toString();
                summary.hash = block.hash;
                summary.timestamp = new Date(parseInt(block.timestamp, 16) * 1000).toUTCString();
                summary.txCount = block.transactions ? block.transactions.length.toString() : '0';
                summary.size = `${parseInt(block.size, 16).toLocaleString()} bytes`;
                summary.difficulty = parseInt(block.difficulty, 16).toLocaleString();
                summary.miner = block.miner || 'Unknown';

                summary.dataSource = 'BscScan.com';
                summary.explorerUrl = `https://bscscan.com/block/${summary.height}`;
            }
            break;

        case 'matic':
            // PolygonScan API
            if (data.result) {
                const block = data.result;
                summary.height = parseInt(block.number, 16).toString();
                summary.hash = block.hash;
                summary.timestamp = new Date(parseInt(block.timestamp, 16) * 1000).toUTCString();
                summary.txCount = block.transactions ? block.transactions.length.toString() : '0';
                summary.size = `${parseInt(block.size, 16).toLocaleString()} bytes`;
                summary.difficulty = parseInt(block.difficulty, 16).toLocaleString();
                summary.miner = block.miner || 'Unknown';

                summary.dataSource = 'PolygonScan.com';
                summary.explorerUrl = `https://polygonscan.com/block/${summary.height}`;
            }
            break;

        case 'zec':
            // Zcash Explorer API
            summary.height = data.height.toString();
            summary.hash = data.hash;
            summary.timestamp = new Date(data.timestamp * 1000).toUTCString();
            summary.txCount = data.transactions.length.toString();
            summary.size = `${data.size.toLocaleString()} bytes`;
            summary.difficulty = data.difficulty.toLocaleString();

            // Add specific Zcash fields
            summary.additionalFields.push({
                name: 'Solution Size',
                value: data.solutionSize.toString(),
                inline: true
            });

            summary.dataSource = 'zcha.in';
            summary.explorerUrl = `https://explorer.zcha.in/blocks/${data.hash}`;
            break;
    }

    return summary;
}
