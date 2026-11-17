const { loadMessageCounts } = require('./topmembers');

function comparableJid(value) {
    return String(value || '').replace(/:\d+(?=@)/, '').toLowerCase();
}

async function myActivityCommand(sock, chatId, message, senderId, options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Use .myactivity inside a group chat.' }, { quoted: message });
        return;
    }
    const sender = senderId || message?.key?.participant;
    if (!sender || sender === chatId) {
        await sock.sendMessage(chatId, { text: 'I could not identify your group account for this command.' }, { quoted: message });
        return;
    }
    try {
        const counts = (options.loadMessageCounts || loadMessageCounts)()?.[chatId] || {};
        const rows = Object.entries(counts)
            .map(([jid, rawCount]) => [jid, Math.max(0, Number(rawCount) || 0)])
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);
        const match = rows.find(([jid]) => jid === sender) || rows.find(([jid]) => comparableJid(jid) === comparableJid(sender));
        const count = match?.[1] || 0;
        const total = rows.reduce((sum, [, messages]) => sum + messages, 0);
        const rank = match ? rows.findIndex(([jid]) => jid === match[0]) + 1 : null;
        const share = total ? `${((count / total) * 100).toFixed(1)}%` : '0%';
        const place = rank ? `\n🏅 Rank: *${rank} of ${rows.length}*` : '';
        const text = `📈 *Your group activity*\nMessages recorded: *${count.toLocaleString()}*${place}\nShare of recorded messages: *${share}*\n\n_These are cumulative counts recorded by the bot._`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('[myactivity] Could not read message counts:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Your activity data could not be read.' }, { quoted: message });
    }
}

module.exports = { myActivityCommand, comparableJid };
