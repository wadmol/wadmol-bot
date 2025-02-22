/**
 * @fileoverview Main application entry point
 */

const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const logger = require('./utils/logger');
const config = require('./utils/config');

// Import services
const LobbyMonitor = require('./minecraft/lobbyMonitor');
const ChatParser = require('./minecraft/chatParser');
const CommandBridge = require('./minecraft/commandBridge');
const BoosterTracker = require('./services/boosterTracker');
const { commands, commandData } = require('./discord/commands');
const PrivateMessenger = require('./discord/privateMessenger');
const ChatHandler = require('./minecraft/chatHandler');

// Create Discord client
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Add this at the top of the file
let currentAccountIndex = 0;

/**
 * Initialize the Minecraft bot
 * @param {number} accountIndex - Index of the account to use
 * @returns {Promise<Object>} Mineflayer bot instance
 */
async function initializeMinecraftBot(accountIndex = 0) {
    const account = config.minecraft.accounts[accountIndex];
    if (!account) {
        throw new Error(`Account index ${accountIndex} not found`);
    }

    // Clear any existing bot session
    if (this.bot) {
        this.bot.end();
        delete this.bot;
    }

    // Add authentication retry logic
    let retries = 3;
    while (retries > 0) {
        try {
            logger.info(`Attempting Microsoft auth for account: ${account.email}`);
            logger.debug('Auth config:', {
                host: config.minecraft.host,
                auth: config.minecraft.auth,
                version: config.minecraft.version,
                email: account.email ? account.email.substring(0, 3) + '***' : 'undefined',
                passwordSet: account.password ? 'yes' : 'no'
            });

            // Enable detailed auth logging
            process.env.DEBUG = 'minecraft-protocol:client:microsoft,prismarine-auth:*';

            const bot = mineflayer.createBot({
                host: config.minecraft.host,
                username: account.email,
                auth: 'microsoft',
                version: config.minecraft.version,
                checkTimeoutInterval: 30000,
                authTitle: "MinecraftBot",
                flow: 'msa',
                onMsaCode: function(data) {
                    logger.info('Microsoft authentication required');
                    logger.info(`Please authenticate here: ${data.verification_uri}`);
                    logger.info(`And enter code: ${data.user_code}`);
                }
            });

            // Add auth event listeners
            ['authenticationError', 'authenticationProgress', 'authenticationSuccess'].forEach(event => {
                bot.on(event, (data) => {
                    logger.debug(`Auth event ${event}:`, data);
                });
            });

            // Add detailed auth logging
            bot.on('authenticationError', (err) => {
                logger.error('Authentication error details:', {
                    error: err.message,
                    errorName: err.name,
                    stack: err.stack
                });
            });

            // Add authentication event handlers
            bot.on('login', () => {
                logger.info(`Successfully authenticated with Microsoft account ${account.email}`);
            });

            bot.on('kicked', (reason) => {
                logger.error(`Minecraft bot kicked. Reason: ${reason}`);
                if (retries > 0) {
                    logger.info(`Retrying authentication (${retries} attempts remaining)`);
                    retries--;
                    bot.end();
                    return;
                }
                throw new Error(`Failed to authenticate after multiple attempts: ${reason}`);
            });

            // Set up error handling
            bot.on('error', error => {
                logger.error('Minecraft bot error:', error);
                if (error.message.includes('Invalid credentials')) {
                    logger.error('Please verify your email and password in the .env file');
                }
            });

            bot.on('end', () => {
                logger.error('Minecraft bot disconnected');
                process.exit(1);
            });

            // Wait for spawn
            await new Promise(resolve => bot.once('spawn', resolve));
            logger.info('Minecraft bot spawned');
            return bot;

        } catch (error) {
            logger.error('Authentication error:', error);
            if (retries > 0) {
                logger.info(`Retrying authentication (${retries} attempts remaining)`);
                retries--;
                continue;
            }
            throw error;
        }
    }
}

/**
 * Send a message to a Discord channel
 * @param {string} channelId - Discord channel ID
 * @param {string|Object} message - Message content or embed
 */
async function sendToDiscord(channelId, message) {
    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel) {
            await channel.send(message);
        }
    } catch (error) {
        logger.error('Error sending Discord message:', error);
    }
}

/**
 * Initialize Discord slash commands
 */
async function initializeCommands() {
    try {
        logger.info('Started refreshing application commands');
        await discordClient.application.commands.set(commandData);
        logger.info('Successfully reloaded application commands');
    } catch (error) {
        logger.error('Error refreshing application commands:', error);
    }
}

// Discord event handlers
discordClient.once(Events.ClientReady, async () => {
    if (this.initialized) return;
    this.initialized = true;
    logger.info(`Discord bot logged in as ${discordClient.user.tag}`);
    await initializeCommands();

    try {
        // Get account index from command line or default to 0
        currentAccountIndex = process.argv[2] ? parseInt(process.argv[2]) : 0;

        // Initialize Minecraft bot with the selected account
        const bot = await initializeMinecraftBot(currentAccountIndex);

        // Initialize services
        LobbyMonitor.initialize(bot, sendToDiscord);
        CommandBridge.initialize(bot, sendToDiscord, discordClient);
        ChatParser.initialize(sendToDiscord, LobbyMonitor, CommandBridge);
        BoosterTracker.initialize();
        PrivateMessenger.initialize(discordClient, CommandBridge);
        ChatHandler.initialize(sendToDiscord);

        // Set up chat handling
        bot.on('message', (message) => {
            const text = message.toString().trim();
            if (text) {
                logger.debug(`Received chat message: ${text}`);
                ChatHandler.handleChat(text);
            }
        });
    } catch (error) {
        logger.error('Error during initialization:', error);
        process.exit(1);
    }
});

// Handle slash commands
discordClient.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const command = commands[interaction.commandName];
    if (!command) return;

    try {
        await command.execute(interaction, CommandBridge);
    } catch (error) {
        logger.error('Error executing command:', error);
        const reply = {
            content: 'There was an error executing this command!',
            ephemeral: true
        };

        if (interaction.deferred) {
            await interaction.editReply(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// Handle Discord errors
discordClient.on(Events.Error, error => {
    logger.error('Discord client error:', error);
});

// Start the Discord bot
discordClient.login(config.discord.token);