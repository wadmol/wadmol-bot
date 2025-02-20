const logger = require('./logger');
const { Client, GatewayIntentBits } = require('discord.js');

class DiscordUtils {
    constructor(discordClient) {
        this.discordClient = discordClient;
    }

    /**
     * Send a message to a Discord channel
     * @param {string} channelId - The ID of the channel to send the message to
     * @param {Object} options - The message options (e.g., embeds, content)
     * @returns {Promise<Message>} The sent message object
     */
    async sendToDiscord(channelId, options) {
        try {
            const channel = this.discordClient.channels.cache.get(channelId);
            if (!channel) {
                throw new Error(`Channel ${channelId} not found`);
            }
            const message = await channel.send(options);
            return message; // Ensure this is returned
        } catch (error) {
            logger.error('Error sending message to Discord:', error);
            throw error;
        }
    }
}

module.exports = DiscordUtils; 