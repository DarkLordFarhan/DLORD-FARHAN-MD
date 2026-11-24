const normalizeJid = require('./normalize-jid');

function unwrapMessageContent(message) {
    let content = message?.message;
    while (content?.ephemeralMessage?.message) content = content.ephemeralMessage.message;
    return content;
}

function getMessageText(message) {
    const content = unwrapMessageContent(message);
    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        ''
    ).trim();
}

function getTimestampMs(message) {
    const rawTimestamp = message?.messageTimestamp;
    const numericTimestamp = Number(typeof rawTimestamp?.toNumber === 'function' ? rawTimestamp.toNumber() : rawTimestamp);
    if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return 0;
    return numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000;
}

function isLinkedAccountMessage(message, sock) {
    if (message?.key?.fromMe === true) return true;
    const linkedJids = new Set(
        [sock?.user?.id, sock?.user?.lid]
            .map(normalizeJid)
            .filter(Boolean)
    );
    if (!linkedJids.size) return false;
    return [message?.key?.participant, message?.key?.remoteJid]
        .map(normalizeJid)
        .filter(Boolean)
        .some(jid => linkedJids.has(jid));
}

function shouldSkipBaileysEcho(message, sock) {
    const messageId = message?.key?.id;
    if (typeof messageId !== 'string' || !messageId.startsWith('BAE5') || messageId.length !== 16) {
        return false;
    }
    return !(isLinkedAccountMessage(message, sock) && getMessageText(message).startsWith('.'));
}

function shouldProcessUpsertMessage(message, type, now = Date.now(), sock = null) {
    if (!unwrapMessageContent(message) || !message?.key) return false;
    if (type === 'notify') return true;
    if (type !== 'append' || !isLinkedAccountMessage(message, sock)) return false;
    if (!getMessageText(message).startsWith('.')) return false;

    const timestampMs = getTimestampMs(message);
    if (!timestampMs) return false;
    return timestampMs <= now + 60_000 && now - timestampMs <= 5 * 60_000;
}

module.exports = shouldProcessUpsertMessage;
module.exports.getMessageText = getMessageText;
module.exports.isLinkedAccountMessage = isLinkedAccountMessage;
module.exports.shouldSkipBaileysEcho = shouldSkipBaileysEcho;
