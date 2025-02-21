const { spawn } = require('child_process');
const path = require('path');

// Constants for restart schedule
const RESTART_INTERVAL_HOURS = 6;
const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const RESTART_INTERVAL = RESTART_INTERVAL_HOURS * MILLISECONDS_IN_HOUR;

const accountIndex = process.argv[2] || 0; // Default to first account

// Check for existing instance
if (process.env.CURRENTLY_RUNNING) {
    console.error('Another instance is already running');
    process.exit(1);
}
process.env.CURRENTLY_RUNNING = 'true';

// Single bot instance
let botProcess;

function startBot() {
    console.log('Starting bot...');
    
    botProcess = spawn('node', ['src/index.js', accountIndex], {
        stdio: 'inherit',
        shell: true
    });

    botProcess.on('exit', (code) => {
        console.log(`Bot process exited with code ${code}`);
        if (code === 0) {
            console.log('Restarting bot...');
            setTimeout(startBot, 1000);
        } else {
            console.error('Bot crashed with error. Please check the logs.');
            process.exit(1);
        }
    });

    botProcess.on('error', (err) => {
        console.error('Failed to start bot:', err);
        process.exit(1);
    });

    return botProcess;
}

// Start the bot
startBot();

// Schedule periodic restarts
setInterval(() => {
    console.log('Performing scheduled restart...');
    botProcess.kill('SIGTERM');
    startBot();
}, RESTART_INTERVAL); 