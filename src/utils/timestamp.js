/**
 * Utility functions for handling Discord timestamps
 */

/**
 * Convert a Date object or timestamp to Discord's timestamp format
 * @param {Date|number} date - Date object or Unix timestamp in milliseconds
 * @param {string} format - Discord timestamp format (t, T, d, D, f, F, R)
 * @returns {string} Formatted Discord timestamp
 */
const formatDiscordTimestamp = (date, format = 'f') => {
    const timestamp = date instanceof Date ? Math.floor(date.getTime() / 1000) : Math.floor(date / 1000);
    return `<t:${timestamp}:${format}>`;
};

/**
 * Get relative time format for Discord
 * @param {Date|number} date - Date object or Unix timestamp in milliseconds
 * @returns {string} Relative time format
 */
const getRelativeTime = (date) => {
    return formatDiscordTimestamp(date, 'R');
};

/**
 * Get full date and time format for Discord
 * @param {Date|number} date - Date object or Unix timestamp in milliseconds
 * @returns {string} Full date and time format
 */
const getFullDateTime = (date) => {
    return formatDiscordTimestamp(date, 'F');
};

/**
 * Get short time format for Discord
 * @param {Date|number} date - Date object or Unix timestamp in milliseconds
 * @returns {string} Short time format
 */
const getShortTime = (date) => {
    return formatDiscordTimestamp(date, 't');
};

/**
 * Get a combined format with both exact time and relative countdown
 * @param {Date|number} date - Date object or Unix timestamp in milliseconds
 * @param {boolean} includeEmoji - Whether to include the clock emoji (default: true)
 * @returns {string} Formatted string with exact time and countdown
 */
const getTimeAndCountdown = (date, includeEmoji = true) => {
    const emoji = includeEmoji ? '⌛ ' : '';
    return `${emoji}${getShortTime(date)} (${getRelativeTime(date)})`;
};

module.exports = {
    formatDiscordTimestamp,
    getRelativeTime,
    getFullDateTime,
    getShortTime,
    getTimeAndCountdown
}; 