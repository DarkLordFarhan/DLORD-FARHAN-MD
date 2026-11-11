const fs = require('fs');
const path = require('path');
const settings = require('../settings');

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}m`);
    parts.push(`${remainder}s`);
    return parts.join(' ');
}

function getBotMode() {
    try {
        const state = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../data/messageCount.json'), 'utf8')
        );
        return state.isPublic === false ? 'Private' : 'Public';
    } catch {
        return 'Public';
    }
}

function buildStatusText(sock, options = {}) {
    const uptime = options.uptimeSeconds ?? process.uptime();
    const memory = options.memoryUsage || process.memoryUsage();
    const memoryMiB = (memory.rss / (1024 * 1024)).toFixed(1);
    return [
        '*『 🌑༒𓆩『𝕃𝕆ℝ𝔻 𝔽𝔸ℝℍ𝔸ℕ 𝕄𝔻』𓆪༒☠️ 』*',
        `📶 *Connection:* ${sock?.user?.id ? '🟢 Online' : '🟡 Starting'}`,
        `⚡ *Version:* ${settings.version || 'unknown'}`,
        `🕐 *Uptime:* ${formatDuration(uptime)}`,
        `💾 *Memory:* ${memoryMiB} MiB`,
        `🌍 *Mode:* ${getBotMode()}`
    ].join('\n');
}

async function statusCommand(sock, chatId, message) {
    await sock.sendMessage(
        chatId,
        { text: buildStatusText(sock) },
        message ? { quoted: message } : undefined
    );
}

module.exports = statusCommand;
module.exports.buildStatusText = buildStatusText;
module.exports.formatDuration = formatDuration;
