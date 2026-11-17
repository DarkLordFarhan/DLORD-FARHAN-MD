function formatTime(timeZone = 'Africa/Nairobi', date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset'
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    const hour = Number(parts.hour);
    const greeting = hour >= 5 && hour < 12 ? 'Good morning'
        : hour >= 12 && hour < 17 ? 'Good afternoon'
            : hour >= 17 && hour < 21 ? 'Good evening' : 'Good night';
    return [
        `🕐 *${parts.hour}:${parts.minute}:${parts.second}*`,
        `📅 ${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`,
        `🌍 Timezone: ${timeZone} (${parts.timeZoneName})`,
        greeting
    ].join('\n');
}

async function timeCommand(sock, chatId, message, timeZone) {
    const zone = String(timeZone || '').trim() || 'Africa/Nairobi';
    try {
        const text = formatTime(zone);
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch {
        await sock.sendMessage(chatId, {
            text: `Unknown timezone: ${zone}\nUse an IANA timezone such as .time Africa/Nairobi or .time UTC.`
        }, { quoted: message });
    }
}

module.exports = { formatTime, timeCommand };
