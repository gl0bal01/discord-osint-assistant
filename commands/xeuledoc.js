
/**
 * File: xeuledoc.js
 * Description: Google Documents and Drive OSINT intelligence gathering
 * Author: gl0bal01
 * 
 * Discord wrapper around https://github.com/Malfrats/xeuledoc
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { exec } = require('child_process');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-xeuledoc')
        .setDescription('Runs the installed xeuledoc command with a Google resource link')
        .addStringOption(option => 
            option.setName('link')
                .setDescription('The Google Docs/Sheets/Drive link to process')
                .setRequired(true)
        ),
    async execute(interaction) {
        const link = interaction.options.getString('link');
        
        // Basic check to ensure the link is from a Google Docs resource
        if (!link.startsWith('https://docs.google.com/')) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Link')
                .setDescription('Please provide a valid Google resource link (e.g., from Google Docs or Sheets).')
                .setColor(0xff0000);
            return interaction.reply({ embeds: [embed] });
        }
        
        // Execute the xeuledoc command with the provided link
        exec(`xeuledoc ${link}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing xeuledoc: ${error}`);
                const embed = new EmbedBuilder()
                    .setTitle('Execution Error')
                    .setDescription(`Error executing xeuledoc: ${error.message}`)
                    .setColor(0xff0000);
                return interaction.reply({ embeds: [embed] });
            }
            if (stderr) {
                console.error(`xeuledoc stderr: ${stderr}`);
                const embed = new EmbedBuilder()
                    .setTitle('Command Error')
                    .setDescription(`xeuledoc returned an error:\n\`\`\`\n${stderr}\n\`\`\``)
                    .setColor(0xffa500);
                return interaction.reply({ embeds: [embed] });
            }
            const embed = new EmbedBuilder()
                .setTitle('xeuledoc Output')
                .setDescription(`\`\`\`\n${stdout}\n\`\`\``)
                .setColor(0x00ff00);
            interaction.reply({ embeds: [embed] });
        });
    },
};
