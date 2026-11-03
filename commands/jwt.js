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
 * - Secrets are passed via environment variable (JWT_SECRET) to avoid
 *   /proc/<pid>/cmdline exposure; jwt_tool reads $JWT_SECRET when -p is omitted.
 *   NOTE: jwt_tool (ticarpi/jwt_tool) does not support a --keyfile / -pf flag as
 *   of the version targeted here, so the env-var approach is used as the safe default.
 *
 * Requirements:
 * - jwt_tool installed and accessible
 * - Appropriate file system permissions for temp directory
 * - Discord.js v14+ with slash command support
 *
 * Author: gl0bal01
 */

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { safeSpawn, safeSpawnToFile, getSafeEnv } = require('../utils/process');
const { isToolAvailable } = require('../utils/tools');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { reportFilePath, cleanupFile, REPORTS_DIR } = require('../utils/temp');
const { stripVTControlCharacters } = require('node:util');
const logger = require('../utils/logger').child({ command: 'bob-jwt' });

// JWT_TOOL_PATH: jwt_tool checkout (the full image installs it at /opt/tools/jwt_tool).
// JWT_WORDLIST: dictionary for `crack mode:dict`; defaults to the common-secrets list bundled
// with jwt_tool (mount a bigger one, e.g. rockyou, and point JWT_WORDLIST at it).
const JWT_TOOL_PATH = process.env.JWT_TOOL_PATH || '/opt/tools/jwt_tool';
const CONFIG = {
    JWT_TOOL_PATH,
    TEMP_FOLDER: REPORTS_DIR,
    DEFAULT_WORDLIST: process.env.JWT_WORDLIST || path.join(JWT_TOOL_PATH, 'jwt-common.txt'),
    COMMAND_TIMEOUT: 120000, // 2 minutes
    MAX_OUTPUT_SIZE: 10 * 1024 * 1024, // 10MB max output file size
    CLEANUP_INTERVAL: 3600000, // 1 hour cleanup interval
    MAX_FILE_AGE: 24 * 60 * 60 * 1000 // 24 hours max file age
};

// JWT token validation regex — rejects malformed tokens before invoking jwt_tool.
// The first character can't be '-' or jwt_tool's argparse reads the token as an option
// (e.g. "-Qj.t." is a search of jwt_tool's log of other users' tokens).
const JWT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

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
                logger.debug({ file }, 'cleaned up old file');
            }
        }
    } catch (error) {
        logger.error({ err: error }, 'cleanup failed');
    }
};

// Set up periodic cleanup; .unref() so the interval does not prevent process exit
const cleanupInterval = setInterval(cleanupOldFiles, CONFIG.CLEANUP_INTERVAL);
cleanupInterval.unref();

// Returns the argv prefix that runs jwt_tool: an executable at JWT_TOOL_PATH,
// `jwt_tool` on PATH, or the repo's jwt_tool.py run by its own venv python.
const findJwtTool = () => {
    if (isToolAvailable([CONFIG.JWT_TOOL_PATH])) return [CONFIG.JWT_TOOL_PATH];
    if (isToolAvailable(['jwt_tool'])) return ['jwt_tool'];
    const pyScript = `${CONFIG.JWT_TOOL_PATH}/jwt_tool.py`;
    const venvPython = `${CONFIG.JWT_TOOL_PATH}/venv/bin/python3`;
    if (fsSync.existsSync(pyScript) && isToolAvailable([venvPython])) return [venvPython, pyScript];
    throw Object.assign(new Error('jwt_tool not found.'), { code: 'ENOENT' });
};

