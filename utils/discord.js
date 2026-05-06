/**
 * Discord-specific safety helpers shared across commands.
 */

/**
 * Strip Discord mass-mention and role-mention syntax from third-party text
 * (LLM output, scraped data, API responses). Defense-in-depth on top of
 * the bot-level `allowedMentions` setting.
 *
 * @param {*} text
 * @returns {*} sanitized string, or the original value if not a string
 */
function neutralizeMentions(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/@everyone/gi, '@​everyone')
        .replace(/@here/gi, '@​here')
        .replace(/<@&(\d+)>/g, '<@​&$1>');
}

module.exports = { neutralizeMentions };
