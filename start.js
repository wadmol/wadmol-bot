const { spawn } = require('child_process');
const path = require('path');

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
}

startBot(); 