/**
 * File: utils/bootstrap.js
 * Description: Boot orchestration extracted from index.js
 * Responsibilities: command loading, guild whitelist parsing, boot temp sweep, shutdown handler factory
 */

const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

const HEALTH_DIR_NAME = '.health';
const SWEEP_EXCLUDE_DEFAULT = Object.freeze([HEALTH_DIR_NAME]);
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadCommands(commandsPath) {
    const commands = new Collection();
    const stats = { loaded: 0, skipped: 0, failed: 0 };

    if (!fs.existsSync(commandsPath)) {
        return { commands, stats };
    }

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                commands.set(command.data.name, command);
                stats.loaded++;
            } else {
                stats.skipped++;
            }
        } catch {
            stats.failed++;
        }
    }
    return { commands, stats };
}

function parseAllowedGuilds(envValue) {
    return String(envValue || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
}

function sweepBootTemp(tempDir, exclude = SWEEP_EXCLUDE_DEFAULT) {
    if (!fs.existsSync(tempDir)) return { swept: 0, kept: 0 };
    const excludeSet = new Set(exclude);
    const now = Date.now();
    let swept = 0, kept = 0;

    for (const file of fs.readdirSync(tempDir)) {
        if (excludeSet.has(file)) { kept++; continue; }
        const filePath = path.join(tempDir, file);
        try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > TEMP_MAX_AGE_MS) {
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
                swept++;
            } else {
                kept++;
            }
        } catch {
            // file vanished mid-sweep or permission denied — skip
        }
    }
    return { swept, kept };
}

function createShutdownHandler(client, hooks = {}) {
    let invoked = false;
    return function shutdown(signal) {
        if (invoked) return;
        invoked = true;
        if (typeof hooks.onSignal === 'function') {
            try { hooks.onSignal(signal); } catch { /* hook errors must not block shutdown */ }
        }
        for (const cmd of client.commands?.values?.() || []) {
            if (typeof cmd.shutdown === 'function') {
                try { cmd.shutdown(); } catch { /* command shutdown errors logged by hook */ }
            }
        }
        if (typeof hooks.onDrain === 'function') {
            try { Promise.resolve(hooks.onDrain()).catch(() => {}); } catch { /* hook errors must not block shutdown */ }
        }
        try { client.destroy(); } catch { /* already destroyed */ }
        setTimeout(() => process.exit(0), 1000).unref();
    };
}

module.exports = {
    loadCommands,
    parseAllowedGuilds,
    sweepBootTemp,
    createShutdownHandler,
    SWEEP_EXCLUDE_DEFAULT
};
