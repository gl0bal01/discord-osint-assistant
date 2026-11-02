
/**
 * File: xeuledoc.js
 * Description: Google Documents and Drive OSINT intelligence gathering
 * Author: gl0bal01
 *
 * Discord wrapper around https://github.com/Malfrats/xeuledoc
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeSpawn } = require('../utils/process');
const { capField } = require('../utils/embed');
const logger = require('../utils/logger').child({ command: 'bob-xeuledoc' });

module.exports = {
    requiresTool: ['xeuledoc'],
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
                logger.error({ code, stderrBytes: (stderr ?? '').length }, 'xeuledoc exited with error');
                logger.debug({ stderr }, 'xeuledoc stderr');
                const embed = new EmbedBuilder()
                    .setTitle('Command Error')
                    .setDescription('xeuledoc encountered an error while processing the link.')
                    .setColor(0xffa500);
                return interaction.editReply({ embeds: [embed] });
            }

            if (stderr) {
                logger.debug({ stderr }, 'xeuledoc stderr');
            }

            const embed = new EmbedBuilder()
                .setTitle('xeuledoc Output')
                .setDescription(`\`\`\`\n${capField(stdout, 4000)}\n\`\`\``)
                .setColor(0x00ff00);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error({ err: error }, 'xeuledoc execution failed');
            const errorMsg = error.code === 'ENOENT'
                ? 'xeuledoc is not installed or not found in PATH. Please contact the administrator.'
                : 'An unexpected error occurred while running xeuledoc. Please try again later.';
            const embed = new EmbedBuilder()
                .setTitle('Execution Error')
                .setDescription(errorMsg)
                .setColor(0xff0000);
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
