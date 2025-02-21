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
    const now = Date.now();
    const diff = now - date;

    if (diff < 60 * 1000) {
        return `${Math.floor(diff / 1000)} sec`;
    } else if (diff < 60 * 60 * 1000) {
        return `${Math.floor(diff / (60 * 1000))} min`;
    } else if (diff < 24 * 60 * 60 * 1000) {
        return `${Math.floor(diff / (60 * 60 * 1000))} hr`;
    } else {
        return `${Math.floor(diff / (24 * 60 * 60 * 1000))} day`;
    }
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

function sendToDiscord(channelId, messageData) {
    const channel = discordClient.channels.cache.get(channelId);
    if (!channel) {
        logger.error(`Channel ${channelId} not found`);
        return;
    }

    // Add timestamp to the embed if it's not already present
    if (messageData.embeds && messageData.embeds.length > 0) {
        messageData.embeds.forEach(embed => {
            if (!embed.timestamp) {
                embed.timestamp = new Date().toISOString();
            }
        });
    }

    // Send or update the message
    if (messageData.messageId) {
        return channel.messages.fetch(messageData.messageId)
            .then(message => message.edit(messageData))
            .catch(error => {
                logger.error('Error updating message:', error);
                return channel.send(messageData);
            });
    } else {
        return channel.send(messageData);
    }
}

module.exports = {
    formatDiscordTimestamp,
    getRelativeTime,
    getFullDateTime,
    getShortTime,
    getTimeAndCountdown,
    sendToDiscord
}; 