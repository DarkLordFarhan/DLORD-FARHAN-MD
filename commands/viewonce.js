const {
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

function unwrapViewOnce(message) {
    let content = message;
    let depth = 0;

    while (content && depth++ < 15) {
        const wrapper =
            content.viewOnceMessage ||
            content.viewOnceMessageV2 ||
            content.viewOnceMessageV2Extension ||
            content.ephemeralMessage ||
            content.documentWithCaptionMessage;

        if (!wrapper || !wrapper.message) break;
        content = wrapper.message;
    }

    return content;
}

function getQuotedMessage(message) {
    const content = message?.message;

    const direct =
        content?.extendedTextMessage?.contextInfo?.quotedMessage ||
        content?.imageMessage?.contextInfo?.quotedMessage ||
        content?.videoMessage?.contextInfo?.quotedMessage;

    if (direct) return direct;

    function search(object, depth = 0) {
        if (!object || typeof object !== 'object' || depth > 15) {
            return null;
        }

        if (object.contextInfo?.quotedMessage) {
            return object.contextInfo.quotedMessage;
        }

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
    if (!message || typeof message !== 'object' || depth > 15) {
        return null;
    }

    const content = unwrapViewOnce(message);

    if (content?.imageMessage) {
        return {
            type: 'image',
            media: content.imageMessage
        };
    }

    if (content?.videoMessage) {
        return {
            type: 'video',
            media: content.videoMessage
        };
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

    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

async function viewOnceCommand(sock, chatId, message) {
    try {
        console.log('[VV] August recovery handler started');

        const quotedMessage = getQuotedMessage(message);

        if (!quotedMessage) {
            console.log('[VV] No quoted message found');
            return;
        }

        const found = extractMedia(quotedMessage);

        if (!found) {
            console.log('[VV] Quoted message has no image/video');
            return;
        }

        const botId = sock.user?.id;

        if (!botId) {
            throw new Error('Bot WhatsApp ID is unavailable');
        }

        const ownerInbox = jidNormalizedUser(botId);

        console.log('[VV] Downloading:', found.type);

        const buffer = await downloadMedia(found.media, found.type);

        if (!buffer || buffer.length === 0) {
            throw new Error('Downloaded media is empty');
        }

        if (found.type === 'image') {
            await sock.sendMessage(ownerInbox, {
                image: buffer,
                caption: '👑 LORD FARHAN | VIEW ONCE RECOVERED'
            });
        } else {
            await sock.sendMessage(ownerInbox, {
                video: buffer,
                mimetype: found.media.mimetype || 'video/mp4',
                caption: '👑 LORD FARHAN | VIEW ONCE RECOVERED'
            });
        }

        console.log('[VV] SUCCESS: Media delivered to bot inbox');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);
    }
}

module.exports = viewOnceCommand;
