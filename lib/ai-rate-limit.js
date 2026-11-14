const senderCooldowns = new Map();

function extractRawMessageText(message) {
    return String(
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ''
    );
}

function reserveAiCooldown(message, cooldownMs) {
    const sender = message?.key?.participant || message?.key?.remoteJid || 'unknown-sender';
    const now = Date.now();
    const availableAt = senderCooldowns.get(sender) || 0;
    if (availableAt > now) return Math.ceil((availableAt - now) / 1000);

    senderCooldowns.set(sender, now + cooldownMs);
    if (senderCooldowns.size > 5000) {
        for (const [key, expiry] of senderCooldowns) {
            if (expiry <= now) senderCooldowns.delete(key);
        }
    }
    return 0;
}

module.exports = { extractRawMessageText, reserveAiCooldown };
