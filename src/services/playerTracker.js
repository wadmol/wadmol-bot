const PlayerDataStore = require('../utils/playerDataStore');
const { getRelativeTime } = require('../utils/timestamp');
const config = require('../utils/config');
const logger = require('../utils/logger');

class PlayerTracker {
    constructor() {
        this.messageId = null;
        this.sendToDiscord = null;
        this.lastUpdate = 0;
        this.updateInterval = 10000; // 10 seconds
        this.isInitializing = true;
        logger.info('PlayerTracker initialized');
    }

    initialize(sendToDiscord) {
        this.sendToDiscord = sendToDiscord;
        this.createPlayerListMessage();
    }

    async createPlayerListMessage() {
        try {
            const embeds = this.generateEmbed();
            const message = await this.sendToDiscord(config.discord.channels.playerList, { embeds });
            if (message) this.messageId = message.id;
        } catch (error) {
            logger.error('Error creating player list message:', error);
        }
    }

    /**
     * Update the player list and send it to Discord
     */
    async updatePlayerList() {
        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval && !this.isInitializing) {
            logger.debug('Skipping player list update (rate limit)');
            return;
        }
        this.lastUpdate = now;

        try {
            logger.debug('Generating player list embeds...');
            const [onlineEmbed, possiblyOnlineEmbed] = this.generateEmbed();

            // Validate embeds before sending
            if (!onlineEmbed || !possiblyOnlineEmbed) {
                throw new Error('Invalid embed generated');
            }

            logger.debug('Sending player list embeds to Discord...');
            await this.sendToDiscord(config.discord.channels.playerList, { 
                embeds: [onlineEmbed, possiblyOnlineEmbed], 
                messageId: this.messageId 
            });

            this.isInitializing = false;
            logger.info('Player list updated successfully');
        } catch (error) {
            logger.error('Error updating player list:', error);
        }
    }

    /**
     * Generate the player list embed
     * @returns {object} The embed object
     */
    generateEmbed() {
        const players = PlayerDataStore.getAllPlayers();
        const now = Date.now();
        const onlineThreshold = 2.5 * 60 * 1000; // 2.5 minutes
        const possiblyOnlineThreshold = 20 * 60 * 1000; // 5 minutes

        const onlinePlayers = players.filter(player => now - player.lastSeen <= onlineThreshold);
        const possiblyOnlinePlayers = players.filter(player => 
            now - player.lastSeen > onlineThreshold && now - player.lastSeen <= possiblyOnlineThreshold
        );

        const formatPlayer = (player) => {
            const prestigeLevel = player.prestige && player.level ? `[${player.prestige}-${player.level}]` : '';
            const guildTag = player.guild ? `[${player.guild}]` : '';
            const rank = player.rank ? `[${player.rank}]` : '';
            const timestamp = Math.floor(player.lastSeen / 1000); // Convert to Unix timestamp
            return `${prestigeLevel} ${guildTag} ${rank} ${player.name} • <t:${timestamp}:R>`;
        };

        const onlineEmbed = {
            color: 0x5865f2,
            title: '🎮 Online Players',
            description: onlinePlayers.length > 0 
                ? onlinePlayers.map(formatPlayer).join('\n') 
                : 'No players online',
            timestamp: new Date(),
            footer: {
                text: `Total Online Players: ${onlinePlayers.length}`
            }
        };

        const possiblyOnlineEmbed = {
            color: 0xf1c40f,
            title: '🕒 Possibly Online Players',
            description: possiblyOnlinePlayers.length > 0 
                ? possiblyOnlinePlayers.map(formatPlayer).join('\n') 
                : 'No possibly online players',
            timestamp: new Date(),
            footer: {
                text: `Total Possibly Online Players: ${possiblyOnlinePlayers.length}`
            }
        };

        return [onlineEmbed, possiblyOnlineEmbed];
    }

    /**
     * Generate embed for current lobby players
     * @returns {Object} Discord embed object
     */
    generateLobbyEmbed() {
        const players = PlayerDataStore.getAllPlayers();
        const now = Date.now();
        const onlineThreshold = 3 * 60 * 1000; // 3 minutes
        const possiblyOnlineThreshold = 5 * 60 * 1000; // 5 minutes
        const likelyOfflineThreshold = 20 * 60 * 1000; // 10 minutes

        const onlinePlayers = players.filter(player => 
            now - player.lastSeen <= onlineThreshold
        );

        const possiblyOnlinePlayers = players.filter(player => 
            now - player.lastSeen > onlineThreshold && 
            now - player.lastSeen <= possiblyOnlineThreshold
        );

        const likelyOfflinePlayers = players.filter(player => 
            now - player.lastSeen > possiblyOnlineThreshold && 
            now - player.lastSeen <= likelyOfflineThreshold
        );

        // Format player entry without "Last Seen:"
        const formatPlayer = (player) => {
            return `• ${player.name} • ${getRelativeTime(player.lastSeen)}`;
        };

        // Create separate messages for each category
        const messages = [];

        // Online Players Message
        if (onlinePlayers.length > 0) {
            messages.push({
                color: 0x5865f2,
                title: '🎮 Online Players',
                description: onlinePlayers.map(formatPlayer).join('\n'),
                timestamp: new Date(),
                footer: {
                    text: `Total Online Players: ${onlinePlayers.length}`
                }
            });
        }

        // Possibly Online Players Message
        if (possiblyOnlinePlayers.length > 0) {
            messages.push({
                color: 0x5865f2,
                title: '🎮 Possibly Online Players',
                description: possiblyOnlinePlayers.map(formatPlayer).join('\n'),
                timestamp: new Date(),
                footer: {
                    text: `Total Possibly Online Players: ${possiblyOnlinePlayers.length}`
                }
            });
        }

        // Likely Offline Players Message
        if (likelyOfflinePlayers.length > 0) {
            messages.push({
                color: 0x5865f2,
                title: '🎮 Likely Offline Players',
                description: likelyOfflinePlayers.map(formatPlayer).join('\n'),
                timestamp: new Date(),
                footer: {
                    text: `Total Likely Offline Players: ${likelyOfflinePlayers.length}`
                }
            });
        }

        // If no players in any category, send a single message
        if (messages.length === 0) {
            messages.push({
                color: 0x5865f2,
                title: '🎮 Player Tracker',
                description: 'No players tracked in the last 10 minutes',
                timestamp: new Date()
            });
        }

        // Log the total number of messages being sent
        logger.debug(`Total messages to send: ${messages.length}`);

        return messages;
    }
}

function filterAndFormatPlayers(players, now, thresholds) {
    const onlinePlayers = players.filter(p => now - p.lastSeen <= thresholds.online);
    const possiblyOnlinePlayers = players.filter(p => 
        now - p.lastSeen > thresholds.online && now - p.lastSeen <= thresholds.possiblyOnline
    );

    const formatPlayer = (player) => {
        const prestigeLevel = player.prestige && player.level ? `[${player.prestige}-${player.level}]` : '';
        const guildTag = player.guild ? `[${player.guild}]` : '';
        const rank = player.rank ? `[${player.rank}]` : '';
        const timestamp = Math.floor(player.lastSeen / 1000);
        return `${prestigeLevel} ${guildTag} ${rank} ${player.name} • <t:${timestamp}:R>`;
    };

    return { onlinePlayers, possiblyOnlinePlayers, formatPlayer };
}

module.exports = new PlayerTracker(); 