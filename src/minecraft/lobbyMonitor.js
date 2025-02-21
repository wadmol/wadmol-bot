/**
 * @fileoverview Service for monitoring and managing Pit lobbies
 */

const logger = require('../utils/logger');
const config = require('../utils/config');
const PlayerTracker = require('../services/playerTracker');
const PlayerDataStore = require('../utils/playerDataStore');
const ChatHandler = require('./chatHandler');

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
    lobbyMessageId: null,
    isScanning: false,

    /**
     * Initialize the lobby monitor
     * @param {Object} bot - Mineflayer bot instance
     * @param {Function} sendToDiscord - Function to send messages to Discord
     */
    initialize(bot, sendToDiscord) {
        this.bot = bot;
        this.sendToDiscord = sendToDiscord;
        
        // Initialize PlayerTracker
        PlayerTracker.initialize(sendToDiscord);
        
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

        // Listen for lobby change messages
        this.bot.on('message', (message) => {
            const text = message.toString().trim();
            if (text.includes('Sending you to')) {
                const lobbyName = text.match(/Sending you to (.+?)!/)?.[1];
                if (lobbyName) {
                    logger.debug(`Detected lobby change to: ${lobbyName}`);
                    this.handleNewLobby(lobbyName);
                }
            }
        });

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
            logger.error('Uncaught exception:', error);
            if (error.message.includes('Cannot read properties of undefined') || 
                error.message.includes('passengers') || 
                error.message.includes('entity')) {
                logger.error('Entity-related error caught, attempting to recover...');
                this.handleDisconnect('entity error');
            } else {
                logger.error('Critical uncaught exception, exiting...');
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

        // Add automatic retry every 5 minutes after the initial reconnect logic
        setTimeout(() => {
            logger.info('Server might be down for updates. Retrying in 5 minutes...');
            this.handleDisconnect('retry');
        }, delay + 300000); // 5 minutes after the initial delay
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
        logger.debug(`Checking if ${username} is a bot/NPC...`);

        // Don't filter out our own bot
        if (username === this.bot.username) {
            logger.debug(`${username} is the bot itself, not a bot/NPC`);
            return false;
        }

        // Color code prefixes (§7, §e, etc.)
        if (username.includes('§')) {
            logger.debug(`${username} is a bot/NPC (contains color code)`);
            return true;
        }

        // CIT- pattern bots
        if (username.startsWith('CIT-')) {
            logger.debug(`${username} is a bot/NPC (CIT- pattern)`);
            return true;
        }

        // NPC tags
        if (username.includes('[NPC]')) {
            logger.debug(`${username} is a bot/NPC (contains [NPC] tag)`);
            return true;
        }

        // Common bot name patterns
        const botPatterns = [
            /^Bot/i,          // Starts with "Bot"
            /^NPC-/i,         // Starts with "NPC-"
            /^vnL/i,          // Starts with "vnL"
            /^[A-Z0-9]{8}$/,  // Random character sequences (e.g., "ABCD1234")
            /^Pit(Bot|NPC)/i, // Starts with "PitBot" or "PitNPC"
            /-[a-f0-9]{12}$/  // Hex suffix pattern (e.g., "Player-123abc456def")
        ];

        // Check if the username matches any bot pattern
        const isBot = botPatterns.some(pattern => pattern.test(username));
        if (isBot) {
            logger.debug(`${username} is a bot/NPC (matches bot pattern)`);
        } else {
            logger.debug(`${username} is not a bot/NPC`);
        }

        return isBot;
    },

    /**
     * Handle new lobby join
     * @param {string} lobbyName - Name of the new lobby
     */
    async handleNewLobby(lobbyName) {
        if (this.currentLobby === lobbyName) return; // Skip if lobby hasn't changed
        logger.info(`Handling new lobby: ${lobbyName}`);
        this.currentLobby = lobbyName; // Update the current lobby
        this.isLobbyTransition = true; // Set transition flag
        this.isInitializing = true; // Set initialization flag
        this.players.clear(); // Clear player list
        logger.debug(`Flags set: isLobbyTransition=${this.isLobbyTransition}, isInitializing=${this.isInitializing}`);

        // Toggle bots off if not done yet
        if (!this.hasToggledBots) {
            await this.bot.chat('/togglebots');
            this.hasToggledBots = true;
            logger.info('Toggled bots off');
        }

        // Wait for player list to populate
        setTimeout(() => {
            this.scanPlayers(true);
            this.isInitializing = false; // Clear initialization flag
            this.isLobbyTransition = false; // Clear transition flag
            logger.debug(`Flags cleared: isLobbyTransition=${this.isLobbyTransition}, isInitializing=${this.isInitializing}`);

            // Send initial lobby status
            this.sendLobbyStatus();

            // Update player tracker
            PlayerTracker.updatePlayerList();
        }, config.timings.playerListDelay);
    },

    /**
     * Scan for players in the current lobby
     * @param {boolean} isInitialScan - Whether this is the initial scan
     */
    scanPlayers(isInitialScan = false) {
        if (this.isScanning) return; // Skip if already scanning
        this.isScanning = true;

        const currentPlayers = new Set();
        let changes = false;

        Object.keys(this.bot.players).forEach(username => {
            if (!this.isBot(username)) {
                currentPlayers.add(username);
                if (!isInitialScan && !this.players.has(username)) {
                    changes = true;
                    this.handlePlayerJoin(username);
                }
            }
        });

        // Update player data for all current players
        currentPlayers.forEach(username => {
            PlayerDataStore.updatePlayer({
                name: username,
                lobby: this.currentLobby,
                lastSeen: Date.now()
            });
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
        this.isScanning = false;

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
        if (!this.isBot(username) && !this.isInitializing && !this.isLobbyTransition) {
            logger.debug(`Player joined: ${username}`);
            this.players.add(username);
            
            // Update player data
            PlayerDataStore.updatePlayer({
                name: username,
                lobby: this.currentLobby,
                lastSeen: Date.now()
            });

            logger.info(`Player joined: ${username}`);
            ChatHandler.handleChat(`🟢 ${username} joined the lobby`);
        } else {
            logger.debug(`Ignoring join for ${username} (bot, during initialization, or lobby transition)`);
        }
    },

    /**
     * Handle player leave
     * @param {string} username - Username of leaving player
     */
    handlePlayerLeave(username) {
        if (!this.isBot(username) && !this.isInitializing && !this.isLobbyTransition) {
            logger.debug(`Player left: ${username}`);
            this.players.delete(username);
            
            // Update player data
            PlayerDataStore.updatePlayer({
                name: username,
                lobby: null,
                lastSeen: Date.now()
            });

            logger.info(`Player left: ${username}`);
            const embed = {
                color: 0xff0000,
                author: {
                    name: "Player Update"
                },
                description: `🔴 ${username} left the lobby`
            };
            this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
        } else {
            logger.debug(`Ignoring leave for ${username} (bot, during initialization, or lobby transition)`);
        }
    },

    /**
     * Send lobby status to Discord
     */
    sendLobbyStatus() {
        const players = Array.from(this.players).sort();
        const playerList = players.length > 0
            ? players.map(player => `• ${player}`).join('\n')
            : "No players in lobby";

        // Split player list into chunks of 1024 characters
        const playerChunks = [];
        let currentChunk = '';
        for (const player of players) {
            const playerEntry = `• ${player}\n`;
            if (currentChunk.length + playerEntry.length > 1024) {
                playerChunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += playerEntry;
        }
        if (currentChunk.length > 0) {
            playerChunks.push(currentChunk);
        }

        // Create embed with player chunks
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
                }
            ]
        };

        // Add player chunks as separate fields
        playerChunks.forEach((chunk, index) => {
            embed.fields.push({
                name: index === 0 ? "Current Players" : "\u200b", // Use zero-width space for subsequent fields
                value: chunk,
                inline: false
            });
        });

        // Send or update the lobby status message
        this.sendToDiscord(config.discord.channels.lobby, { 
            embeds: [embed], 
            messageId: this.lobbyMessageId // Include the message ID to update the existing message
        }).then(message => {
            if (message) {
                this.lobbyMessageId = message.id; // Update the message ID for future updates
            }
        });

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