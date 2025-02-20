const { SlashCommandBuilder } = require('discord.js');

const commandData = [
    {
        name: 'ping',
        description: 'Replies with Pong!'
    },
    // Add other commands here
];

const commands = {
    ping: {
        async execute(interaction) {
            await interaction.reply('Pong!');
        }
    }
};

module.exports = { commands, commandData };