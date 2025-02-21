require('dotenv').config();
const logger = require('./logger');

/**
 * Required environment variables
 */
const REQUIRED_ENV_VARS = [
    'MC_EMAIL',
    'MC_PASSWORD',
    'MC_EMAIL_2',
    'MC_PASSWORD_2',
    'DISCORD_TOKEN',
    'BOOSTERS_CHANNEL',
    'EVENTS_CHANNEL',
    'LOBBY_CHANNEL',
    'BOT_COMMANDS_CHANNEL',
    'PRESTIGE_ALERTS_CHANNEL',
    'EVENTS_ROLE_ID',
    'BOOSTERS_ROLE_ID',
    'VERIFIED_ROLE_ID',
    'CATCHPA_ROLE_ID',
    'DISCORD_GUILD_ID',
    'GUILD_CHAT_CHANNEL',
    'GUILD_KILLS_CHANNEL',
    'PRIVATE_MESSENGER_CHANNEL',
    'PLAYER_LIST_CHANNEL'
];

/**
 * Validate and load environment variables
 * @returns {Object} Configuration object
 * @throws {Error} If required environment variables are missing
 */
function loadConfig() {
    const missingVars = REQUIRED_ENV_VARS.filter(envVar => !process.env[envVar]);

    if (missingVars.length > 0) {
        const errorMessage = `Missing required environment variables: ${missingVars.join(', ')}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    return {
        minecraft: {
            accounts: [
                {
                    email: process.env.MC_EMAIL,
                    password: process.env.MC_PASSWORD
                },
                {
                    email: process.env.MC_EMAIL_2,
                    password: process.env.MC_PASSWORD_2
                }
            ],
            host: 'harrys.gg',
            version: '1.8.9',
            auth: 'microsoft'
        },
        discord: {
            token: process.env.DISCORD_TOKEN,
            guildId: process.env.DISCORD_GUILD_ID,
            channels: {
                boosters: process.env.BOOSTERS_CHANNEL,
                events: process.env.EVENTS_CHANNEL,
                lobby: process.env.LOBBY_CHANNEL,
                botCommands: process.env.BOT_COMMANDS_CHANNEL,
                prestigeAlerts: process.env.PRESTIGE_ALERTS_CHANNEL,
                guildChat: process.env.GUILD_CHAT_CHANNEL,
                guildKills: process.env.GUILD_KILLS_CHANNEL,
                privateMessenger: process.env.PRIVATE_MESSENGER_CHANNEL,
                playerList: process.env.PLAYER_LIST_CHANNEL
            },
            roles: {
                events: process.env.EVENTS_ROLE_ID,
                boosters: process.env.BOOSTERS_ROLE_ID,
                verified: process.env.VERIFIED_ROLE_ID,
                catchpa: process.env.CATCHPA_ROLE_ID
            }
        },
        timings: {
            initialPlayDelay: 5000,          // 5 seconds
            playCommandInterval: 30000,       // 30 seconds
            playerListDelay: 5000,           // 5 seconds
            verificationCodeTTL: 300000,     // 5 minutes
            reconnectDelay: 10000,           // 10 seconds
            commandCooldown: 5000,           // 5 seconds
            afkPreventionInterval: 600000,   // 10 minutes - new
            maxReconnectAttempts: 10,         // increased from 5 - new
            reconnectBackoffBase: 2000      // base delay for exponential backoff - new
        },
        logging: {
            level: 'debug',
            file: 'logs/bot.log',
            console: true
        }
    };
}

module.exports = loadConfig(); 