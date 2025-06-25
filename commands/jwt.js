/**
 * JWT Tool Discord Bot Command
 * ============================
 * 
 * A comprehensive Discord slash command for JWT (JSON Web Token) analysis and manipulation.
 * This command provides three main functionalities:
 * 
 * 1. ANALYZE: Decode and analyze JWT structure, claims, and metadata
 * 2. TAMPER: Modify, add, or delete JWT claims with proper re-signing
 * 3. CRACK: Attempt to crack JWT signatures using dictionary attacks
 * 
 * Features:
 * - Input validation and sanitization
 * - Secure command execution with timeouts
 * - Comprehensive error handling and logging
 * - File-based output management with automatic cleanup
 * - Discord embed formatting for better UX
 * - Support for custom wordlists and secret keys
 * 
 * Security Considerations:
 * - All user inputs are properly escaped to prevent injection attacks
 * - Commands execute with configurable timeouts to prevent resource exhaustion
 * - Temporary files are cleaned up automatically
 * - Sensitive information is handled securely
 * 
 * Requirements:
 * - jwt_tool installed and accessible
 * - Appropriate file system permissions for temp directory
 * - Discord.js v14+ with slash command support
 * 
 * Author: gl0bal01
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const crypto = require('crypto');

// Promisify exec for cleaner async/await usage
const execPromise = util.promisify(exec);

// Configuration - adjust these paths according to your environment
const CONFIG = {
    JWT_TOOL_PATH: process.env.JWT_TOOL_PATH || '/opt/tools/jwt_tool',
    TEMP_FOLDER: process.env.JWT_TEMP_FOLDER || '/tmp/jwt_analysis',
    DEFAULT_WORDLIST: process.env.JWT_WORDLIST || '/opt/rockyou.txt',
    COMMAND_TIMEOUT: parseInt(process.env.JWT_TIMEOUT) || 120000, // 2 minutes
    MAX_OUTPUT_SIZE: 10 * 1024 * 1024, // 10MB max output file size
    CLEANUP_INTERVAL: 3600000, // 1 hour cleanup interval
    MAX_FILE_AGE: 24 * 60 * 60 * 1000 // 24 hours max file age
};

// JWT token validation regex
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

// Utility functions
const sanitizeInput = (input) => {
    if (!input) return '';
    return input.replace(/[;&|`$(){}[\]\\]/g, '\\$&');
};

const escapeShellArg = (arg) => {
    if (!arg) return "''";
    return `'${arg.replace(/'/g, "'\\''")}'`;
};

const generateSecureFilename = (prefix) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = crypto.randomBytes(8).toString('hex');
    return `${prefix}-${timestamp}-${random}.txt`;
};

const cleanupOldFiles = async () => {
    try {
        if (!fsSync.existsSync(CONFIG.TEMP_FOLDER)) return;
        
        const files = await fs.readdir(CONFIG.TEMP_FOLDER);
        const now = Date.now();
        
        for (const file of files) {
            const filePath = path.join(CONFIG.TEMP_FOLDER, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > CONFIG.MAX_FILE_AGE) {
                await fs.unlink(filePath);
                console.log(`Cleaned up old file: ${file}`);
            }
        }
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
};

// Set up periodic cleanup
setInterval(cleanupOldFiles, CONFIG.CLEANUP_INTERVAL);

const findJwtTool = async () => {
    // Try configured path first
    try {
        await execPromise(`test -x "${CONFIG.JWT_TOOL_PATH}"`);
        return CONFIG.JWT_TOOL_PATH;
    } catch (error) {
        // Ignore and continue
    }

    // Try to find jwt_tool in PATH
    try {
        const { stdout } = await execPromise('which jwt_tool');
        if (stdout.trim()) {
            return 'jwt_tool';
        }
    } catch (error) {
        // Ignore and continue
    }

    // Try Python version as fallback
    const pythonPath = `${CONFIG.JWT_TOOL_PATH}/venv/bin/python3 ${CONFIG.JWT_TOOL_PATH}/jwt_tool.py`;
    try {
        await execPromise(`test -f "${CONFIG.JWT_TOOL_PATH}/jwt_tool.py"`);
        return pythonPath;
    } catch (error) {
        // Ignore and continue
    }

    throw new Error('jwt_tool not found. Please check installation and configuration.');
};

const executeJwtCommand = async (command, outputFile) => {
    const fullCmd = `timeout ${Math.floor(CONFIG.COMMAND_TIMEOUT / 1000)} ${command} > "${outputFile}" 2>&1`;
    
    console.log(`Executing JWT command: ${command}`);
    
    try {
        await execPromise(fullCmd, { 
            timeout: CONFIG.COMMAND_TIMEOUT,
            maxBuffer: CONFIG.MAX_OUTPUT_SIZE 
        });
    } catch (error) {
        // Command may exit with non-zero code but still produce useful output
        console.warn(`Command execution warning: ${error.message}`);
        
        // Check if output file exists and has content
        if (!fsSync.existsSync(outputFile) || fsSync.statSync(outputFile).size === 0) {
            throw new Error(`No output generated. Command failed: ${error.message}`);
        }
    }
};

const createResultEmbed = (title, content, color = 0x0099FF) => {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'JWT Analysis Tool' });

    if (content) {
        const trimmed = content.length > 1000 ? content.substring(0, 997) + '...' : content;
        embed.setDescription(`\`\`\`\n${trimmed}\n\`\`\``);
    }

    return embed;
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-jwt')
        .setDescription('Advanced JWT token analysis and manipulation toolkit')
        .addSubcommand(subcommand =>
            subcommand
                .setName('analyze')
                .setDescription('Decode and analyze JWT token structure and claims')
                .addStringOption(option =>
                    option.setName('token')
                        .setDescription('The JWT token to analyze (format: header.payload.signature)')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('verbose')
                        .setDescription('Enable verbose output with additional details')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('tamper')
                .setDescription('Modify JWT token claims and re-sign with provided secret')
                .addStringOption(option =>
                    option.setName('token')
                        .setDescription('The JWT token to modify')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Type of modification to perform')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Modify existing claim', value: 'modify' },
                            { name: 'Add new claim', value: 'add' },
                            { name: 'Delete claim', value: 'delete' }
                        ))
                .addStringOption(option =>
                    option.setName('claim')
                        .setDescription('Name of the claim to modify/add/delete (e.g., "sub", "role", "exp")')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('secret')
                        .setDescription('Secret key to re-sign the JWT token')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('New value for the claim (required for modify/add actions)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('algorithm')
                        .setDescription('Signing algorithm to use (default: HS256)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'HS256', value: 'hs256' },
                            { name: 'HS384', value: 'hs384' },
                            { name: 'HS512', value: 'hs512' },
                            { name: 'RS256', value: 'rs256' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('crack')
                .setDescription('Attempt to crack JWT signature using dictionary attack')
                .addStringOption(option =>
                    option.setName('token')
                        .setDescription('The JWT token to crack')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('wordlist')
                        .setDescription('Path to custom wordlist file (optional)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('Cracking mode to use')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Dictionary attack', value: 'dict' },
                            { name: 'Brute force (short)', value: 'brute' }
                        ))),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        let outputFile = null;
        
        try {
            const subcommand = interaction.options.getSubcommand();
            const token = interaction.options.getString('token').trim();

            // Validate JWT format
            if (!JWT_PATTERN.test(token)) {
                const embed = createResultEmbed(
                    '❌ Invalid JWT Format',
                    'Please provide a valid JWT token in the format: header.payload.signature\n\nExample: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
                    0xFF0000
                );
                return interaction.editReply({ embeds: [embed] });
            }

            // Ensure temp folder exists
            if (!fsSync.existsSync(CONFIG.TEMP_FOLDER)) {
                await fs.mkdir(CONFIG.TEMP_FOLDER, { recursive: true });
            }

            // Find jwt_tool
            const jwtToolCmd = await findJwtTool();
            
            // Create secure output file
            outputFile = path.join(CONFIG.TEMP_FOLDER, generateSecureFilename(`jwt-${subcommand}`));

            let cmd = '';
            let embedTitle = '';
            let embedColor = 0x0099FF;

            // Build command based on subcommand
            switch (subcommand) {
                case 'analyze':
                    const verbose = interaction.options.getBoolean('verbose') || false;
                    cmd = `${jwtToolCmd} ${verbose ? '-v' : ''} ${escapeShellArg(token)}`;
                    embedTitle = '🔍 JWT Analysis Results';
                    embedColor = 0x0099FF;
                    break;

                case 'tamper':
                    const action = interaction.options.getString('action');
                    const claim = sanitizeInput(interaction.options.getString('claim'));
                    const value = interaction.options.getString('value');
                    const secret = interaction.options.getString('secret');
                    const algorithm = interaction.options.getString('algorithm') || 'hs256';

                    // Validate inputs
                    if ((action === 'modify' || action === 'add') && !value) {
                        const embed = createResultEmbed(
                            '❌ Missing Value',
                            'Value is required for modify and add actions.',
                            0xFF0000
                        );
                        return interaction.editReply({ embeds: [embed] });
                    }

                    if (!secret) {
                        const embed = createResultEmbed(
                            '❌ Missing Secret',
                            'Secret key is required for tampering operations.',
                            0xFF0000
                        );
                        return interaction.editReply({ embeds: [embed] });
                    }

                    // Build tamper command
                    const baseCmd = `${jwtToolCmd} -v ${escapeShellArg(token)} -I`;
                    const signCmd = `-S ${algorithm} -p ${escapeShellArg(secret)}`;

                    switch (action) {
                        case 'modify':
                        case 'add':
                            cmd = `${baseCmd} -pc ${escapeShellArg(claim)} -pv ${escapeShellArg(value)} ${signCmd}`;
                            break;
                        case 'delete':
                            cmd = `${baseCmd} -rm ${escapeShellArg(claim)} ${signCmd}`;
                            break;
                    }

                    embedTitle = '🛠️ JWT Tampering Results';
                    embedColor = 0xFF9900;
                    break;

                case 'crack':
                    const wordlist = interaction.options.getString('wordlist') || CONFIG.DEFAULT_WORDLIST;
                    const mode = interaction.options.getString('mode') || 'dict';
                    
                    // Validate wordlist exists
                    if (!fsSync.existsSync(wordlist)) {
                        const embed = createResultEmbed(
                            '❌ Wordlist Not Found',
                            `The specified wordlist does not exist: ${wordlist}`,
                            0xFF0000
                        );
                        return interaction.editReply({ embeds: [embed] });
                    }

                    cmd = `${jwtToolCmd} -v ${escapeShellArg(token)} -C -d ${escapeShellArg(wordlist)}`;
                    
                    if (mode === 'brute') {
                        cmd += ' -b';
                    }

                    embedTitle = '🔓 JWT Cracking Results';
                    embedColor = 0xFF0000;
                    break;
            }

            // Update user with progress
            const progressEmbed = createResultEmbed(
                '⏳ Processing JWT Token',
                `Executing ${subcommand} operation...\nThis may take a few moments.`,
                0xFFFF00
            );
            await interaction.editReply({ embeds: [progressEmbed] });

            // Execute command
            await executeJwtCommand(cmd, outputFile);

            // Read and process output
            const outputContent = await fs.readFile(outputFile, 'utf8');
            
            if (!outputContent.trim()) {
                const embed = createResultEmbed(
                    '⚠️ No Output Generated',
                    'The command completed but produced no output. This may indicate an error or empty result.',
                    0xFFA500
                );
                return interaction.editReply({ embeds: [embed] });
            }

            // Create attachment for full output
            const attachment = new AttachmentBuilder(outputFile, { 
                name: `jwt-${subcommand}-results.txt`,
                description: `Complete ${subcommand} results for JWT analysis`
            });

            // Create result embed
            const resultEmbed = createResultEmbed(embedTitle, outputContent, embedColor);
            
            // Add useful footer information
            if (subcommand === 'crack' && outputContent.includes('MATCH')) {
                resultEmbed.addFields({
                    name: '✅ Success',
                    value: 'Secret key found! Check the attached file for details.',
                    inline: false
                });
            }

            // Send results
            await interaction.editReply({
                content: `JWT ${subcommand} operation completed successfully.`,
                embeds: [resultEmbed],
                files: [attachment]
            });

        } catch (error) {
            console.error('Error in JWT command:', error);

            let errorMessage = 'An unexpected error occurred while processing your request.';
            let errorColor = 0xFF0000;

            if (error.message.includes('timeout')) {
                errorMessage = '⏱️ Operation timed out. Complex operations may require more time.';
            } else if (error.message.includes('jwt_tool not found')) {
                errorMessage = '🚫 JWT tool not found. Please check the installation and configuration.';
            } else if (error.message.includes('No output generated')) {
                errorMessage = '📄 Command completed but generated no output. Check your inputs and try again.';
            }

            const errorEmbed = createResultEmbed('❌ Error', errorMessage, errorColor);
            
            if (error.stderr) {
                errorEmbed.addFields({
                    name: 'Technical Details',
                    value: `\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\``,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [errorEmbed] });
        } finally {
            // Cleanup output file after a delay to ensure Discord has processed the attachment
            if (outputFile && fsSync.existsSync(outputFile)) {
                setTimeout(async () => {
                    try {
                        await fs.unlink(outputFile);
                        console.log(`Cleaned up output file: ${outputFile}`);
                    } catch (error) {
                        console.error(`Failed to cleanup file ${outputFile}:`, error);
                    }
                }, 30000); // 30 second delay
            }
        }
    },
};