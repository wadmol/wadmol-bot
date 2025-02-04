/**
 * @fileoverview Discord command for displaying booster states
 */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../../utils/config');
const BoosterTracker = require('../../services/boosterTracker');
const logger = require('../../utils/logger');

// Create the command structure
const command = {
    // Command registration data
    data: new SlashCommandBuilder()
        .setName('boosters')
        .setDescription('Display current booster states'),

    // Command execution function
    async execute(interaction, commandBridge) {
        // Check if command is used in the correct channel
        if (interaction.channelId !== config.discord.channels.botCommands) {
            return interaction.reply({
                content: `Please use this command in <#${config.discord.channels.botCommands}>`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const { active, inactive } = BoosterTracker.getBoosterStates();

            const embed = {
                color: 0x00ff00,
                title: '🚀 Booster Status',
                fields: []
            };

            // Active boosters section
            if (active.length > 0) {
                const activeDescription = active.map(booster => {
                    const lines = [
                        `${booster.displayType}${booster.multiplier ? ` (${booster.multiplier}x)` : ''}`,
                        `• Activated by: ${booster.player}`,
                        `• Expiring: ${booster.timeRemaining}`
                    ];
                    return lines.join('\n');
                }).join('\n\n');

                embed.fields.push({
                    name: '🟢 Active Boosters',
                    value: activeDescription,
                    inline: false
                });
            }

            // Inactive boosters section
            if (inactive.length > 0) {
                embed.fields.push({
                    name: '⚫ Inactive Boosters',
                    value: inactive.join('\n'),
                    inline: false
                });
            }

            // If no boosters at all (shouldn't happen due to our structure)
            if (embed.fields.length === 0) {
                embed.fields.push({
                    name: '⚫ Inactive Boosters',
                    value: 'All boosters are currently inactive.',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });
            logger.info('Boosters command executed successfully');

        } catch (error) {
            logger.error('Error executing boosters command:', error);
            await interaction.editReply({
                content: 'There was an error fetching booster states.',
                ephemeral: true
            });
        }
    }
};

module.exports = command;