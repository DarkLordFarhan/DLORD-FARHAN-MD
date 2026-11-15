const normalizeJid = require('./normalize-jid');

function isLinkedOwner(sock, message, senderId) {
    if (message?.key?.fromMe === true) return true;

    const linkedJids = new Set(
        [sock?.user?.id, sock?.user?.lid]
            .map(normalizeJid)
            .filter(Boolean)
    );
    if (!linkedJids.size) return false;

    const senderJids = [
        senderId,
        message?.key?.participant,
        message?.key?.remoteJid
    ].map(normalizeJid).filter(Boolean);

    return senderJids.some(jid => linkedJids.has(jid));
}

module.exports = isLinkedOwner;
