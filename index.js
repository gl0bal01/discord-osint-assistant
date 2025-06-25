/**
 * File: index.js
 * Description: Main Discord bot entry point for OSINT Assistant
 * Author: gl0bal01
 * 
 * This is the central file that initializes the Discord bot, loads all command modules,
 * and handles the primary event listeners for interactions. The bot is designed for
 * Open Source Intelligence (OSINT) gathering and analysis operations.
 */

// Load environment variables from .env file
require('dotenv').config();

// Import required Discord.js components
const { Client, Collection, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

// Initialize Discord client with required intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ] 
});

// Create a collection to store commands
client.commands = new Collection();

/**
 * Load all command modules from the commands directory
 * Each command file should export an object with 'data' and 'execute' properties
 */
const commandsPath = path.join(__dirname, 'commands');

try {
    // Read all JavaScript files from the commands directory
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    console.log(`📁 Loading ${commandFiles.length} command files...`);
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        
        try {
            const command = require(filePath);
            
            // Validate command structure
            if ('data' in command && 'execute' in command) {
                // Store command in collection using command name as key
                client.commands.set(command.data.name, command);
                console.log(`   ✅ Loaded command: ${command.data.name}`);
            } else {
                console.warn(`   ⚠️  Command at ${file} is missing required 'data' or 'execute' property. Skipping.`);
            }
        } catch (error) {
            console.error(`   ❌ Error loading command from ${file}:`, error.message);
        }
    }
    
    console.log(`✅ Successfully loaded ${client.commands.size} commands\n`);
} catch (error) {
    console.error('❌ Error reading commands directory:', error.message);
    process.exit(1);
}

/**
 * Event: Bot Ready
 * Triggered when the bot successfully connects to Discord
 */
client.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Discord OSINT Assistant is online!`);
    console.log(`   Logged in as: ${readyClient.user.tag}`);
    console.log(`   Bot ID: ${readyClient.user.id}`);
    console.log(`   Serving ${readyClient.guilds.cache.size} guild(s)`);
    console.log(`   Commands available: ${client.commands.size}`);
    console.log(`⭐ Bot ready for OSINT operations!\n`);
    
    // Set bot activity status
    client.user.setActivity('OSINT operations', { type: 'WATCHING' });
});

/**
 * Event: Interaction Create
 * Handles all incoming interactions (slash commands, buttons, etc.)
 */
client.on(Events.InteractionCreate, async interaction => {
    // Only process slash command interactions
    if (!interaction.isChatInputCommand()) return;
    
    // Retrieve the command from our collection
    const command = client.commands.get(interaction.commandName);
    
    if (!command) {
        console.error(`❌ No command matching ${interaction.commandName} was found.`);
        return;
    }
    
    // Log command usage for audit purposes
    const timestamp = new Date().toISOString();
    const userInfo = `${interaction.user.tag} (${interaction.user.id})`;
    const guildInfo = interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM';
    const commandInfo = `${interaction.commandName}`;
    
    console.log(`📝 [${timestamp}] Command executed: ${commandInfo} by ${userInfo} in ${guildInfo}`);
    
    try {
        // Execute the command with error handling
        await command.execute(interaction);
        
        // Log successful execution
        console.log(`   ✅ Command ${commandInfo} completed successfully`);
        
    } catch (error) {
        // Log the error for debugging
        console.error(`❌ Error executing command ${commandInfo}:`, error);
        
        // Prepare user-friendly error message
        const errorMessage = 'There was an error while executing this command! Please try again later.';
        
        try {
            // Send error response to user
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ 
                    content: errorMessage, 
                    flags: MessageFlags.Ephemeral 
                });
            } else {
                await interaction.reply({ 
                    content: errorMessage, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        } catch (replyError) {
            console.error('❌ Failed to send error message to user:', replyError);
        }
    }
});

/**
 * Event: Error Handling
 * Global error handler for uncaught exceptions
 */
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit the process for uncaught exceptions in production
    // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process for unhandled rejections in production
});

/**
 * Graceful shutdown handling
 */
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Gracefully shutting down...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Gracefully shutting down...');
    client.destroy();
    process.exit(0);
});

// Start the bot by logging in to Discord
console.log('🚀 Starting Discord OSINT Assistant...');
client.login(process.env.DISCORD_TOKEN);
