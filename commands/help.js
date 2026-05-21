/**
 * File: help.js
 * Description: Lists all registered slash commands with descriptions
 * Author: gl0bal01
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { RESTRICTED_COMMANDS } = require('../utils/permissions');
const { DESCRIPTION_LIMIT } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-help')
        .setDescription('List all available bob-* commands'),

    async execute(interaction) {
        const commands = [...interaction.client.commands.values()]
            .map(cmd => ({
                name: cmd.data.name,
                description: cmd.data.description ?? '',
                restricted: Object.prototype.hasOwnProperty.call(RESTRICTED_COMMANDS, cmd.data.name)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const lines = commands.map(c => `${c.restricted ? '🔒 ' : ''}\`/${c.name}\` — ${c.description}`);

        const embeds = [];
        let buffer = '';
        for (const line of lines) {
            const next = buffer ? `${buffer}\n${line}` : line;
            if (next.length > DESCRIPTION_LIMIT) {
                embeds.push(buffer);
                buffer = line;
            } else {
                buffer = next;
            }
        }
        if (buffer) embeds.push(buffer);

        const built = embeds.map((desc, i) => {
            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setDescription(desc);
            if (i === 0) {
                embed.setTitle(`Available Commands (${commands.length})`);
                embed.setFooter({ text: '🔒 = requires elevated permission' });
            }
            return embed;
        });

        await interaction.reply({ embeds: built, ephemeral: true });
    }
};
