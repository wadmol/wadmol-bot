/**
 * @fileoverview Discord slash command handlers
 */

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const config = require('../../utils/config');
const { getRelativeTime } = require('../../utils/timestamp');
const boosters = require('./boosters');

// Create command builders for inline commands
const eventsCommand = new SlashCommandBuilder()
    .setName('events')
    .setDescription('Check upcoming events');

const verifyCommand = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Minecraft account');

/**
 * Command definitions with their handlers
 */
const commands = {
    boosters,
    events: {
        data: eventsCommand,
        async execute(interaction, commandBridge) {
            await interaction.deferReply();

            try {
                // Execute /events command in Minecraft
                await commandBridge.executeCommand('/events');

                // Response will be handled by the chat parser and sent to the bot-commands channel
                await interaction.editReply('Checking events...');

            } catch (error) {
                logger.error('Error executing events command:', error);
                await interaction.editReply('Failed to check events. Please try again later.');
            }
        }
    },
    verify: {
        data: verifyCommand,
        async execute(interaction, commandBridge) {
            try {
                // Check if user is already verified
                const guild = await interaction.client.guilds.fetch(config.discord.guildId);
                const member = await guild.members.fetch(interaction.user.id);
                const verifiedRole = await guild.roles.fetch(config.discord.roles.verified);

                if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
                    return interaction.reply({
                        content: '❌ Your Discord account is already verified! If you need to change your linked Minecraft account, please contact an administrator.',
                        ephemeral: true
                    });
                }

                // Generate verification code
                const { code, expiryTime } = commandBridge.generateVerificationCode(interaction.user.id);

                // Send code via DM with expiry timestamp
                await interaction.user.send(
                    `Your verification code is: \`${code}\`\n` +
                    'To verify your account:\n' +
                    '1. Join the Minecraft server (harrys.gg)\n' +
                    `2. Type this command: \`/msg Wadmol ${code}\`\n` +
                    `This code will expire ${getRelativeTime(expiryTime)}`
                );

                await interaction.reply({
                    content: 'I\'ve sent you a DM with your verification code!',
                    ephemeral: true
                });

            } catch (error) {
                logger.error('Error handling verify command:', error);
                await interaction.reply({
                    content: error.message === 'Cannot send messages to this user'
                        ? 'Failed to send verification code. Please enable DMs from server members and try again.'
                        : 'Failed to generate verification code. Please try again later.',
                    ephemeral: true
                });
            }
        }
    }
};

// Export command data for registration
const commandData = Object.values(commands).map(cmd => {
    // Ensure the command data is properly converted to JSON
    if (cmd.data && typeof cmd.data.toJSON === 'function') {
        return cmd.data.toJSON();
    }
    logger.error('Invalid command data structure:', cmd);
    return null;
}).filter(Boolean); // Remove any null values

module.exports = {
    commands,
    commandData
}; 