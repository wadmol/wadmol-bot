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

/**
 * Initialize the Minecraft bot
 * @returns {Promise<Object>} Mineflayer bot instance
 */
async function initializeMinecraftBot() {
    const bot = mineflayer.createBot({
        host: config.minecraft.host,
        username: config.minecraft.email,
        password: config.minecraft.password,
        auth: config.minecraft.auth,
        version: config.minecraft.version
    });

    // Set up error handling
    bot.on('error', error => {
        logger.error('Minecraft bot error:', error);
    });

    bot.on('kicked', reason => {
        logger.error('Minecraft bot kicked:', reason);
        process.exit(1);
    });

    bot.on('end', () => {
        logger.error('Minecraft bot disconnected');
        process.exit(1);
    });

    // Wait for spawn
    await new Promise(resolve => bot.once('spawn', resolve));
    logger.info('Minecraft bot spawned');

    return bot;
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
    logger.info(`Discord bot logged in as ${discordClient.user.tag}`);
    await initializeCommands();

    try {
        // Initialize Minecraft bot
        const bot = await initializeMinecraftBot();

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