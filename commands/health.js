/**
 * File: health.js
 * Description: Bot health monitoring and system status command
 * Author: gl0bal01
 * 
 * This command provides comprehensive health monitoring for the Discord OSINT Assistant,
 * including system metrics, API availability, external tool status, and performance data.
 * Essential for maintaining operational awareness and troubleshooting issues.
 * 
 * Features:
 * - System resource monitoring (CPU, memory, disk)
 * - Discord API connection status
 * - External tool availability checks
 * - API endpoint health validation
 * - Performance metrics and uptime tracking
 * - Environment configuration verification
 * 
 * Usage: /bob-health detailed:true
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { isToolAvailable } = require('../utils/tools');
const { getSafeAxiosConfig } = require('../utils/ssrf');
const logger = require('../utils/logger').child({ command: 'bob-health' });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-health')
        .setDescription('Check bot health status and system metrics')
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Show detailed system information (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('check-apis')
                .setDescription('Test external API connectivity (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('check-tools')
                .setDescription('Verify external tool availability (default: false)')
                .setRequired(false)),
    
    /**
     * Execute the health check command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();
        
        const detailed = interaction.options.getBoolean('detailed') ?? false;
        const checkApis = interaction.options.getBoolean('check-apis') ?? false;
        const checkTools = interaction.options.getBoolean('check-tools') ?? false;
        
        logger.debug({ detailed, checkApis, checkTools }, 'health check starting');
        
        try {
            // Gather all health information
            const healthData = await gatherHealthData(detailed, checkApis, checkTools, interaction.client);
            
            // Create formatted response
            const embed = createHealthEmbed(healthData, detailed);
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.debug({ status: healthData.overall.status }, 'health check completed');
            
        } catch (error) {
            logger.error({ err: error }, 'health check failed');
            await interaction.editReply({
                content: '❌ **Health Check Failed**\n' +
                        'An error occurred while gathering system information. Check server logs for details.',
                ephemeral: false
            });
        }
    },
};

/**
 * Gather comprehensive health data
 * @param {boolean} detailed - Include detailed system info
 * @param {boolean} checkApis - Test API connectivity
 * @param {boolean} checkTools - Check external tools
 * @returns {Promise<Object>} Health data object
 */
async function gatherHealthData(detailed, checkApis, checkTools, client) {
    const startTime = Date.now();
    
    // Basic system information
    const systemInfo = await getSystemInfo(detailed);
    const botInfo = getBotInfo(client);
    const discordInfo = getDiscordInfo(client);
    
    // Optional checks
    let apiStatus = null;
    let toolStatus = null;
    
    if (checkApis) {
        apiStatus = await checkApiHealth();
    }
    
    if (checkTools) {
        toolStatus = checkToolAvailability();
    }
    
    // Determine overall health status
    const overall = determineOverallHealth(systemInfo, botInfo, apiStatus, client);
    
    const processingTime = Date.now() - startTime;
    
    return {
        timestamp: new Date().toISOString(),
        processingTime,
        overall,
        system: systemInfo,
        bot: botInfo,
        discord: discordInfo,
        apis: apiStatus,
        tools: toolStatus
    };
}

/**
 * Get system information and metrics
 * @param {boolean} detailed - Include detailed metrics
 * @returns {Promise<Object>} System information
 */
async function getSystemInfo(detailed) {
    const info = {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: {
            used: process.memoryUsage(),
            system: {
                total: os.totalmem(),
                free: os.freemem()
            }
        }
    };
    
    if (detailed) {
        try {
            info.cpu = {
                model: os.cpus()[0]?.model || 'Unknown',
                cores: os.cpus().length,
                loadAvg: os.loadavg()
            };
            
            info.network = os.networkInterfaces();
            
            // Check disk space for temp directory
            const tempDir = path.join(__dirname, '../temp');
            try {
                await fs.access(tempDir);
                const stats = await fs.stat(tempDir);
                info.tempDir = {
                    exists: true,
                    path: tempDir,
                    accessed: stats.atime
                };
            } catch {
                info.tempDir = {
                    exists: false,
                    path: tempDir
                };
            }
            
        } catch (error) {
            logger.warn({ err: error }, 'detailed system info gathering failed');
        }
    }
    
    return info;
}

