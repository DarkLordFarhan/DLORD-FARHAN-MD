const MAX_FIELD_LENGTH = 1200;
const MEDIA_TYPES = new Set([
    'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'
]);

function shortText(value) {
    if (typeof value !== 'string') return '';
    const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    return clean.length > MAX_FIELD_LENGTH
        ? `${clean.slice(0, MAX_FIELD_LENGTH - 1)}…`
        : clean;
}

function getQuotedMessageInfo(message) {
    const context = message?.message?.extendedTextMessage?.contextInfo;
    const quotedMessage = context?.quotedMessage;
    if (!quotedMessage || typeof quotedMessage !== 'object') return null;

    const type = Object.keys(quotedMessage)[0] || 'unknown';
    const quotedContent = quotedMessage[type] || {};
    const text = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
    const caption = quotedMessage.imageMessage?.caption ||
        quotedMessage.videoMessage?.caption ||
        quotedMessage.documentMessage?.caption || '';
    const mimetype = quotedMessage.imageMessage?.mimetype ||
        quotedMessage.videoMessage?.mimetype ||
        quotedMessage.audioMessage?.mimetype ||
        quotedMessage.documentMessage?.mimetype || '';

    return {
        type,
        sender: shortText(context.participant || context.remoteJid || 'unknown'),
        stanzaId: shortText(context.stanzaId || ''),
        text: shortText(text),
        caption: shortText(caption),
        mimetype: shortText(mimetype),
        fileName: shortText(quotedMessage.documentMessage?.fileName || ''),
        isForwarded: Boolean(quotedContent.isForwarded),
        forwardingScore: Number.isFinite(quotedContent.forwardingScore)
            ? quotedContent.forwardingScore
            : 0,
        hasMedia: MEDIA_TYPES.has(type)
    };
}

async function quotedInfoCommand(sock, chatId, message) {
    const info = getQuotedMessageInfo(message);
    if (!info) {
        await sock.sendMessage(chatId, {
            text: 'Reply to the message you want to inspect, then send .q.'
        }, { quoted: message });
        return;
    }

    await sock.sendMessage(chatId, {
        text: `📋 *Quoted message info*\n\n${JSON.stringify(info, null, 2)}`
    }, { quoted: message });
}

module.exports = { quotedInfoCommand, getQuotedMessageInfo };
