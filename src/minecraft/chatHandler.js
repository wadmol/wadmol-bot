const PlayerDataStore = require('../utils/playerDataStore');
const PlayerTracker = require('../services/playerTracker');
const config = require('../utils/config');
const ChatParser = require('./chatParser');

module.exports = {
    sendToDiscord: null,

    initialize(sendToDiscord) {
        this.sendToDiscord = sendToDiscord;
    },

    handleChat(message) {
        const player = extractPlayerInfo(message);
        if (player) {
            PlayerDataStore.updatePlayer(player);
            if (PlayerDataStore.hasPlayerChanged(player)) {
                PlayerTracker.updatePlayerList();
            }

            // Skip if the message is already processed by ChatParser
            if (!message.startsWith('🟢') && !message.startsWith('🔴')) {
                // Extract the actual message content (remove the player info prefix)
                const messageContent = message.replace(/\[([^\]]+)-(\d+)\](?: \[([^\]]+)\])?(?: \[([^\]]+)\])? ([^:]+): /, '');

                // Forward message to lobby channel
                const embed = {
                    color: 0x7289DA,
                    description: `**[${player.prestige}-${player.level}] ${player.guild ? `[${player.guild}]` : ''} ${player.rank ? `[${player.rank}]` : ''} ${player.name}:** ${messageContent}`,
                    fields: []
                };
                this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
            }
        }

        // Forward message to chat parser only if it's not a lobby chat message
        if (!message.match(/\[([^\]]+)-(\d+)\](?: \[([^\]]+)\])?(?: \[([^\]]+)\])? ([^:]+):/)) {
            ChatParser.handleMessage(message);
        }
    }
};

function extractPlayerInfo(message) {
    const match = message.match(/\[([^\]]+)-(\d+)\](?: \[([^\]]+)\])?(?: \[([^\]]+)\])? ([^:]+):/);
    if (!match) return null;

    const [, prestige, level, guildTag, rank, name] = match;
    return {
        name,
        prestige,
        level: parseInt(level),
        guild: guildTag,
        rank,
        lastSeen: Date.now()
    };
} 