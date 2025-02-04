const config = require('../utils/config');
const logger = require('../utils/logger');

module.exports = {
    initialize(discordClient, commandBridge) {
        discordClient.on('messageCreate', async (message) => {
            try {
                // Log all message details for debugging
                logger.debug(`Received message object:`, {
                    id: message.id,
                    author: message.author?.username,
                    content: message.content,
                    channelId: message.channelId,
                    attachments: message.attachments.size,
                    embeds: message.embeds.length
                });

                // Ignore messages from bots and other channels
                if (message.author.bot || message.channelId !== config.discord.channels.privateMessenger) {
                    logger.debug(`Ignoring message from ${message.author?.username} in channel ${message.channelId}`);
                    return;
                }

                // Ensure message content exists
                if (!message.content || message.content.trim() === '') {
                    logger.warn('Received empty message content, checking for attachments');
                    if (message.attachments.size > 0) {
                        logger.info(`Message contains ${message.attachments.size} attachments`);
                    }
                    return;
                }

                // Log the full message details for debugging
                logger.debug(`Processing message: ${message.content} from ${message.author.username}`);

                // Send the raw message content to Minecraft
                await commandBridge.sendToMinecraft(message.content);
                logger.info(`Forwarded message to Minecraft: ${message.content}`);
            } catch (error) {
                logger.error('Error forwarding message to Minecraft:', error);
            }
        });
    }
}; 