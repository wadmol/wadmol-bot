/**
 * @fileoverview Service for monitoring and managing Pit lobbies
 */

const logger = require('../utils/logger');
const config = require('../utils/config');

const LobbyMonitor = {
    bot: null,
    currentLobby: null,
    hasToggledBots: false,
    players: new Set(),
    lastPlayCommand: 0,
    isInitializing: false,
    lastLobbyStatus: 0,
    reconnectAttempts: 0,
    MAX_RECONNECT_ATTEMPTS: config.timings.maxReconnectAttempts || 5,
    isLobbyTransition: false,

    /**
     * Initialize the lobby monitor
     * @param {Object} bot - Mineflayer bot instance
     * @param {Function} sendToDiscord - Function to send messages to Discord
     */
    initialize(bot, sendToDiscord) {
        this.bot = bot;
        this.sendToDiscord = sendToDiscord;
        this.setupErrorHandlers();
        this.setupAFKPrevention();
        this.reset();

        // Set up initial play command after spawn
        this.bot.once('spawn', () => {
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful spawn
            setTimeout(() => this.sendPlayCommand(), config.timings.initialPlayDelay);
        });

        // Set up periodic play command
        setInterval(() => {
            if (Date.now() - this.lastPlayCommand >= config.timings.playCommandInterval) {
                this.sendPlayCommand();
            }
        }, config.timings.playCommandInterval);

        // Set up player tracking with error handling
        this.bot.on('playerJoined', (player) => {
            try {
                if (!this.isInitializing && !this.isBot(player.username)) {
                    this.handlePlayerJoin(player.username);
                }
            } catch (error) {
                logger.error('Error handling player join:', error);
            }
        });

        this.bot.on('playerLeft', (player) => {
            try {
                if (!this.isInitializing && !this.isBot(player.username)) {
                    this.handlePlayerLeave(player.username);
                }
            } catch (error) {
                logger.error('Error handling player leave:', error);
            }
        });
    },

    /**
     * Set up error handlers for the bot
     */
    setupErrorHandlers() {
        // Handle general errors
        this.bot.on('error', error => {
            logger.error('Minecraft bot error:', error);
            this.handleDisconnect('error');
        });

        // Handle kicks
        this.bot.on('kicked', reason => {
            logger.error('Minecraft bot kicked:', reason);
            this.handleDisconnect('kicked');
        });

        // Handle disconnects
        this.bot.on('end', () => {
            logger.error('Minecraft bot disconnected');
            this.handleDisconnect('end');
        });

        // Handle entity errors
        process.on('uncaughtException', (error) => {
            if (error.message.includes('Cannot read properties of undefined (reading \'passengers\')')) {
                logger.error('Entity passenger error caught, attempting to recover...');
                this.handleDisconnect('entity error');
            } else {
                logger.error('Uncaught exception:', error);
                process.exit(1);
            }
        });
    },

    /**
     * Handle bot disconnection and attempt reconnection
     * @param {string} reason - Reason for disconnection
     */
    async handleDisconnect(reason) {
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            logger.error(`Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Exiting...`);
            process.exit(1);
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            config.timings.reconnectBackoffBase * Math.pow(2, this.reconnectAttempts), 
            60000 // max 1 minute
        );

        logger.info(`Attempting to reconnect in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

        setTimeout(() => {
            try {
                process.exit(0); // Clean exit to allow process manager to restart
            } catch (error) {
                logger.error('Error during reconnect:', error);
                process.exit(1);
            }
        }, delay);
    },

    /**
     * Send the play command to join a new lobby
     */
    async sendPlayCommand() {
        try {
            await this.bot.chat('/play pit');
            this.lastPlayCommand = Date.now();
            logger.info('Sent play command');
            this.reset(); // Reset state when changing lobbies
        } catch (error) {
            logger.error('Error sending play command:', error);
        }
    },

    /**
     * Check if a player is a bot/NPC
     * @param {string} username - Player username to check
     * @returns {boolean} True if the player is a bot/NPC
     */
    isBot(username) {
        // Don't filter out our own bot
        if (username === this.bot.username) return false;

        // Color code prefixes (§7, §e, etc.)
        if (username.includes('§')) return true;

        // CIT- pattern bots
        if (username.startsWith('CIT-')) return true;

        // NPC tags
        if (username.includes('[NPC]')) return true;

        // Common bot name patterns
        const botPatterns = [
            /^Bot/i,
            /^NPC-/i,
            /^vnL/i,
            /^[A-Z0-9]{8}$/,  // Random character sequences
            /^Pit(Bot|NPC)/i,
            /-[a-f0-9]{12}$/  // Hex suffix pattern
        ];

        return botPatterns.some(pattern => pattern.test(username));
    },

    /**
     * Handle new lobby join
     * @param {string} lobbyName - Name of the new lobby
     */
    async handleNewLobby(lobbyName) {
        logger.info(`Handling new lobby: ${lobbyName}`);
        this.isLobbyTransition = true; // Set transition flag
        this.currentLobby = lobbyName;
        this.isInitializing = true;
        this.players.clear();

        // Toggle bots off if not done yet
        if (!this.hasToggledBots) {
            await this.bot.chat('/togglebots');
            this.hasToggledBots = true;
            logger.info('Toggled bots off');
        }

        // Wait for player list to populate
        setTimeout(() => {
            this.scanPlayers(true);
            this.isInitializing = false;
            this.isLobbyTransition = false; // Clear transition flag

            // Send initial lobby status with debounce
            const now = Date.now();
            if (now - this.lastLobbyStatus >= 5000) { // 5-second debounce
                this.sendLobbyStatus();
                this.lastLobbyStatus = now;
            }
        }, config.timings.playerListDelay);
    },

    /**
     * Scan for players in the current lobby
     * @param {boolean} isInitialScan - Whether this is the initial scan
     */
    scanPlayers(isInitialScan = false) {
        const currentPlayers = new Set();
        let changes = false;

        Object.keys(this.bot.players).forEach(username => {
            if (!this.isBot(username)) {
                currentPlayers.add(username);
                if (!isInitialScan && !this.players.has(username)) {
                    changes = true;
                }
            }
        });

        // Only process joins/leaves if not initial scan
        if (!isInitialScan) {
            // Handle leaves
            for (const username of this.players) {
                if (!currentPlayers.has(username)) {
                    this.handlePlayerLeave(username);
                    changes = true;
                }
            }

            // Handle joins
            for (const username of currentPlayers) {
                if (!this.players.has(username)) {
                    this.handlePlayerJoin(username);
                    changes = true;
                }
            }
        }

        this.players = currentPlayers;

        // Send updated lobby status if there were changes
        if (changes && !isInitialScan) {
            const now = Date.now();
            if (now - this.lastLobbyStatus >= 5000) {
                this.sendLobbyStatus();
                this.lastLobbyStatus = now;
            }
        }

        logger.info(`Scanned players: ${this.players.size} players found`);
    },

    /**
     * Handle player join
     * @param {string} username - Username of joining player
     */
    handlePlayerJoin(username) {
        if (!this.isBot(username) && !this.isLobbyTransition) {
            this.players.add(username);
            if (!this.isInitializing) {
                logger.info(`Player joined: ${username}`);
                const embed = {
                    color: 0x00ff00,
                    author: {
                        name: "Player Update"
                    },
                    description: `🟢 ${username} joined the lobby`
                };
                this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
            }
        }
    },

    /**
     * Handle player leave
     * @param {string} username - Username of leaving player
     */
    handlePlayerLeave(username) {
        if (!this.isBot(username) && !this.isLobbyTransition) {
            this.players.delete(username);
            if (!this.isInitializing) {
                logger.info(`Player left: ${username}`);
                const embed = {
                    color: 0xff0000,
                    author: {
                        name: "Player Update"
                    },
                    description: `🔴 ${username} left the lobby`
                };
                this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
            }
        }
    },

    /**
     * Send lobby status to Discord
     */
    sendLobbyStatus() {
        const players = Array.from(this.players).sort();
        const embed = {
            color: 0x5865f2,
            title: "🎮 THE PIT - LOBBY STATUS",
            fields: [
                {
                    name: "Lobby",
                    value: this.currentLobby || 'Unknown',
                    inline: true
                },
                {
                    name: "Players",
                    value: players.length.toString(),
                    inline: true
                },
                {
                    name: "Current Players",
                    value: players.length > 0
                        ? players.map(player => `• ${player}`).join('\n')
                        : "No players in lobby",
                    inline: false
                }
            ]
        };

        this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
        logger.info('Sent lobby status update');
    },

    /**
     * Reset lobby monitor state
     */
    reset() {
        this.currentLobby = null;
        this.players.clear();
        this.isInitializing = false;
        this.lastPlayCommand = 0;
    },

    // Add AFK prevention
    setupAFKPrevention() {
        setInterval(() => {
            try {
                // Send a harmless command to prevent AFK
                this.bot.chat('/lobby');
                logger.debug('Sent AFK prevention command');
            } catch (error) {
                logger.error('Error sending AFK prevention command:', error);
            }
        }, config.timings.afkPreventionInterval);
    }
};

module.exports = LobbyMonitor; 