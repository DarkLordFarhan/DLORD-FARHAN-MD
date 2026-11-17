const { loadMessageCounts } = require('./topmembers');

async function groupStatsCommand(sock, chatId, message, options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Use .groupstats inside a group chat.' }, { quoted: message });
        return;
    }
    try {
        const counts = (options.loadMessageCounts || loadMessageCounts)()?.[chatId] || {};
        const rows = Object.entries(counts)
            .map(([jid, rawCount]) => [jid, Math.max(0, Number(rawCount) || 0)])
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);
        const total = rows.reduce((sum, [, count]) => sum + count, 0);
        if (!total) {
            await sock.sendMessage(chatId, { text: 'No group activity has been recorded yet.' }, { quoted: message });
            return;
        }
        const leaders = rows.slice(0, 5);
        const ranking = leaders.map(([jid, count], index) => `${index + 1}. @${jid.split('@')[0].split(':')[0]} — ${count} messages`).join('\n');
        const text = `📊 *Group activity*\nCumulative messages recorded: *${total.toLocaleString()}*\nMembers with activity: *${rows.length}*\n\n🏆 *Top members*\n${ranking}`;
        await sock.sendMessage(chatId, { text, mentions: leaders.map(([jid]) => jid) }, { quoted: message });
    } catch (error) {
        console.error('[groupstats] Could not read message counts:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Group activity data could not be read.' }, { quoted: message });
    }
}

module.exports = { groupStatsCommand };
