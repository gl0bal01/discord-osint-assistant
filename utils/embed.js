/**
 * Discord embed safety helpers — caps and ASCII-only sanitization
 * applied to third-party data before it lands in EmbedBuilder fields.
 */

const FIELD_VALUE_LIMIT = 1024;
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FOOTER_LIMIT = 2048;

/**
 * Truncate a value to fit a Discord embed field (1024 chars by default).
 * Coerces non-strings via String() to avoid TypeErrors when API responses
 * occasionally return numbers or null.
 */
function capField(value, limit = FIELD_VALUE_LIMIT) {
    return String(value ?? '').slice(0, limit);
}

/**
 * Render arbitrary bytes/strings as printable ASCII for embed display.
 * Replaces non-printable chars with '?' so coinbase scripts, raw memos,
 * and similar binary fields don't break embed rendering or smuggle
 * control characters into the client.
 */
function safeAscii(value, limit = FIELD_VALUE_LIMIT) {
    return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').slice(0, limit);
}

module.exports = {
    capField,
    safeAscii,
    FIELD_VALUE_LIMIT,
    TITLE_LIMIT,
    DESCRIPTION_LIMIT,
    FOOTER_LIMIT
};