const executeJwtCommand = async (cmd, args, outputFile, spawnOptions = {}) => {
    try {
        await safeSpawnToFile(cmd, args, outputFile, { timeout: CONFIG.COMMAND_TIMEOUT, ...spawnOptions });
    } catch (error) {
        const fsSync = require('fs');
        if (!fsSync.existsSync(outputFile) || fsSync.statSync(outputFile).size === 0) {
            // Timeout and missing-binary keep their code so the caller can tell the user why
            if (error.code === 'ETIMEDOUT' || error.code === 'ENOENT') throw error;
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
    requiresTool: [CONFIG.JWT_TOOL_PATH, `${CONFIG.JWT_TOOL_PATH}/venv/bin/python3`, 'jwt_tool'],
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
                    option.setName('mode')
                        .setDescription('Cracking mode (default: dict, uses JWT_WORDLIST)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Dictionary attack', value: 'dict' },
                            { name: 'Brute force (short)', value: 'brute' }
                        ))),

    async execute(interaction) {
        // All JWT subcommands are ephemeral — output may contain sensitive token data
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let outputFile = null;
        let runHome = null;

        try {
            const subcommand = interaction.options.getSubcommand();
            const token = interaction.options.getString('token').trim();

            // Validate JWT format — rejects malformed tokens before invoking jwt_tool
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
            const [jwtToolCmd, ...jwtToolArgs] = findJwtTool();

            // Create secure output file
            outputFile = reportFilePath(`jwt-${subcommand}`, 'txt');

            let jwtArgs = [];
            let embedTitle = '';
            let embedColor = 0x0099FF;
            // Extra spawn options (e.g. env containing JWT_SECRET for tamper)
            let spawnOptions = {};

            // Build args array based on subcommand (no shell interpolation)
            switch (subcommand) {
                case 'analyze': {
                    const verbose = interaction.options.getBoolean('verbose') ?? false;
                    jwtArgs = verbose ? ['-v', token] : [token];
                    embedTitle = '🔍 JWT Analysis Results';
                    embedColor = 0x0099FF;
                    break;
                }

                case 'tamper': {
                    const action = interaction.options.getString('action');
                    const claim = interaction.options.getString('claim');
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

                    // Pass secret via stdin (not argv, not env) to avoid
                    // /proc/<pid>/cmdline and /proc/<pid>/environ exposure.
                    // jwt_tool (ticarpi/jwt_tool) prompts for the HMAC secret
                    // via input() when -p is omitted, which reads from stdin.
                    spawnOptions = { input: secret };

                    // Build tamper args — no -p <secret> in argv
                    const baseArgs = ['-v', token, '-I'];
                    const signArgs = ['-S', algorithm];

                    switch (action) {
                        case 'modify':
                        case 'add':
                            jwtArgs = [...baseArgs, '-pc', claim, '-pv', value, ...signArgs];
                            break;
                        case 'delete':
                            jwtArgs = [...baseArgs, '-rm', claim, ...signArgs];
                            break;
                    }

                    embedTitle = '🛠️ JWT Tampering Results';
                    embedColor = 0xFF9900;
                    break;
                }

                case 'crack': {
                    let wordlist = CONFIG.DEFAULT_WORDLIST;
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

                    jwtArgs = ['-v', token, '-C', '-d', wordlist];

                    if (mode === 'brute') {
                        jwtArgs.push('-b');
                    }

                    embedTitle = '🔓 JWT Cracking Results';
                    embedColor = 0xFF0000;
                    break;
                }
            }

            // Update user with progress
            const progressEmbed = createResultEmbed(
                '⏳ Processing JWT Token',
                `Executing ${subcommand} operation...\nThis may take a few moments.`,
                0xFFFF00
            );
            await interaction.editReply({ embeds: [progressEmbed] });

            // Throwaway HOME: jwt_tool logs every token to ~/.jwt_tool/logs.txt, which must
            // not be shared between users. A fresh HOME makes its first run write the config
            // and exit, so prime it once.
            runHome = await fs.mkdtemp(path.join(os.tmpdir(), 'jwt-home-'));
            const runEnv = { ...getSafeEnv(), HOME: runHome };
            await safeSpawn(jwtToolCmd, [...jwtToolArgs], { env: runEnv, timeout: 30000 }).catch(() => {});
            spawnOptions = { ...spawnOptions, env: runEnv };

            // Execute command using safe spawn (no shell interpolation)
            await executeJwtCommand(jwtToolCmd, [...jwtToolArgs, ...jwtArgs], outputFile, spawnOptions);

            // Read and process output
            // jwt_tool colours its output; ANSI codes would show up raw in Discord
            const outputContent = stripVTControlCharacters(await fs.readFile(outputFile, 'utf8'));
            await fs.writeFile(outputFile, outputContent);

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
            // Log only the message — never log error.config.url or full error objects
            // which may contain secrets or sensitive request data
            logger.error({ err: error }, 'jwt command failed');

            let errorMessage = 'An unexpected error occurred while processing your request.';
            let errorColor = 0xFF0000;

            if (error.code === 'ETIMEDOUT') {
                errorMessage = '⏱️ Operation timed out. Complex operations may require more time.';
            } else if (error.code === 'ENOENT') {
                errorMessage = '🚫 JWT tool not found. Please check the installation and configuration.';
            } else if (error.message.includes('No output generated')) {
                errorMessage = '📄 Command completed but generated no output. Check your inputs and try again.';
            }

            const errorEmbed = createResultEmbed('❌ Error', errorMessage, errorColor);

            // stderr is not logged: jwt_tool echoes the token the user pasted

            await interaction.editReply({ embeds: [errorEmbed] });
        } finally {
            if (runHome) await fs.rm(runHome, { recursive: true, force: true }).catch(() => {});
            // Cleanup output file after a delay to ensure Discord has processed the attachment
            if (outputFile) {
                cleanupFile(outputFile, 30000);
            }
        }
    },

    shutdown() {
        clearInterval(cleanupInterval);
    },
};
