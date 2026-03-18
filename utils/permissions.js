const { PermissionFlagsBits } = require('discord.js');

const RESTRICTED_COMMANDS = {
    'bob-nuclei': PermissionFlagsBits.Administrator,
    'bob-monitor': PermissionFlagsBits.ManageGuild,
    'bob-rekognition': PermissionFlagsBits.ManageGuild,
    'bob-jwt': PermissionFlagsBits.ManageGuild,
    'bob-ghunt': PermissionFlagsBits.ManageGuild,
    'bob-sherlock': PermissionFlagsBits.ManageGuild,
    'bob-maigret': PermissionFlagsBits.ManageGuild
};

function getAllowedRoles() {
    const roleIds = process.env.OSINT_ALLOWED_ROLES;
    return roleIds ? roleIds.split(',').map(id => id.trim()) : [];
}

function checkPermission(interaction) {
    const commandName = interaction.commandName;
    const requiredPerm = RESTRICTED_COMMANDS[commandName];
    if (!requiredPerm) return { allowed: true };
    if (!interaction.guild) {
        return { allowed: false, reason: 'This command can only be used in a server.' };
    }
    if (interaction.memberPermissions?.has(requiredPerm)) {
        return { allowed: true };
    }
    const allowedRoles = getAllowedRoles();
    if (allowedRoles.length > 0 && interaction.member?.roles?.cache?.some(role => allowedRoles.includes(role.id))) {
        return { allowed: true };
    }
    return { allowed: false, reason: 'You do not have permission to use this command.' };
}

module.exports = { checkPermission, RESTRICTED_COMMANDS };
