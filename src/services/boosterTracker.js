/**
 * @fileoverview Service for tracking booster states
 */

const { getTimeAndCountdown, getRelativeTime } = require('../utils/timestamp');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const BOOSTER_DURATION = 1800000; // 30 minutes in milliseconds
const CLEANUP_INTERVAL = 60000;   // Clean up every minute
const BOOSTER_STATE_FILE = path.join(__dirname, 'boosterState.json');

const BoosterTracker = {
    // All possible booster types
    BOOSTER_TYPES: ['xp', 'coin', 'bots', 'overflow', 'fishing', 'mining', 'farming'],
    
    // Active boosters map: type -> booster info
    activeBoosters: new Map(),

    // Valid multiplier values (except overflow which has no multiplier)
    VALID_MULTIPLIERS: [2.0, 2.2, 2.4, 2.6, 2.8, 3.0],

    /**
     * Format booster type for display
     * @param {string} type - Booster type
     * @returns {string} Formatted booster type
     */
    formatBoosterType(type) {
        return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() + ' Boost';
    },

    /**
     * Load booster state from file
     */
    loadState() {
        try {
            if (fs.existsSync(BOOSTER_STATE_FILE)) {
                const data = fs.readFileSync(BOOSTER_STATE_FILE, 'utf8');
                const state = JSON.parse(data);
                
                // Convert expiryTime to Date objects
                for (const [type, booster] of Object.entries(state)) {
                    if (booster && booster.expiryTime) {
                        this.activeBoosters.set(type, {
                            ...booster,
                            expiryTime: new Date(booster.expiryTime)
                        });
                    }
                }
                logger.info('Loaded booster state from file');
            }
        } catch (error) {
            logger.error('Error loading booster state:', error);
        }
    },

    /**
     * Save booster state to file
     */
    saveState() {
        try {
            const state = {};
            for (const [type, booster] of this.activeBoosters.entries()) {
                if (booster && booster.expiryTime) {
                    state[type] = {
                        ...booster,
                        expiryTime: booster.expiryTime instanceof Date ? 
                            booster.expiryTime.toISOString() : 
                            new Date(booster.expiryTime).toISOString()
                    };
                }
            }
            fs.writeFileSync(BOOSTER_STATE_FILE, JSON.stringify(state, null, 2));
        } catch (error) {
            logger.error('Error saving booster state:', error);
        }
    },

    /**
     * Initialize the booster tracker
     */
    initialize() {
        this.loadState();
        // Clean up expired boosters periodically
        setInterval(() => {
            this.cleanupExpiredBoosters();
            this.saveState();
        }, CLEANUP_INTERVAL);
        logger.info('Booster tracker initialized');
    },

    /**
     * Add or update a booster
     * @param {string} type - Booster type
     * @param {string} player - Player who activated
     * @param {number} [multiplier] - Booster multiplier (2.0-3.0 in 0.2 increments), optional for overflow
     * @returns {boolean} Whether the booster was successfully added
     */
    addBooster(type, player, multiplier = 2.0) {
        const normalizedType = this.normalizeBoosterType(type);
        
        // Validate booster type
        if (!this.BOOSTER_TYPES.includes(normalizedType)) {
            logger.warn(`Invalid booster type: ${type}`);
            return false;
        }

        // Validate multiplier for non-overflow boosters
        if (normalizedType !== 'overflow') {
            if (!this.VALID_MULTIPLIERS.includes(multiplier)) {
                logger.warn(`Invalid multiplier value: ${multiplier}. Using default 2.0x`);
                multiplier = 2.0;
            }
        }

        // Check if there's already an active booster of this type
        const existingBooster = this.activeBoosters.get(normalizedType);
        if (existingBooster && Date.now() < existingBooster.expiryTime) {
            logger.warn(`Booster of type ${normalizedType} is already active`);
            return false;
        }

        const startTime = Date.now();
        this.activeBoosters.set(normalizedType, {
            type: normalizedType,
            player: player.trim(),  // Ensure clean player name
            multiplier: normalizedType === 'overflow' ? null : multiplier,
            startTime,
            expiryTime: startTime + BOOSTER_DURATION
        });

        logger.info(`Booster added: ${normalizedType}${multiplier ? ` (${multiplier}x)` : ''} by ${player}`);
        return true;
    },

    /**
     * Remove a booster
     * @param {string} type - Booster type
     * @param {string} player - Player who activated
     * @returns {boolean} Whether the booster was successfully removed
     */
    removeBooster(type, player) {
        const normalizedType = this.normalizeBoosterType(type);
        const booster = this.activeBoosters.get(normalizedType);
        
        if (!booster) {
            logger.warn(`No active booster found of type: ${normalizedType}`);
            return false;
        }

        if (booster.player !== player.trim()) {
            logger.warn(`Player mismatch for booster removal: ${player} vs ${booster.player}`);
            return false;
        }

        this.activeBoosters.delete(normalizedType);
        logger.info(`Booster removed: ${normalizedType}${booster.multiplier ? ` (${booster.multiplier}x)` : ''} by ${player}`);
        return true;
    },

    /**
     * Clean up expired boosters
     */
    cleanupExpiredBoosters() {
        const now = Date.now();
        let cleaned = 0;

        for (const [type, booster] of this.activeBoosters.entries()) {
            if (now >= booster.expiryTime) {
                this.activeBoosters.delete(type);
                logger.info(`Booster expired: ${type}${booster.multiplier ? ` (${booster.multiplier}x)` : ''} by ${booster.player}`);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} expired boosters`);
        }
    },

    /**
     * Get all booster states
     * @returns {Object} Object containing active and inactive boosters
     */
    getBoosterStates() {
        this.cleanupExpiredBoosters();
        
        const active = [];
        const inactive = [];
        
        // Check each booster type
        for (const type of this.BOOSTER_TYPES) {
            const booster = this.activeBoosters.get(type);
            if (booster && Date.now() < booster.expiryTime) {
                active.push({
                    ...booster,
                    displayType: this.formatBoosterType(type),
                    timeRemaining: getRelativeTime(booster.expiryTime)
                });
            } else {
                inactive.push(this.formatBoosterType(type));
            }
        }

        return { active, inactive };
    },

    /**
     * Normalize booster type string
     * @param {string} type - Raw booster type
     * @returns {string} Normalized booster type
     */
    normalizeBoosterType(type) {
        return type.toLowerCase().trim();
    }
};

module.exports = BoosterTracker;