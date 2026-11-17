const {
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const isLinkedOwner = require('../lib/isLinkedOwner');

function normalizeBotInboxJid(jid) {
    return jidNormalizedUser(String(jid || ''));
}

function isLinkedJid(sock, jid) {
    const normalized = normalizeBotInboxJid(jid);
    if (!normalized) return false;
    return [sock.user?.id, sock.user?.lid]
        .map(normalizeBotInboxJid)
        .filter(Boolean)
        .includes(normalized);
}

function unwrapViewOnce(message) {
    let content = message;
    let viewOnce = false;
    let depth = 0;
    while (content && depth++ < 15) {
        const viewOnceWrapper =
            content.viewOnceMessage ||
            content.viewOnceMessageV2 ||
            content.viewOnceMessageV2Extension;
        const wrapper =
            viewOnceWrapper ||
            content.ephemeralMessage ||
            content.documentWithCaptionMessage;
        if (!wrapper || !wrapper.message) break;
        if (viewOnceWrapper) viewOnce = true;
        content = wrapper.message;
    }
    return { content, viewOnce };
}

function getQuotedContext(message) {
    const content = message?.message;
    const direct =
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo;
    if (direct?.quotedMessage) return direct;

    function search(object, depth = 0) {
        if (!object || typeof object !== 'object' || depth > 15) return null;
        if (object.contextInfo?.quotedMessage) return object.contextInfo;
        for (const value of Object.values(object)) {
            if (value && typeof value === 'object') {
                const found = search(value, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    return search(content);
}

function extractMedia(message, depth = 0) {
    if (!message || typeof message !== 'object' || depth > 15) return null;
    const { content, viewOnce } = unwrapViewOnce(message);
    if (content?.imageMessage && (viewOnce || content.imageMessage.viewOnce)) {
        return { type: 'image', media: content.imageMessage };
    }
    if (content?.videoMessage && (viewOnce || content.videoMessage.viewOnce)) {
        return { type: 'video', media: content.videoMessage };
    }

    for (const value of Object.values(content || {})) {
        if (value && typeof value === 'object') {
            const found = extractMedia(value, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

async function downloadMedia(media, type) {
    const stream = await downloadContentFromMessage(media, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function viewOnceCommand(sock, chatId, message) {
    try {
        const senderId = message.key?.participant ||
            (message.key?.fromMe ? sock.user?.id : message.key?.remoteJid);
        if (!isLinkedOwner(sock, message, senderId)) {
            await sock.sendMessage(chatId, {
                text: 'For privacy, .vv is limited to the linked bot account owner.'
            }, { quoted: message });
            return;
        }

        console.log('[VV] August recovery handler started');
        const context = getQuotedContext(message);
        const quotedMessage = context?.quotedMessage;
        if (!quotedMessage) {
            await sock.sendMessage(chatId, {
                text: '❌ Reply directly to a view-once photo or video with .vv'
            }, { quoted: message });
            return;
        }

        const quotedAuthor = context.participant;
        const quotedFromLinkedAccount = quotedAuthor
            ? isLinkedJid(sock, quotedAuthor)
            : isLinkedJid(sock, chatId) && message.key?.fromMe === true;
        if (!quotedFromLinkedAccount) {
            await sock.sendMessage(chatId, {
                text: 'For privacy, .vv only copies view-once media sent by the linked account. Ask the sender to resend it as normal media if they want you to keep a copy.'
            }, { quoted: message });
            return;
        }

        const found = extractMedia(quotedMessage);
        if (!found) {
            await sock.sendMessage(chatId, {
                text: '❌ No view-once photo/video detected. Reply to the original media.'
            }, { quoted: message });
            return;
        }

        const botId = sock.user?.id;
        if (!botId) throw new Error('Bot WhatsApp ID is unavailable');
        const ownerInbox = jidNormalizedUser(botId);
        console.log('[VV] Downloading:', found.type);
        const buffer = await downloadMedia(found.media, found.type);
        if (!buffer || buffer.length === 0) throw new Error('Downloaded media is empty');

        if (found.type === 'image') {
            await sock.sendMessage(ownerInbox, {
                image: buffer,
                caption: '👑 LORD FARHAN | Recovered view-once photo'
            });
        } else {
            await sock.sendMessage(ownerInbox, {
                video: buffer,
                mimetype: found.media.mimetype || 'video/mp4',
                caption: '👑 LORD FARHAN | Recovered view-once video'
            });
        }
        await sock.sendMessage(chatId, {
            text: '✅ Media processing completed. Check your bot inbox.'
        }, { quoted: message });
        console.log('[VV] SUCCESS: Media delivered to bot inbox');
    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);
        await sock.sendMessage(chatId, {
            text: '❌ VV failed: ' + String(error.message || error).slice(0, 250)
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = viewOnceCommand;
module.exports.normalizeBotInboxJid = normalizeBotInboxJid;