/**
 * Get bot-specific information
 * @returns {Object} Bot information
 */
function getBotInfo(client) {
    return {
        version: require('../package.json').version || '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        pid: process.pid,
        startTime: process.uptime(),
        commandsLoaded: client?.commands?.size || 0
    };
}

/**
 * Get Discord connection information
 * @returns {Object} Discord connection info
 */
function getDiscordInfo(client) {
    if (!client) {
        return {
            connected: false,
            status: 'Client not available'
        };
    }
    
    return {
        connected: client.isReady(),
        status: client.presence?.status || 'unknown',
        ping: client.ws.ping,
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        uptime: client.uptime,
        readyAt: client.readyAt?.toISOString()
    };
}

/**
 * Check external API health
 * @returns {Promise<Object>} API status information
 */
async function checkApiHealth() {
    const apis = [
        {
            name: 'DNSDumpster',
            envVar: 'DNSDUMPSTER_TOKEN',
            testUrl: 'https://api.dnsdumpster.com'
        },
        {
            name: 'Whoxy',
            envVar: 'WHOXY_API_KEY',
            testUrl: 'https://api.whoxy.com'
        },
        {
            name: 'Host.io',
            envVar: 'HOSTIO_API_KEY',
            testUrl: 'https://host.io'
        }
    ];
    
    const results = {};
    
    for (const api of apis) {
        try {
            const hasKey = !!process.env[api.envVar];
            let connectivity = 'unknown';
            
            if (hasKey) {
                // Simple connectivity test (without using API key)
                try {
                    await axios.head(api.testUrl, {
                        timeout: 5000,
                        maxContentLength: 1024 * 1024,
                        maxBodyLength: 1024 * 1024,
                        ...getSafeAxiosConfig()
                    });
                    connectivity = 'reachable';
                } catch {
                    connectivity = 'unreachable';
                }
            }
            
            results[api.name] = {
                configured: hasKey,
                connectivity: connectivity,
                status: hasKey && connectivity === 'reachable' ? 'healthy' : 'degraded'
            };
            
        } catch (error) {
            results[api.name] = {
                configured: false,
                connectivity: 'error',
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    return results;
}

/**
 * One row per CLI-backed command, from its `requiresTool`: the same check
 * bootstrap.loadCommands uses to load or hide it, so this list covers every tool
 * and can't drift. A missing tool is not a fault: the slim image ships none, and
 * the command is simply not registered there.
 * @returns {Object} tool name -> { command, available }
 */
function checkToolAvailability() {
    const results = {};
    for (const file of require('fs').readdirSync(__dirname).filter((f) => f.endsWith('.js')).sort()) {
        const command = require(path.join(__dirname, file));
        if (!command.requiresTool) continue;
        results[path.basename(command.requiresTool.at(-1))] = {
            command: command.data.name,
            available: isToolAvailable(command.requiresTool)
        };
    }
    return results;
}

/**
 * Determine overall health status
 * @param {Object} systemInfo - System information
 * @param {Object} botInfo - Bot information
 * @param {Object} apiStatus - API status (may be null)
 * @returns {Object} Overall health assessment
 */
function determineOverallHealth(systemInfo, botInfo, apiStatus, client) {
    let status = 'healthy';
    const issues = [];
    
    // Check memory usage
    const memoryUsage = systemInfo.memory.used.heapUsed / systemInfo.memory.used.heapTotal;
    if (memoryUsage > 0.9) {
        status = 'degraded';
        issues.push('High memory usage');
    }
    
    // Check if Discord is connected
    if (!client || !client.isReady()) {
        status = 'unhealthy';
        issues.push('Discord not connected');
    }
    
    // Check API status if available
    if (apiStatus) {
        const unhealthyApis = Object.values(apiStatus).filter(api => api.status === 'unhealthy');
        if (unhealthyApis.length > 0) {
            if (status === 'healthy') status = 'degraded';
            issues.push(`${unhealthyApis.length} API(s) unhealthy`);
        }
    }
    
    return {
        status,
        issues,
        score: status === 'healthy' ? 100 : status === 'degraded' ? 75 : 25
    };
}

/**
 * Create Discord embed with health information
 * @param {Object} healthData - Complete health data
 * @param {boolean} detailed - Include detailed information
 * @returns {EmbedBuilder} Discord embed
 */
function createHealthEmbed(healthData, detailed) {
    const statusEmojis = {
        healthy: '🟢',
        degraded: '🟡',
        unhealthy: '🔴'
    };
    
    const statusColors = {
        healthy: 0x00ff00,
        degraded: 0xffff00,
        unhealthy: 0xff0000
    };
    
    const embed = new EmbedBuilder()
        .setTitle('🏥 Discord OSINT Assistant - Health Status')
        .setColor(statusColors[healthData.overall.status])
        .setTimestamp()
        .setFooter({ text: `Health check completed in ${healthData.processingTime}ms` });
    
    // Overall status
    embed.addFields({
        name: '📊 Overall Status',
        value: `${statusEmojis[healthData.overall.status]} **${healthData.overall.status.toUpperCase()}** (${healthData.overall.score}/100)\n` +
               (healthData.overall.issues.length > 0 ? `⚠️ Issues: ${healthData.overall.issues.join(', ')}` : '✅ No issues detected'),
        inline: false
    });
    
    // System information
    const memUsed = Math.round(healthData.system.memory.used.heapUsed / 1024 / 1024);
    const memTotal = Math.round(healthData.system.memory.used.heapTotal / 1024 / 1024);
    const systemUptime = formatUptime(healthData.system.uptime);
    
    embed.addFields({
        name: '💻 System',
        value: `**Platform:** ${healthData.system.platform} ${healthData.system.arch}\n` +
               `**Node.js:** ${healthData.system.nodeVersion}\n` +
               `**Memory:** ${memUsed}MB / ${memTotal}MB\n` +
               `**Uptime:** ${systemUptime}`,
        inline: true
    });
    
    // Discord information
    const discordStatus = healthData.discord.connected ? '🟢 Connected' : '🔴 Disconnected';
    const discordUptime = healthData.discord.uptime ? formatUptime(healthData.discord.uptime / 1000) : 'N/A';
    
    embed.addFields({
        name: '🤖 Discord Bot',
        value: `**Status:** ${discordStatus}\n` +
               `**Ping:** ${healthData.discord.ping || 'N/A'}ms\n` +
               `**Guilds:** ${healthData.discord.guilds || 0}\n` +
               `**Uptime:** ${discordUptime}`,
        inline: true
    });
    
    // API Status (if checked)
    if (healthData.apis) {
        const apiSummary = Object.entries(healthData.apis).map(([name, status]) => {
            const emoji = status.status === 'healthy' ? '🟢' : status.status === 'degraded' ? '🟡' : '🔴';
            return `${emoji} ${name}`;
        }).join('\n');
        
        embed.addFields({
            name: '🌐 External APIs',
            value: apiSummary || 'No APIs checked',
            inline: true
        });
    }
    
    // Tool Status (if checked)
    if (healthData.tools) {
        const toolSummary = Object.entries(healthData.tools).map(([tool, { command, available }]) =>
            (available ? `🟢 ${tool}: /${command}` : `⚪ ${tool}: not installed, /${command} hidden`)
        ).join('\n');
        
        embed.addFields({
            name: '🔧 External Tools',
            value: toolSummary || 'No CLI-backed commands',
            inline: false
        });
    }
    
    // Detailed system info (if requested)
    if (detailed && healthData.system.cpu) {
        embed.addFields({
            name: '⚙️ Detailed System Info',
            value: `**CPU:** ${healthData.system.cpu.cores} cores\n` +
                   `**Load Avg:** ${healthData.system.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}\n` +
                   `**Temp Dir:** ${healthData.system.tempDir?.exists ? '✅ Available' : '❌ Missing'}`,
            inline: false
        });
    }
    
    return embed;
}

/**
 * Format uptime in human-readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m ${Math.floor(seconds % 60)}s`;
    }
}
