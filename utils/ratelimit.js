/**
 * File: utils/ratelimit.js
 * Description: Per-user command rate limiting to prevent abuse
 */

// Default cooldowns in milliseconds per command category
const COOLDOWNS = {
    // Heavy commands that spawn external processes
    heavy: 30000, // 30 seconds
    // Medium commands that make API calls
    medium: 10000, // 10 seconds
    // Light commands
    light: 3000 // 3 seconds
};

// Map command names to categories
const COMMAND_CATEGORIES = {
    'bob-nuclei': 'heavy',
    'bob-sherlock': 'heavy',
    'bob-maigret': 'heavy',
    'bob-ghunt': 'heavy',
    'bob-xeuledoc': 'heavy',
    'bob-linkook': 'heavy',
    'bob-jwt': 'heavy',
    'bob-exif': 'medium',
    'bob-recon-web': 'medium',
    'bob-monitor': 'medium',
    'bob-redirect-check': 'medium',
    'bob-dns': 'medium',
    'bob-whoxy': 'medium',
    'bob-hostio': 'medium',
    'bob-pappers': 'medium',
    'bob-aviation': 'medium',
    'bob-rekognition': 'medium',
    'bob-chat': 'medium',
    'bob-blockchain': 'medium',
    'bob-favicons': 'medium',
    'bob-extract-links': 'medium',
    'bob-nike': 'medium'
};

// Global per-user daily limits
const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_DAILY) || 200;

// Storage: userId -> { commandName -> lastUsed timestamp }
const cooldowns = new Map();
// Storage: userId -> { date: 'YYYY-MM-DD', count: number }
const dailyCounts = new Map();

const MAX_TRACKED_USERS = 10000;

/**
 * Atomically check rate limit AND record usage if not limited.
 * Returns { limited, retryAfter?, reason? } — if not limited, usage is already recorded.
 * This prevents TOCTOU races where concurrent requests all pass the check.
 * @param {string} userId
 * @param {string} commandName
 * @returns {{ limited: boolean, retryAfter?: number, reason?: string }}
 */
function checkRateLimit(userId, commandName) {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // Check daily limit
    const daily = dailyCounts.get(userId);
    if (daily && daily.date === today && daily.count >= DAILY_LIMIT) {
        return { limited: true, reason: `Daily command limit (${DAILY_LIMIT}) reached. Try again tomorrow.` };
    }

    // Check per-command cooldown
    const category = COMMAND_CATEGORIES[commandName] || 'light';
    const cooldown = COOLDOWNS[category];
    const userCooldowns = cooldowns.get(userId);

    if (userCooldowns) {
        const lastUsed = userCooldowns.get(commandName);
        if (lastUsed && now - lastUsed < cooldown) {
            const retryAfter = Math.ceil((cooldown - (now - lastUsed)) / 1000);
            return { limited: true, retryAfter, reason: `Please wait ${retryAfter}s before using this command again.` };
        }
    }

    // Record usage atomically with the check to prevent concurrent bypass
    if (!cooldowns.has(userId)) {
        cooldowns.set(userId, new Map());
    }
    cooldowns.get(userId).set(commandName, now);

    if (daily && daily.date === today) {
        daily.count++;
    } else {
        dailyCounts.set(userId, { date: today, count: 1 });
    }

    // Prune if too many users tracked
    if (cooldowns.size > MAX_TRACKED_USERS) {
        const firstKey = cooldowns.keys().next().value;
        cooldowns.delete(firstKey);
    }
    if (dailyCounts.size > MAX_TRACKED_USERS) {
        const firstKey = dailyCounts.keys().next().value;
        dailyCounts.delete(firstKey);
    }

    return { limited: false };
}

/**
 * Record a command usage for rate limiting.
 * @param {string} userId
 * @param {string} commandName
 */
function recordUsage(userId, commandName) {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // Record cooldown
    if (!cooldowns.has(userId)) {
        cooldowns.set(userId, new Map());
    }
    cooldowns.get(userId).set(commandName, now);

    // Record daily count
    const daily = dailyCounts.get(userId);
    if (daily && daily.date === today) {
        daily.count++;
    } else {
        dailyCounts.set(userId, { date: today, count: 1 });
    }

    // Prune if too many users tracked
    if (cooldowns.size > MAX_TRACKED_USERS) {
        const firstKey = cooldowns.keys().next().value;
        cooldowns.delete(firstKey);
    }
    if (dailyCounts.size > MAX_TRACKED_USERS) {
        const firstKey = dailyCounts.keys().next().value;
        dailyCounts.delete(firstKey);
    }
}

module.exports = { checkRateLimit, recordUsage, COOLDOWNS, COMMAND_CATEGORIES };
