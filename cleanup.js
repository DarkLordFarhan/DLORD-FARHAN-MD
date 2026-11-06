const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp');
const maxAgeMs = 3 * 60 * 60 * 1000;
const cutoff = Date.now() - maxAgeMs;

if (!fs.existsSync(tempDir)) {
    console.log('Temp directory does not exist; nothing to clean.');
    process.exit(0);
}

let removed = 0;
for (const entry of fs.readdirSync(tempDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(tempDir, entry.name);
    try {
        if (fs.statSync(filePath).mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            removed += 1;
        }
    } catch (error) {
        console.error(`Could not clean temp file: ${entry.name}`);
    }
}

console.log(`Temp cleanup complete; removed ${removed} stale file(s).`);
