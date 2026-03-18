
/**
 * File: xeuledoc.js
 * Description: Google Documents and Drive OSINT intelligence gathering
 * Author: gl0bal01
 *
 * Discord wrapper around https://github.com/Malfrats/xeuledoc
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeSpawn } = require('../utils/process');

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

        // Validate that the link is a well-formed https://docs.google.com URL
        let parsedUrl;
        try {
            parsedUrl = new URL(link);
        } catch {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Link')
                .setDescription('Please provide a valid URL.')
                .setColor(0xff0000);
            return interaction.reply({ embeds: [embed] });
        }

        if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'docs.google.com') {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Link')
                .setDescription('Please provide a valid Google resource link (e.g., from Google Docs or Sheets).')
                .setColor(0xff0000);
            return interaction.reply({ embeds: [embed] });
        }

        await interaction.deferReply();

        try {
            const { stdout, stderr, code } = await safeSpawn('xeuledoc', [parsedUrl.href], { timeout: 60000 });

            if (code !== 0) {
                console.error(`xeuledoc exited with code ${code}: ${stderr}`);
                const embed = new EmbedBuilder()
                    .setTitle('Command Error')
                    .setDescription('xeuledoc encountered an error while processing the link.')
                    .setColor(0xffa500);
                return interaction.editReply({ embeds: [embed] });
            }

            if (stderr) {
                console.error(`xeuledoc stderr: ${stderr}`);
            }

            const embed = new EmbedBuilder()
                .setTitle('xeuledoc Output')
                .setDescription(`\`\`\`\n${stdout}\n\`\`\``)
                .setColor(0x00ff00);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error executing xeuledoc:', error);
            const embed = new EmbedBuilder()
                .setTitle('Execution Error')
                .setDescription('An unexpected error occurred while running xeuledoc. Please try again later.')
                .setColor(0xff0000);
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
