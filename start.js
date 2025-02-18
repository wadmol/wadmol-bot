const { spawn } = require('child_process');
const path = require('path');

// Constants for restart schedule
const RESTART_INTERVAL_HOURS = 6;
const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const RESTART_INTERVAL = RESTART_INTERVAL_HOURS * MILLISECONDS_IN_HOUR;

function startBot() {
    console.log('Starting bot...');
    
    const bot = spawn('node', ['src/index.js'], {
        stdio: 'inherit',
        shell: true
    });

    bot.on('exit', (code) => {
        console.log(`Bot process exited with code ${code}`);
        if (code === 0) {
            console.log('Restarting bot...');
            setTimeout(startBot, 1000); // Wait 1 second before restart
        } else {
            console.error('Bot crashed with error. Please check the logs.');
            process.exit(1);
        }
    });

    bot.on('error', (err) => {
        console.error('Failed to start bot:', err);
        process.exit(1);
    });

    return bot;
}

// Start the bot
let botProcess = startBot();

// Schedule periodic restarts
setInterval(() => {
    console.log('Performing scheduled restart...');
    botProcess.kill('SIGTERM'); // Gracefully shutdown the bot
    botProcess = startBot(); // Start a new instance
}, RESTART_INTERVAL); 