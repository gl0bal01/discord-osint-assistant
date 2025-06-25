/**
 * File: clear-commands.js
 * Description: Utility to clear all Discord slash commands for clean redeployment
 * Author: gl0bal01
 * 
 * This script removes all existing slash commands from Discord to ensure
 * clean deployment of updated commands. Use when command structures change
 * between versions or when experiencing deployment issues.
 * 
 * Usage:
 * node clear-commands.js                    # Clear guild commands only
 * node clear-commands.js --global           # Clear global commands
 * node clear-commands.js --all              # Clear both guild and global commands
 */

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
require('dotenv').config();

class CommandCleaner {
    constructor() {
        this.clientId = process.env.CLIENT_ID;
        this.guildId = process.env.GUILD_ID;
        this.token = process.env.DISCORD_TOKEN;
        
        // Validate required environment variables
        if (!this.clientId || !this.token) {
            console.error('❌ Missing required environment variables:');
            console.error('   CLIENT_ID and DISCORD_TOKEN are required');
            console.error('   GUILD_ID is required for guild commands');
            process.exit(1);
        }
        
        this.rest = new REST({ version: '9' }).setToken(this.token);
    }
    
    /**
     * Clear guild-specific commands
     */
    async clearGuildCommands() {
        if (!this.guildId) {
            console.log('⚠️  No GUILD_ID specified, skipping guild commands');
            return;
        }
        
        try {
            console.log('🔄 Fetching existing guild commands...');
            
            const commands = await this.rest.get(
                Routes.applicationGuildCommands(this.clientId, this.guildId)
            );
            
            if (commands.length === 0) {
                console.log('✅ No guild commands found to clear');
                return;
            }
            
            console.log(`📋 Found ${commands.length} guild commands:`);
            commands.forEach(cmd => {
                console.log(`   - /${cmd.name}: ${cmd.description}`);
            });
            
            console.log('🗑️  Clearing guild commands...');
            
            await this.rest.put(
                Routes.applicationGuildCommands(this.clientId, this.guildId),
                { body: [] }
            );
            
            console.log('✅ Successfully cleared all guild commands');
            
        } catch (error) {
            console.error('❌ Failed to clear guild commands:', error);
            
            if (error.status === 403) {
                console.error('   Bot lacks permissions or invalid token');
            } else if (error.status === 404) {
                console.error('   Guild not found or bot not in guild');
            }
            
            throw error;
        }
    }
    
    /**
     * Clear global commands
     */
    async clearGlobalCommands() {
        try {
            console.log('🔄 Fetching existing global commands...');
            
            const commands = await this.rest.get(
                Routes.applicationCommands(this.clientId)
            );
            
            if (commands.length === 0) {
                console.log('✅ No global commands found to clear');
                return;
            }
            
            console.log(`📋 Found ${commands.length} global commands:`);
            commands.forEach(cmd => {
                console.log(`   - /${cmd.name}: ${cmd.description}`);
            });
            
            console.log('🗑️  Clearing global commands...');
            console.log('⚠️  Note: Global command changes can take up to 1 hour to propagate');
            
            await this.rest.put(
                Routes.applicationCommands(this.clientId),
                { body: [] }
            );
            
            console.log('✅ Successfully cleared all global commands');
            
        } catch (error) {
            console.error('❌ Failed to clear global commands:', error);
            
            if (error.status === 403) {
                console.error('   Bot lacks permissions or invalid token');
            }
            
            throw error;
        }
    }
    
    /**
     * List all existing commands without clearing them
     */
    async listCommands() {
        try {
            console.log('📋 Listing all existing commands...\n');
            
            // List guild commands
            if (this.guildId) {
                console.log('🏠 Guild Commands:');
                const guildCommands = await this.rest.get(
                    Routes.applicationGuildCommands(this.clientId, this.guildId)
                );
                
                if (guildCommands.length === 0) {
                    console.log('   No guild commands found');
                } else {
                    guildCommands.forEach((cmd, index) => {
                        console.log(`   ${index + 1}. /${cmd.name}: ${cmd.description}`);
                    });
                }
                console.log('');
            }
            
            // List global commands
            console.log('🌍 Global Commands:');
            const globalCommands = await this.rest.get(
                Routes.applicationCommands(this.clientId)
            );
            
            if (globalCommands.length === 0) {
                console.log('   No global commands found');
            } else {
                globalCommands.forEach((cmd, index) => {
                    console.log(`   ${index + 1}. /${cmd.name}: ${cmd.description}`);
                });
            }
            
            console.log(`\n📊 Total Commands: Guild(${this.guildId ? guildCommands.length : 0}) + Global(${globalCommands.length})`);
            
        } catch (error) {
            console.error('❌ Failed to list commands:', error);
            throw error;
        }
    }
    
