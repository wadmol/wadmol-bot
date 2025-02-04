/**
 * @fileoverview Service for parsing and handling Pit chat messages
 */

const logger = require('../utils/logger');
const config = require('../utils/config');
const { getRelativeTime, getFullDateTime, getTimeAndCountdown } = require('../utils/timestamp');
const BoosterTracker = require('../services/boosterTracker');

const ChatParser = {
    // Chat message patterns
    patterns: {
        boosterChat: /WOAH! \[\d+\] (\w+) (?:just )?activated a (\w+) booster! GG!/i,  // Case insensitive, "just" is now optional
        boosterTitle: /(\d+(?:\.\d+)?x)/,  // Matches multiplier format (e.g., 2.0x, 3x)
        boosterExpire: /(\w+)'s (?:([\d.]+)x )?(\w+) (?:boost(?:er)?|boost) expired!/i,
        event: {
            major: {
                starting: /MAJOR EVENT! ([^!]+?) starting in (\d+) minutes/,
                startingNow: /MAJOR EVENT! ([^!]+?) starting now/,
                ended: /PIT EVENT ENDED: ([^!]+?)!/
            },
            minor: {
                harvestStart: /MINOR EVENT! HARVEST SEASON!/,
                harvestEnd: /MINOR EVENT! HARVEST SEASON ended/,
                auctionStart: /MINOR EVENT! AUCTION! Check your chat!/,
                auctionEnd: /MINOR EVENT! AUCTION ending now/
            }
        },
        prestige: /PRESTIGE! (\w+) unlocked prestige ([\w ]+), gg!/,
        lobby: /MOVING! Sending you to (\w+)/,
        // Add patterns for /events command response
        eventsCommand: {
            major: /EVENTS! Next Major Event: ([^!]+?) in (\d+m\d+s|\d+s)/,
            minor: /EVENTS! Next Minor Event: ([^!]+?) in (\d+m\d+s|\d+s)/
        },
        // Add verification message pattern
        verifyMessage: /(\w+) -> you: (\d{6})/,
        guildChat: /Guild > \[(\w+)\] (\w+): (.+)/,
        guildKill: /\[GKILLS\] \[(\d+)\] (\w+) Killed \[(\d+)\] (\w+)/,
        lobbyChat: /^\[([A-Z]+)-(\d+)\] (?:\[([A-Z]{1,4})\])? (?:\[(VIP|MVP\+?)\])? (\w+): (.+)$/
    },

    // Event status emojis
    eventEmojis: {
        MAJOR: '🔥',
        MINOR: '📢',
        status: {
            starting: '⌛',
            active: '▶️',
            ended: '⏹️'
        }
    },

    // Track active events to prevent duplicates
    activeEvents: new Map(),
    lastEventsCommand: null,

    // Store pending booster activation for title matching
    pendingBooster: null,
    pendingBoosterTimeout: null,
    PENDING_BOOSTER_TTL: 1000, // 1 seconds to match title with chat

    // Track last ping time for booster role
    lastBoosterExpirePing: 0,
    BOOSTER_PING_COOLDOWN: 300000, // 5 minutes in milliseconds (changed from 1 minute)

    // Boosters that should trigger role pings
    PING_BOOSTER_TYPES: ['bots', 'mining', 'farming', 'fishing', 'overflow'],

    /**
     * Initialize the chat parser
     * @param {Function} sendToDiscord - Function to send messages to Discord
     * @param {Object} lobbyMonitor - Reference to the lobby monitor service
     * @param {Object} commandBridge - Reference to the command bridge
     */
    initialize(sendToDiscord, lobbyMonitor, commandBridge) {
        this.sendToDiscord = sendToDiscord;
        this.lobbyMonitor = lobbyMonitor;
        this.commandBridge = commandBridge;

        // Clean up old events every minute
        setInterval(() => this.cleanupOldEvents(), 60000);

        // Set up title event handler if bot has one
        if (this.lobbyMonitor && this.lobbyMonitor.bot) {
            this.lobbyMonitor.bot.on('title', (title) => {
                this.handleTitleMessage(title);
            });
        }
    },

    /**
     * Clean up events older than 5 minutes
     */
    cleanupOldEvents() {
        const fiveMinutesAgo = Date.now() - 300000; // 5 minutes
        for (const [key, event] of this.activeEvents.entries()) {
            if (event.timestamp < fiveMinutesAgo) {
                this.activeEvents.delete(key);
            }
        }
    },

    /**
     * Parse and handle a chat message
     * @param {string} message - Raw chat message
     */
    handleMessage(message) {
        try {
            logger.debug(`Processing chat message: ${message}`);

            // Add new handlers at the beginning
            if (this.handleLobbyChatMessage(message)) return;
            if (this.handleGuildChatMessage(message)) return;
            if (this.handleGuildKillMessage(message)) return;

            // Add verification message handling
            if (this.handleVerificationMessage(message)) {
                logger.debug('Handled as verification message');
                return;
            }

            // Check for /events command response first
            if (this.handleEventsCommandResponse(message)) {
                logger.debug('Handled as events command response');
                return;
            }

            // Check for event end first (different format)
            if (this.handleEventEndMessage(message)) {
                logger.debug('Handled as event end message');
                return;
            }

            // Try each message type
            if (this.handleBoosterMessage(message)) return;
            if (this.handleEventMessage(message)) return;
            if (this.handlePrestigeMessage(message)) return;
            if (this.handleLobbyMessage(message)) return;

        } catch (error) {
            logger.error('Error parsing chat message:', error);
        }
    },

    /**
     * Convert time string to milliseconds
     * @param {string} timeStr - Time string (e.g., "38m0s" or "10s")
     * @returns {number} Milliseconds
     */
    parseTimeToMs(timeStr) {
        let totalMs = 0;
        const minutes = timeStr.match(/(\d+)m/);
        const seconds = timeStr.match(/(\d+)s/);

        if (minutes) totalMs += parseInt(minutes[1]) * 60000;
        if (seconds) totalMs += parseInt(seconds[1]) * 1000;

        return totalMs;
    },

    /**
     * Handle /events command response
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleEventsCommandResponse(message) {
        const majorMatch = message.match(this.patterns.eventsCommand.major);
        const minorMatch = message.match(this.patterns.eventsCommand.minor);

        if (!majorMatch && !minorMatch) return false;

        // Store event info
        if (!this.lastEventsCommand) {
            this.lastEventsCommand = {
                timestamp: Date.now(),
                events: {}
            };
        }

        const now = Date.now();

        if (majorMatch) {
            const timeMs = this.parseTimeToMs(majorMatch[2]);
            this.lastEventsCommand.events.major = {
                name: majorMatch[1],
                time: majorMatch[2],
                timestamp: now + timeMs
            };
        }

        if (minorMatch) {
            const timeMs = this.parseTimeToMs(minorMatch[2]);
            this.lastEventsCommand.events.minor = {
                name: minorMatch[1],
                time: minorMatch[2],
                timestamp: now + timeMs
            };
        }

        // If we have both events or 500ms has passed, send the response
        if (this.lastEventsCommand.events.major && this.lastEventsCommand.events.minor ||
            Date.now() - this.lastEventsCommand.timestamp > 500) {

            const embed = {
                color: 0x00ff00,
                title: '📅 Upcoming Events',
                fields: []
            };

            if (this.lastEventsCommand.events.major) {
                embed.fields.push({
                    name: 'Next Major Event',
                    value: `${this.lastEventsCommand.events.major.name}\n${getTimeAndCountdown(this.lastEventsCommand.events.major.timestamp)}`,
                    inline: false
                });
            }

            if (this.lastEventsCommand.events.minor) {
                embed.fields.push({
                    name: 'Next Minor Event',
                    value: `${this.lastEventsCommand.events.minor.name}\n${getTimeAndCountdown(this.lastEventsCommand.events.minor.timestamp)}`,
                    inline: false
                });
            }

            // Send to bot commands channel
            this.sendToDiscord(config.discord.channels.botCommands, { embeds: [embed] });
            logger.info('Sent events command response to Discord');

            // Reset stored events
            this.lastEventsCommand = null;
        }

        return true;
    },

    /**
     * Handle event end messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleEventEndMessage(message) {
        const match = message.match(this.patterns.event.major.ended);
        if (!match) return false;

        const [, name] = match;
        const timestamp = Date.now();
        const eventKey = `EVENT-${name}-ended`;

        // Check for recent duplicate
        const existingEvent = this.activeEvents.get(eventKey);
        if (existingEvent && timestamp - existingEvent.timestamp < 5000) {
            return true;
        }

        // Track this event
        this.activeEvents.set(eventKey, {
            timestamp,
            name,
            status: 'ended'
        });

        // Determine if it was a major or minor event based on name and previous events
        const isMajor = name.includes('2X') ||
            name === 'GAMBLE' ||
            name === 'BLOOD BATH' ||
            name === 'RAGE PIT' ||
            name === 'BEAST' ||
            name === 'GLADIATOR';

        const embed = {
            color: isMajor ? 0xff0000 : 0xffff00,
            description: `${this.eventEmojis[isMajor ? 'MAJOR' : 'MINOR']} ${isMajor ? 'MAJOR' : 'MINOR'} EVENT: ${name.trim()} (ended) ${this.eventEmojis.status.ended} ${getRelativeTime(timestamp)}`
        };

        this.sendToDiscord(config.discord.channels.events, { embeds: [embed] });
        logger.info(`Event ended: ${name}`);
        return true;
    },

    /**
     * Handle event-related messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleEventMessage(message) {
        // Check major events first
        const majorStarting = message.match(this.patterns.event.major.starting);
        const majorStartingNow = message.match(this.patterns.event.major.startingNow);
        const majorEnded = message.match(this.patterns.event.major.ended);

        // Check minor events
        const harvestStart = message.match(this.patterns.event.minor.harvestStart);
        const harvestEnd = message.match(this.patterns.event.minor.harvestEnd);
        const auctionStart = message.match(this.patterns.event.minor.auctionStart);
        const auctionEnd = message.match(this.patterns.event.minor.auctionEnd);

        const timestamp = Date.now();

        // Handle major events
        if (majorStarting) {
            const [, name, minutes] = majorStarting;
            if (minutes === '3') {
                // Set timestamp to 3 minutes in the future
                const scheduledTime = Date.now() + parseInt(minutes) * 60 * 1000;
                return this.sendEventNotification({
                    type: 'MAJOR',
                    name: name.trim(),
                    status: 'starting in 3m',
                    ping: true,
                    timestamp: scheduledTime
                });
            }
        }
        else if (majorStartingNow) {
            const [, name] = majorStartingNow;
            return this.sendEventNotification({
                type: 'MAJOR',
                name: name.trim(),
                status: 'starting now',
                timestamp: Date.now()
            });
        }
        else if (majorEnded) {
            const [, name] = majorEnded;
            return this.sendEventNotification({
                type: 'MAJOR',
                name: name.trim(),
                status: 'ended',
                timestamp: Date.now()
            });
        }
        // Handle minor events
        else if (harvestStart) {
            return this.sendEventNotification({
                type: 'MINOR',
                name: 'HARVEST SEASON',
                status: 'active',
                timestamp: Date.now()
            });
        }
        else if (harvestEnd) {
            return this.sendEventNotification({
                type: 'MINOR',
                name: 'HARVEST SEASON',
                status: 'ended',
                timestamp: Date.now()
            });
        }
        else if (auctionStart) {
            return this.sendEventNotification({
                type: 'MINOR',
                name: 'AUCTION',
                status: 'starting soon',
                timestamp: Date.now()
            });
        }
        else if (auctionEnd) {
            return this.sendEventNotification({
                type: 'MINOR',
                name: 'AUCTION',
                status: 'ending now',
                timestamp: Date.now()
            });
        }

        return false;
    },

    /**
     * Send event notification to Discord
     * @param {Object} event - Event details
     * @returns {boolean} True if notification was sent
     */
    sendEventNotification(event) {
        const eventKey = `${event.type}-${event.name}-${event.status}`;

        // Check for recent duplicate
        const existingEvent = this.activeEvents.get(eventKey);
        if (existingEvent && Date.now() - existingEvent.timestamp < 5000) {
            return true;
        }

        // Track this event
        this.activeEvents.set(eventKey, {
            timestamp: event.timestamp,
            type: event.type,
            name: event.name,
            status: event.status
        });

        const statusEmoji = this.getEventStatusEmoji(event.status);

        const embed = {
            color: event.type === 'MAJOR' ? 0xff0000 : 0xffff00,
            description: `${this.eventEmojis[event.type]} ${event.type} EVENT: ${event.name} (${event.status}) ${statusEmoji} ${getRelativeTime(event.timestamp)}`
        };

        // Add role ping for major events starting in 3 minutes
        const content = event.ping ? `<@&${config.discord.roles.events}>` : undefined;

        this.sendToDiscord(config.discord.channels.events, { content, embeds: [embed] });
        logger.info(`Event detected: ${event.type} - ${event.name} (${event.status})`);
        return true;
    },

    /**
     * Get emoji for event status
     * @param {string} status - Event status
     * @returns {string} Status emoji
     */
    getEventStatusEmoji(status) {
        if (status.includes('starting') || status === 'starting soon') {
            return this.eventEmojis.status.starting;
        }
        if (status === 'ended' || status === 'ending now') {
            return this.eventEmojis.status.ended;
        }
        return this.eventEmojis.status.active;
    },

    /**
     * Handle Title text messages for multiplier extraction
     * @param {string} title - Title text message
     */
    handleTitleMessage(title) {
        const multiplierMatch = title.match(this.patterns.boosterTitle);
        if (!multiplierMatch) return;

        const multiplier = parseFloat(multiplierMatch[1]);
        if (this.pendingBooster) {
            // We have a pending booster activation, add the multiplier
            this.completePendingBooster(multiplier);
        }
    },

    /**
     * Check if we should send a booster ping
     * @param {string} type - Booster type
     * @returns {boolean} Whether to send ping
     */
    shouldPingBooster(type) {
        const normalizedType = type.toLowerCase().trim();

        // Only ping for specific booster types
        if (!this.PING_BOOSTER_TYPES.includes(normalizedType)) {
            return false;
        }

        const now = Date.now();
        // Check if enough time has passed since last ping
        if (now - this.lastBoosterExpirePing < this.BOOSTER_PING_COOLDOWN) {
            logger.info(`Skipping booster ping due to cooldown (${Math.floor((now - this.lastBoosterExpirePing) / 1000)}s elapsed)`);
            return false;
        }

        this.lastBoosterExpirePing = now;
        return true;
    },

    /**
     * Complete pending booster activation with multiplier
     * @param {number} multiplier - Booster multiplier value
     */
    completePendingBooster(multiplier) {
        if (!this.pendingBooster) return;

        const { player, type } = this.pendingBooster;
        const normalizedType = type.toLowerCase().trim();

        // Don't add multiplier for overflow boosters
        const finalMultiplier = normalizedType === 'overflow' ? null : multiplier;

        // Add to booster tracker
        BoosterTracker.addBooster(type, player, finalMultiplier || 2.0);

        // Create Discord embed with proper timestamp
        const now = new Date();
        const expiryTime = new Date(now.getTime() + 1800000); // 30 minutes from now

        const embed = {
            color: 0x00ff00,
            title: '🚀 Booster Activated',
            fields: [
                { name: 'Player', value: player, inline: true },
                { name: 'Type', value: type.toUpperCase(), inline: true },
                {
                    name: 'Expires',
                    value: getTimeAndCountdown(expiryTime),
                    inline: true
                }
            ]
        };

        // Add multiplier field if available
        if (finalMultiplier) {
            embed.fields.splice(2, 0, {
                name: 'Multiplier',
                value: `${finalMultiplier}x`,
                inline: true
            });
        }

        // Check if we should add role ping (only for activations)
        const shouldPing = this.PING_BOOSTER_TYPES.includes(normalizedType);
        const message = {
            embeds: [embed]
        };

        // Check cooldown before pinging
        if (shouldPing && (now - this.lastBoosterExpirePing) >= this.BOOSTER_PING_COOLDOWN) {
            message.content = `<@&${config.discord.roles.boosters}>`;
            this.lastBoosterExpirePing = now;
        }

        this.sendToDiscord(config.discord.channels.boosters, message);

        // Clear pending booster
        this.clearPendingBooster();
    },

    /**
     * Clear pending booster and timeout
     */
    clearPendingBooster() {
        this.pendingBooster = null;
        if (this.pendingBoosterTimeout) {
            clearTimeout(this.pendingBoosterTimeout);
            this.pendingBoosterTimeout = null;
        }
    },

    /**
     * Handle booster-related messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleBoosterMessage(message) {
        // Check for booster activation
        const activateMatch = message.match(this.patterns.boosterChat);
        if (activateMatch) {
            const [, player, type] = activateMatch;

            // Store pending booster activation
            this.clearPendingBooster(); // Clear any existing pending booster
            this.pendingBooster = {
                player: player.trim(), // Ensure clean player name
                type: type.trim()      // Ensure clean type
            };

            // Set timeout to complete booster activation even if no title is received
            this.pendingBoosterTimeout = setTimeout(() => {
                if (this.pendingBooster) {
                    this.completePendingBooster(2.0); // Default to 2.0x if no title received
                }
            }, this.PENDING_BOOSTER_TTL);

            return true;
        }

        // Check for booster expiration
        const expireMatch = message.match(this.patterns.boosterExpire);
        if (expireMatch) {
            const [, player, multiplier, type] = expireMatch;
            const normalizedType = type.toLowerCase();

            // Try to remove booster from tracker
            const removed = BoosterTracker.removeBooster(normalizedType, player);

            // Create embed for booster expiration (no ping)
            const embed = {
                color: 0xff0000,
                title: '⌛ Booster Expired',
                fields: [
                    { name: 'Player', value: player.trim(), inline: true },
                    { name: 'Type', value: type.toUpperCase(), inline: true },
                    {
                        name: 'Expired',
                        value: getRelativeTime(new Date()),
                        inline: true
                    }
                ]
            };

            // Add multiplier field only if it exists (not for overflow)
            if (multiplier) {
                embed.fields.splice(2, 0, {
                    name: 'Multiplier',
                    value: `${multiplier}x`,
                    inline: true
                });
            }

            this.sendToDiscord(config.discord.channels.boosters, { embeds: [embed] })
                .then(() => logger.info(`Booster expiration notification sent for ${player} (${type}${multiplier ? ` ${multiplier}x` : ''})`))
                .catch(err => logger.error('Failed to send booster expiration notification:', err));

            return true;
        }

        return false;
    },

    /**
     * Handle prestige messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handlePrestigeMessage(message) {
        const match = message.match(this.patterns.prestige);
        if (!match) return false;

        const [, player, level] = match;
        const timestamp = new Date();

        const embed = {
            color: 0xffd700,
            title: '🏆 PRESTIGE!',
            description: `${player} unlocked prestige ${level}, gg!`
        };

        this.sendToDiscord(config.discord.channels.prestigeAlerts, { embeds: [embed] });
        return true;
    },

    /**
     * Handle lobby change messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleLobbyMessage(message) {
        const match = message.match(this.patterns.lobby);
        if (!match) return false;

        const [, lobbyName] = match;
        this.lobbyMonitor.handleNewLobby(lobbyName);
        return true;
    },

    /**
     * Handle verification messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleVerificationMessage(message) {
        const match = message.match(this.patterns.verifyMessage);
        if (!match) return false;

        const [, playerName, code] = match;
        logger.info(`Received verification code ${code} from player ${playerName}`);

        // Pass to command bridge for verification
        if (this.commandBridge) {
            this.commandBridge.handleVerificationCode(playerName, code);
        }

        return true;
    },

    /**
     * Handle guild chat messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleGuildChatMessage(message) {
        const match = message.match(this.patterns.guildChat);
        if (!match) return false;

        const [, role, player, content] = match;
        const timestamp = new Date();

        const embed = {
            color: 0x7289DA, // Discord blurple
            description: `**[${role}] ${player}:** ${content}`
        };

        this.sendToDiscord(config.discord.channels.guildChat, { embeds: [embed] });
        return true;
    },

    /**
     * Handle guild kill messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleGuildKillMessage(message) {
        const match = message.match(this.patterns.guildKill);
        if (!match) return false;

        const [, killerLevel, killer, victimLevel, victim] = match;
        const timestamp = new Date();

        const embed = {
            color: 0xFF0000, // Red for kills
            title: 'Guild Kill',
            fields: [
                { name: 'Killer', value: `${killer} (Lvl ${killerLevel})`, inline: true },
                { name: 'Victim', value: `${victim} (Lvl ${victimLevel})`, inline: true },
                {
                    name: 'Time',
                    value: getRelativeTime(timestamp),
                    inline: true
                }
            ]
        };

        this.sendToDiscord(config.discord.channels.guildKills, { embeds: [embed] });
        return true;
    },

    /**
     * Handle lobby chat messages
     * @param {string} message - Chat message
     * @returns {boolean} True if message was handled
     */
    handleLobbyChatMessage(message) {
        const match = message.match(this.patterns.lobbyChat);
        if (!match) return false;

        const [, prestige, level, guildTag, rank, player, content] = match;

        // Build player info string
        let playerInfo = `[${prestige}-${level}] `;
        if (guildTag) playerInfo += `[${guildTag}] `;
        if (rank) playerInfo += `[${rank}] `;
        playerInfo += player;

        const embed = {
            color: 0x7289DA,
            description: `**${playerInfo}:** ${content}`,
            fields: []
        };

        this.sendToDiscord(config.discord.channels.lobby, { embeds: [embed] });
        return true;
    }
};

module.exports = ChatParser; 