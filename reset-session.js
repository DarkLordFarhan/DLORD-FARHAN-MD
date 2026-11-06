const fs = require('fs');
const path = require('path');

if (!process.argv.includes('--confirm')) {
    console.error('This removes saved WhatsApp auth files and requires pairing again.');
    console.error('Run with --confirm only when you intend to reset the session.');
    process.exit(1);
}

const sessionDir = path.join(__dirname, 'session');
fs.rmSync(sessionDir, { recursive: true, force: true });
console.log('Saved session files removed. A new pairing will be required.');
