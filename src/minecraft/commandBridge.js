/**
 * @fileoverview Bridge for handling commands between Discord and Minecraft
 */

const logger = require('../utils/logger');
const config = require('../utils/config');
const { Client } = require('discord.js');

const CommandBridge = {
    bot: null,
    discordClient: null,
    lastCommand: 0,
    verificationCodes: new Map(),

    /**
     * Initialize the command bridge
     * @param {Object} bot - Mineflayer bot instance
     * @param {Function} sendToDiscord - Function to send messages to Discord
     * @param {Client} discordClient - Discord.js client instance
     */
    initialize(bot, sendToDiscord, discordClient) {
        this.bot = bot;
        this.sendToDiscord = sendToDiscord;
        this.discordClient = discordClient;

        // Clean up expired verification codes periodically
        setInterval(() => this.cleanupVerificationCodes(), 60000);
    },

    /**
     * Execute a Minecraft command from Discord
     * @param {string} command - Command to execute
     * @returns {Promise<void>}
     */
    async executeCommand(command) {
        try {
            // Check cooldown
            const now = Date.now();
            if (now - this.lastCommand < config.timings.commandCooldown) {
                throw new Error('Command on cooldown');
            }
            this.lastCommand = now;

            // Execute command
            await this.bot.chat(command);
            logger.info(`Executed command: ${command}`);

            // Add these debug logs where you handle the Minecraft bot's response
            if (command === '/events') {
                console.log('Sent /events command to Minecraft');
            }

        } catch (error) {
            logger.error('Error executing command:', error);
            throw error;
        }
    },

    /**
     * Generate a verification code for a Discord user
     * @param {string} discordUserId - Discord user ID
     * @returns {Object} Object containing the code and expiry time
     */
    generateVerificationCode(discordUserId) {
        // Invalidate any existing codes for this user
        for (const [existingCode, verification] of this.verificationCodes.entries()) {
            if (verification.discordUserId === discordUserId) {
                this.verificationCodes.delete(existingCode);
                logger.info(`Invalidated old verification code for user ${discordUserId}`);
            }
        }

        // Generate a random 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiryTime = Date.now() + config.timings.verificationCodeTTL;

        // Store the code with expiration
        this.verificationCodes.set(code, {
            discordUserId,
            expires: expiryTime
        });

        return {
            code,
            expiryTime
        };
    },

    /**
     * Handle verification code from Minecraft chat
     * @param {string} minecraftUsername - Minecraft username
     * @param {string} code - Verification code
     */
    async handleVerificationCode(minecraftUsername, code) {
        try {
            const verification = this.verificationCodes.get(code);

            if (!verification) {
                logger.warn(`Invalid verification code received from ${minecraftUsername}: ${code}`);
                await this.bot.chat(`/msg ${minecraftUsername} ❌ Invalid verification code. Please use /verify in Discord to get a new code.`);
                return;
            }

            if (Date.now() > verification.expires) {
                logger.warn(`Expired verification code received from ${minecraftUsername}`);
                this.verificationCodes.delete(code);
                await this.bot.chat(`/msg ${minecraftUsername} ❌ Verification code has expired. Please use /verify in Discord to get a new code.`);
                return;
            }

            // Get the Discord guild and user
            const guild = await this.discordClient.guilds.fetch(config.discord.guildId);
            const member = await guild.members.fetch(verification.discordUserId);

            if (!member) {
                logger.error(`Could not find Discord member for ID: ${verification.discordUserId}`);
                await this.bot.chat(`/msg ${minecraftUsername} ❌ Error during verification. Please try again or contact an administrator.`);
                return;
            }

            // Check if user is already verified
            const verifiedRole = await guild.roles.fetch(config.discord.roles.verified);
            if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
                logger.warn(`User ${member.user.tag} attempted to verify again`);
                await this.bot.chat(`/msg ${minecraftUsername} ❌ Your Discord account is already verified! If you need to change your linked Minecraft account, please contact an administrator.`);
                return;
            }

            // Get the CATCHPA role
            const catchpaRole = await guild.roles.fetch(config.discord.roles.catchpa);

            // Assign the verified role
            if (verifiedRole) {
                await member.roles.add(verifiedRole);
                logger.info(`Assigned verified role to ${member.user.tag}`);

                // Remove CATCHPA role if it exists
                if (catchpaRole && member.roles.cache.has(catchpaRole.id)) {
                    await member.roles.remove(catchpaRole);
                    logger.info(`Removed CATCHPA role from ${member.user.tag}`);
                }

                // Send Minecraft success message
                try {
                    await this.bot.chat(`/msg ${minecraftUsername} ✅ Verification successful! You have been given the ${verifiedRole.name} role in Discord.`);
                } catch (error) {
                    logger.error(`Failed to send success message in Minecraft to ${minecraftUsername}:`, error);
                }
            }

            // Try to update nickname
            try {
                await member.setNickname(minecraftUsername);
                logger.info(`Updated nickname for ${member.user.tag} to ${minecraftUsername}`);
            } catch (error) {
                logger.warn(`Could not update nickname for ${member.user.tag}: ${error.message}`);
            }

            // Send success message to Discord user
            try {
                await member.send({
                    content: `✅ Successfully verified! Your Discord account is now linked to Minecraft username: ${minecraftUsername}`,
                    embeds: [{
                        color: 0x00ff00,
                        title: 'Verification Successful',
                        description: 'Your account has been verified and the following changes have been made:',
                        fields: [
                            { name: 'Minecraft Username', value: minecraftUsername, inline: true },
                            { name: 'Discord Nickname', value: minecraftUsername, inline: true },
                            { name: 'Role Added', value: verifiedRole.name, inline: true },
                            { name: 'Role Removed', value: catchpaRole ? catchpaRole.name : 'N/A', inline: true }
                        ],
                        timestamp: new Date()
                    }]
                });
            } catch (error) {
                logger.warn(`Could not send success message to ${member.user.tag}: ${error.message}`);
            }

            // Remove the used verification code
            this.verificationCodes.delete(code);
            logger.info(`Successfully verified ${minecraftUsername} with Discord user ${member.user.tag}`);

        } catch (error) {
            logger.error('Error during verification:', error);
            try {
                await this.bot.chat(`/msg ${minecraftUsername} ❌ Error during verification. Please try again or contact an administrator.`);
            } catch (msgError) {
                logger.error(`Failed to send error message in Minecraft to ${minecraftUsername}`);
            }
        }
    },

    /**
     * Clean up expired verification codes
     */
    cleanupVerificationCodes() {
        const now = Date.now();
        let cleaned = 0;
        for (const [code, verification] of this.verificationCodes.entries()) {
            if (now > verification.expires) {
                this.verificationCodes.delete(code);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} expired verification codes`);
        }
    },

    // Add error handling where you send the response back to Discord
    async sendEventMessage(interaction, eventMessage) {
        try {
            await interaction.editReply({ content: eventMessage });
            console.log('Successfully sent event message to Discord');
        } catch (error) {
            console.error('Failed to send event message to Discord:', error);
        }
    },

    // Add this debug log in your event command handler
    logEventCommand(interaction) {
        console.log('Event command received:', {
            channelId: interaction.channelId,
            timestamp: new Date().toISOString()
        });
    },

    async handleCommand(interaction) {
        // ... existing code ...

        const embed = {
            color: 0x00ff00,
            title: 'Command Received',
            fields: [
                { name: 'Command', value: commandName, inline: true },
                {
                    name: 'Time',
                    value: getRelativeTime(new Date()),
                    inline: true
                }
            ]
        };

        // ... rest of the method ...
    },

    async sendToMinecraft(message) {
        try {
            if (!this.bot) {
                throw new Error('Minecraft bot not initialized');
            }
            
            // Ensure message is valid
            if (!message || typeof message !== 'string') {
                throw new Error('Invalid message format');
            }

            // Log before sending
            logger.debug(`Sending message to Minecraft: ${message}`);
            
            // Send the raw message to Minecraft chat
            await this.bot.chat(message);
            
            // Log after sending
            logger.info(`Successfully sent message to Minecraft: ${message}`);
        } catch (error) {
            logger.error('Error sending message to Minecraft:', error);
            throw error;
        }
    }
};

module.exports = CommandBridge; 