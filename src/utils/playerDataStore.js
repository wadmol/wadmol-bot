const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class PlayerDataStore {
    constructor() {
        this.filePath = path.join(__dirname, '../data/playerData.json');
        this.ensureDataDirectoryExists();
        this.players = this.loadData();
    }

    ensureDataDirectoryExists() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    loadData() {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
            return [];
        } catch (error) {
            logger.error('Error loading player data:', error);
            return [];
        }
    }

    saveData() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.players, null, 2));
        } catch (error) {
            logger.error('Error saving player data:', error);
        }
    }

    updatePlayer(playerData) {
        // Normalize player name by removing the ♚ symbol
        const normalizedName = playerData.name.replace(/♚/g, '').trim();

        // Find existing player by normalized name
        const existingPlayer = this.players.find(p => p.name.replace(/♚/g, '').trim() === normalizedName);

        if (existingPlayer) {
            // Update existing player data
            Object.assign(existingPlayer, playerData);

            // Update the ♚ status based on the new data
            if (playerData.name.includes('♚')) {
                existingPlayer.name = `${normalizedName} ♚`;
            } else {
                existingPlayer.name = normalizedName;
            }
        } else {
            // Add new player data
            if (playerData.name.includes('♚')) {
                playerData.name = `${normalizedName} ♚`;
            } else {
                playerData.name = normalizedName;
            }
            this.players.push(playerData);
        }

        // Save updated player data
        this.saveData();
    }

    /**
     * Check if a player's data has changed
     * @param {Object} player - Player data to check
     * @returns {boolean} True if the player's data has changed
     */
    hasPlayerChanged(player) {
        const existingPlayer = this.players.find(p => p.name === player.name);
        if (!existingPlayer) return true; // New player

        // Compare relevant fields
        return (
            player.prestige !== existingPlayer.prestige ||
            player.level !== existingPlayer.level ||
            player.guild !== existingPlayer.guild ||
            player.rank !== existingPlayer.rank ||
            player.lobby !== existingPlayer.lobby
        );
    }

    getAllPlayers() {
        return this.players;
    }
}

module.exports = new PlayerDataStore(); 