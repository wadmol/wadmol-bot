const logger = require('../utils/logger');
const TaggedHarrysHistory = require('./taggedHarrysHistory');
const { getRelativeTime } = require('../utils/timestamp');
const config = require('../utils/config');

class PlayerTracker {
    constructor() {
        this.messageId = null; // Store the Discord message ID for editing
    }

    /**
     * Initialize the player tracker
     * @param {Function} sendToDiscord - Function to send messages to Discord
     */
    initialize(sendToDiscord) {
        this.sendToDiscord = sendToDiscord;
        this.createPlayerListMessage();
    }

    /**
     * Create the initial player list message in Discord
     */
    async createPlayerListMessage() {
        try {
            const embed = this.generateEmbed();
            const message = await this.sendToDiscord(config.discord.channels.playerList, { embeds: [embed] });
            if (!message) {
                throw new Error('Failed to send player list message: No message returned');
            }
            this.messageId = message.id; // Store the message ID for future edits
        } catch (error) {
            logger.error('Error creating player list message:', error);
        }
    }

    /**
     * Generate the player list embed
     * @returns {Object} Discord embed object
     */
    generateEmbed() {
        const players = TaggedHarrysHistory.getAllPlayers();
        const now = Date.now();
        const onlineThreshold = 5 * 60 * 1000; // 5 minutes
        const possiblyOnlineThreshold = 20 * 60 * 1000; // 20 minutes

        // Get current lobby players
        const currentLobbyPlayers = players.filter(player => 
            now - player.lastSeen <= onlineThreshold
        );

        // Get all online players (including those from chat/join/leave events)
        const onlinePlayers = players.filter(player => 
            now - player.lastSeen <= onlineThreshold
        );

        // Combine and deduplicate players, prioritizing current lobby data
        const combinedOnlinePlayers = Array.from(new Set([
            ...currentLobbyPlayers,
            ...onlinePlayers
        ]));

        const possiblyOnlinePlayers = players.filter(
            player => now - player.lastSeen > onlineThreshold && 
                     now - player.lastSeen <= possiblyOnlineThreshold
        );

        const formatPlayer = (player) => {
            const clanTag = player.clanTag ? `[${player.clanTag}] ` : '';
            const prestigeLevel = player.prestige && player.level ? `[${player.prestige}-${player.level}] ` : '';
            return `${prestigeLevel}${clanTag}${player.name} • Last Seen: ${getRelativeTime(player.lastSeen)}`;
        };

        return {
            color: 0x5865f2,
            title: '🎮 Player Tracker',
            fields: [
                {
                    name: '**Online**',
                    value: combinedOnlinePlayers.length > 0 
                        ? combinedOnlinePlayers.map(formatPlayer).join('\n') 
                        : 'No players online',
                    inline: false
                },
                {
                    name: '**Possibly Online**',
                    value: possiblyOnlinePlayers.length > 0 
                        ? possiblyOnlinePlayers.map(formatPlayer).join('\n') 
                        : 'No players possibly online',
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: {
                text: `Total Players Tracked: ${players.length}`
            }
        };
    }

    /**
     * Update the player list message in Discord
     */
    async updatePlayerList() {
        try {
            const embed = this.generateEmbed();
            await this.sendToDiscord(config.discord.channels.playerList, { embeds: [embed], messageId: this.messageId });
        } catch (error) {
            logger.error('Error updating player list:', error);
        }
    }

    /**
     * Generate embed for current lobby players
     * @returns {Object} Discord embed object
     */
    generateLobbyEmbed() {
        const players = TaggedHarrysHistory.getAllPlayers();
        const now = Date.now();
        const onlineThreshold = 5 * 60 * 1000; // 5 minutes

        const onlinePlayers = players.filter(player => 
            now - player.lastSeen <= onlineThreshold
        );

        return {
            color: 0x5865f2,
            title: '🎮 Current Lobby Players',
            description: onlinePlayers.length > 0 
                ? onlinePlayers.map(player => `• ${player.name}`).join('\n')
                : 'No players in lobby',
            timestamp: new Date(),
            footer: {
                text: `Total Players: ${onlinePlayers.length}`
            }
        };
    }
}

module.exports = new PlayerTracker(); 