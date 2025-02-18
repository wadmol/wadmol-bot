/**
 * @fileoverview Service for tracking player history and statistics
 */

const logger = require('../utils/logger');
const { getRelativeTime, getFullDateTime } = require('../utils/timestamp');

class TaggedHarrysHistory {
    constructor() {
        this.players = new Map();
        this.CLEANUP_INTERVAL = 3600000; // 1 hour
        this.initializeCleanup();
    }

    /**
     * Initialize cleanup interval
     */
    initializeCleanup() {
        setInterval(() => this.cleanupOldData(), this.CLEANUP_INTERVAL);
    }

    /**
     * Add or update player information
     * @param {Object} data Player data
     */
    updatePlayer(data) {
        const { name, clanTag, prestige, level, lobby } = data;
        const now = Date.now();

        if (!name) {
            logger.warn('Attempted to update player without name');
            return;
        }

        const existingPlayer = this.players.get(name) || {
            name,
            clanTag: null,
            prestige: null,
            level: null,
            lastSeen: null,
            lastLobby: null,
            messageCount: 0,
            sightings: {
                total: 0,
                last7Days: 0,
                last30Days: 0,
                timestamps: []
            },
            timeSpentTogether: 0,
            firstSeen: now
        };

        // Update only provided fields
        if (clanTag) existingPlayer.clanTag = clanTag;
        if (prestige) existingPlayer.prestige = prestige;
        if (level) existingPlayer.level = level;
        if (lobby) existingPlayer.lastLobby = lobby;

        // Update timestamps and counters
        existingPlayer.lastSeen = now;
        existingPlayer.sightings.timestamps.push(now);
        
        // Update sighting counters
        this.updateSightingCounters(existingPlayer);

        this.players.set(name, existingPlayer);
        logger.debug(`Updated player data for ${name}`);
    }

    /**
     * Increment message count for a player
     * @param {string} name Player name
     */
    incrementMessageCount(name) {
        const player = this.players.get(name);
        if (player) {
            player.messageCount++;
            this.players.set(name, player);
        }
    }

    /**
     * Update time spent together for a player
     * @param {string} name Player name
     * @param {number} time Time in milliseconds
     */
    updateTimeSpentTogether(name, time) {
        const player = this.players.get(name);
        if (player) {
            player.timeSpentTogether += time;
            this.players.set(name, player);
        }
    }

    /**
     * Update sighting counters for a player
     * @param {Object} player Player object
     */
    updateSightingCounters(player) {
        const now = Date.now();
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        // Clean old timestamps
        player.sightings.timestamps = player.sightings.timestamps.filter(
            timestamp => timestamp >= thirtyDaysAgo
        );

        // Update counters
        player.sightings.total = player.sightings.timestamps.length;
        player.sightings.last7Days = player.sightings.timestamps.filter(
            timestamp => timestamp >= sevenDaysAgo
        ).length;
        player.sightings.last30Days = player.sightings.timestamps.length;
    }

    /**
     * Get player information
     * @param {string} name Player name
     * @returns {Object|null} Player data
     */
    getPlayer(name) {
        return this.players.get(name) || null;
    }

    /**
     * Get all players sorted by last seen
     * @returns {Array} Sorted player array
     */
    getAllPlayers() {
        return Array.from(this.players.values())
            .sort((a, b) => b.lastSeen - a.lastSeen);
    }

    /**
     * Format time duration
     * @param {number} ms Time in milliseconds
     * @returns {string} Formatted time
     */
    formatDuration(ms) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    }

    /**
     * Generate Discord embed for player list
     * @returns {Object} Discord embed object
     */
    generateEmbed() {
        const players = this.getAllPlayers();
        const fields = [];

        for (const player of players) {
            const clanTag = player.clanTag ? `[${player.clanTag}] ` : '';
            const prestigeLevel = player.prestige && player.level ? 
                `[${player.prestige}-${player.level}] ` : '';
            
            fields.push({
                name: `${clanTag}${prestigeLevel}${player.name}`,
                value: [
                    `Last Seen: ${getRelativeTime(player.lastSeen)}`,
                    `Lobby: ${player.lastLobby || 'Unknown'}`,
                    `Sightings: 7d: ${player.sightings.last7Days} | 30d: ${player.sightings.last30Days}`,
                    `Messages: ${player.messageCount}`,
                    `Time Together: ${this.formatDuration(player.timeSpentTogether)}`
                ].join(' • '),
                inline: false
            });
        }

        return {
            color: 0x5865f2,
            title: '🎮 Player List',
            fields: fields.slice(0, 25), // Discord limit
            timestamp: new Date(),
            footer: {
                text: `Total Players Tracked: ${this.players.size}`
            }
        };
    }

    /**
     * Clean up old player data
     */
    cleanupOldData() {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        let cleaned = 0;

        for (const [name, player] of this.players.entries()) {
            if (player.lastSeen < thirtyDaysAgo) {
                this.players.delete(name);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} inactive players`);
        }
    }
}

module.exports = new TaggedHarrysHistory();