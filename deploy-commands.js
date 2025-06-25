/**
 * File: deploy-commands.js
 * Description: Script to register slash commands with Discord API
 * Author: gl0bal01
 * 
 * This script loads all command files from the commands directory and 
 * registers them with the Discord API for the specified guild. It supports
 * both guild-specific and global command deployment.
 * 
 * Usage:
 *   node deploy-commands.js           # Deploy to guild specified in .env
 *   node deploy-commands.js --global  # Deploy commands globally
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// Parse command line arguments
const args = process.argv.slice(2);
const isGlobalDeploy = args.includes('--global') || args.includes('-g');

// Check for required environment variables
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('❌ Missing required environment variables:');
    if (!DISCORD_TOKEN) console.error('   - DISCORD_TOKEN');
    if (!CLIENT_ID) console.error('   - CLIENT_ID');
    console.error('Please check your .env file and try again.');
    process.exit(1);
}

if (!isGlobalDeploy && !GUILD_ID) {
    console.error('❌ Missing GUILD_ID for guild deployment.');
    console.error('   Either set GUILD_ID in .env or use --global flag for global deployment.');
    process.exit(1);
}

// Initialize REST client with Discord token
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// Path to commands directory
const commandsPath = path.join(__dirname, 'commands');

/**
 * Load and validate all command files
 * @returns {Array} Array of command data objects ready for deployment
 */
async function loadCommands() {
    const commands = [];
    
    try {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        
        console.log(`📁 Found ${commandFiles.length} command files in ${commandsPath}`);
        
        // Process each command file
        for (const file of commandFiles) {
            try {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);
                
                // Validate command structure
                if (!command.data || typeof command.data.toJSON !== 'function') {
                    console.warn(`   ⚠️  Command ${file} is missing required 'data' property or toJSON method. Skipping.`);
                    continue;
                }
                
                if (!command.execute || typeof command.execute !== 'function') {
                    console.warn(`   ⚠️  Command ${file} is missing required 'execute' method. Skipping.`);
                    continue;
                }
                
                // Add the command to our deployment list
                const commandData = command.data.toJSON();
                commands.push(commandData);
                console.log(`   ✅ Loaded command: ${commandData.name} - ${commandData.description}`);
                
            } catch (error) {
                console.error(`   ❌ Error loading command from ${file}:`, error.message);
            }
        }
        
        return commands;
        
    } catch (error) {
        console.error('❌ Error reading commands directory:', error.message);
        throw error;
    }
}

/**
 * Deploy commands to Discord
 * @param {Array} commands - Array of command data objects
 */
async function deployCommands(commands) {
    try {
        if (commands.length === 0) {
            console.error('❌ No valid commands found to deploy.');
            process.exit(1);
        }
        
        console.log(`\n🚀 Starting deployment of ${commands.length} command(s)...`);
        
        let deploymentData;
        let deploymentTarget;
        
        if (isGlobalDeploy) {
            // Deploy global commands (available in all guilds, takes up to 1 hour to propagate)
            console.log('🌍 Deploying commands globally...');
            console.log('⚠️  Note: Global commands may take up to 1 hour to propagate to all servers.');
            
            deploymentData = await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands }
            );
            
            deploymentTarget = 'globally';
            
        } else {
            // Deploy guild-specific commands (faster updates, but only for specified guild)
            console.log(`🏠 Deploying commands to guild ${GUILD_ID}...`);
            
            deploymentData = await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: commands }
            );
            
            deploymentTarget = `to guild ${GUILD_ID}`;
        }
        
        console.log(`✅ Successfully deployed ${deploymentData.length} command(s) ${deploymentTarget}.`);
        
        // List deployed commands
        console.log('\n📋 Deployed commands:');
        deploymentData.forEach((cmd, index) => {
            console.log(`   ${index + 1}. ${cmd.name} - ${cmd.description}`);
        });
        
        console.log('\n🎉 Deployment completed successfully!');
        
        if (!isGlobalDeploy) {
            console.log('\n💡 Tip: Use --global flag to deploy commands globally to all servers.');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
        
        if (error.code === 401) {
            console.error('   Authentication failed. Please check your DISCORD_TOKEN.');
        } else if (error.code === 403) {
            console.error('   Permission denied. Please check your bot permissions.');
        } else if (error.code === 404) {
            console.error('   Application or guild not found. Please check your CLIENT_ID and GUILD_ID.');
        }
        
        process.exit(1);
    }
}

/**
 * Main deployment function
 */
async function main() {
    try {
        console.log('🤖 Discord OSINT Assistant - Command Deployment');
        console.log('================================================');
        console.log(`📅 Deployment started at: ${new Date().toISOString()}`);
        console.log(`🎯 Target: ${isGlobalDeploy ? 'Global' : `Guild ${GUILD_ID}`}`);
        console.log(`🔑 Client ID: ${CLIENT_ID}`);
        
        // Load all commands
        const commands = await loadCommands();
        
        // Deploy commands to Discord
        await deployCommands(commands);
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

/**
 * Handle cleanup on script termination
 */
process.on('SIGINT', () => {
    console.log('\n🛑 Deployment interrupted by user.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Deployment terminated.');
    process.exit(0);
});

// Run the deployment
main();
