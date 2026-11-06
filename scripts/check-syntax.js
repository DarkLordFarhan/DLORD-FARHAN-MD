const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'session']);
const files = [];

function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
}

collect(root);

const failures = [];
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failures.push({ file: path.relative(root, file), error: result.stderr.trim() || 'Syntax check failed' });
    }
}

if (failures.length) {
    for (const failure of failures) {
        console.error(`${failure.file}: ${failure.error}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Syntax OK: ${files.length} JavaScript files checked.`);
}
