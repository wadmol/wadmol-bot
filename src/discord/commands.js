const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    ping: {
        data: new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Replies with Pong!'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        }
    },
    // Add other commands here
}; 