    /**
     * Interactive confirmation prompt
     */
    async confirm(message) {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        return new Promise((resolve) => {
            readline.question(`${message} (y/N): `, (answer) => {
                readline.close();
                resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
            });
        });
    }
    
    /**
     * Main execution function
     */
    async execute() {
        const args = process.argv.slice(2);
        const clearGlobal = args.includes('--global') || args.includes('--all');
        const clearGuild = !args.includes('--global') || args.includes('--all');
        const listOnly = args.includes('--list');
        const force = args.includes('--force');
        
        console.log('🤖 Discord Command Cleaner v2.0');
        console.log('================================\n');
        
        // List commands if requested
        if (listOnly) {
            await this.listCommands();
            return;
        }
        
        // Show what will be cleared
        console.log('📋 Operation Summary:');
        if (clearGuild && this.guildId) {
            console.log(`   - Clear guild commands (Guild ID: ${this.guildId})`);
        }
        if (clearGlobal) {
            console.log('   - Clear global commands');
        }
        console.log('');
        
        // Confirmation (unless --force is used)
        if (!force) {
            console.log('⚠️  WARNING: This will permanently delete all selected commands!');
            console.log('   You will need to redeploy commands using deploy-commands.js');
            console.log('');
            
            const confirmed = await this.confirm('Are you sure you want to continue?');
            if (!confirmed) {
                console.log('❌ Operation cancelled by user');
                return;
            }
            console.log('');
        }
        
        // Execute clearing operations
        try {
            if (clearGuild && this.guildId) {
                await this.clearGuildCommands();
                console.log('');
            }
            
            if (clearGlobal) {
                await this.clearGlobalCommands();
                console.log('');
            }
            
            console.log('🎉 Command clearing completed successfully!');
            console.log('');
            console.log('📝 Next Steps:');
            console.log('   1. Run: npm run deploy (for guild commands)');
            console.log('   2. Or run: npm run deploy:global (for global commands)');
            console.log('   3. Restart your bot if it\'s currently running');
            
        } catch (error) {
            console.error('\n💥 Command clearing failed!');
            console.error('   Please check your bot permissions and try again');
            process.exit(1);
        }
    }
}

// Show usage information
function showUsage() {
    console.log('🤖 Discord Command Cleaner v2.0');
    console.log('================================\n');
    console.log('Usage:');
    console.log('  node clear-commands.js                    # Clear guild commands only');
    console.log('  node clear-commands.js --global           # Clear global commands only');
    console.log('  node clear-commands.js --all              # Clear both guild and global');
    console.log('  node clear-commands.js --list             # List all commands (no deletion)');
    console.log('  node clear-commands.js --force            # Skip confirmation prompt');
    console.log('');
    console.log('Examples:');
    console.log('  node clear-commands.js --list             # See what commands exist');
    console.log('  node clear-commands.js --force            # Quick clear guild commands');
    console.log('  node clear-commands.js --global --force   # Quick clear global commands');
    console.log('');
    console.log('Environment Variables Required:');
    console.log('  DISCORD_TOKEN  - Your bot token');
    console.log('  CLIENT_ID      - Your application client ID');
    console.log('  GUILD_ID       - Your test server ID (for guild commands)');
}

// Handle command line execution
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        showUsage();
        process.exit(0);
    }
    
    const cleaner = new CommandCleaner();
    cleaner.execute().catch((error) => {
        console.error('💥 Unexpected error:', error.message);
        process.exit(1);
    });
}

module.exports = CommandCleaner;