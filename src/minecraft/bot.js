const logger = require('../utils/logger');
const mineflayer = require('mineflayer');
const config = require('../utils/config');

class MinecraftBot {
    constructor() {
        this.bot = null;
        this.accountIndex = 0;
        this.reconnectTimeout = null;
    }

    /**
     * Initialize the Minecraft bot
     * @param {Object} bot - The Minecraft bot instance
     * @param {number} accountIndex - The index of the account to use
     */
    initialize(bot, accountIndex) {
        this.bot = bot;
        this.accountIndex = accountIndex;

        // Consolidate error logging
        const handleError = (error, type) => {
            logger.error(`Bot ${type}:`, error);
            this.scheduleReconnect();
        };

        this.bot.on('error', (error) => handleError(error, 'encountered an error'));
        this.bot.on('kicked', (reason) => handleError(reason, 'was kicked'));
        this.bot.on('end', () => handleError(new Error('disconnected'), 'disconnected'));
    }

    scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.reconnectTimeout = setTimeout(() => {
            this.reconnect();
        }, 5000);
    }

    reconnect() {
        if (this.bot) {
            this.bot.end();
        }

        const account = config.minecraft.accounts[this.accountIndex];
        if (!account) {
            logger.error(`Account index ${this.accountIndex} not found`);
            return;
        }

        this.bot = mineflayer.createBot({
            host: account.host,
            username: account.email,
            auth: account.auth,
            version: account.version
        });

        this.initialize(this.bot, this.accountIndex);
    }
}

module.exports = new MinecraftBot(); 