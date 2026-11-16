const {
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

function unwrapMessage(message) {
    let current = message;
    let depth = 0;

    while (current && depth++ < 15) {
        const wrapper =
            current.viewOnceMessage ||
            current.viewOnceMessageV2 ||
            current.viewOnceMessageV2Extension ||
            current.ephemeralMessage ||
            current.documentWithCaptionMessage;

        if (wrapper?.message) {
            current = wrapper.message;
            continue;
        }

        break;
    }

    return current;
}

function findContext(content, depth = 0) {
    if (!content || typeof content !== 'object' || depth > 12) {
        return null;
    }

    for (const value of Object.values(content)) {
        if (!value || typeof value !== 'object') continue;

        if (value.contextInfo?.quotedMessage) {
            return value.contextInfo;
        }

        const result = findContext(value, depth + 1);
        if (result) return result;
    }

    return null;
}

async function downloadMedia(mediaMessage, type) {
    const stream = await downloadContentFromMessage(mediaMessage, type);
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const context = findContext(message?.message);
        if (!context?.quotedMessage) return;

        const quoted = unwrapMessage(context.quotedMessage);
        if (!quoted) return;

        let mediaMessage = null;
        let mediaType = null;

        if (quoted.imageMessage) {
            mediaMessage = quoted.imageMessage;
            mediaType = 'image';
        } else if (quoted.videoMessage) {
            mediaMessage = quoted.videoMessage;
            mediaType = 'video';
        }

        if (!mediaMessage || !mediaType) return;

        const inbox = jidNormalizedUser(sock.user.id);
        if (!inbox) return;

        console.log('[VV] Processing quoted', mediaType);
        console.log('[VV] Downloading original quoted media...');

        const buffer = await downloadMedia(mediaMessage, mediaType);
        if (!buffer || !buffer.length) return;

        if (mediaType === 'image') {
            await sock.sendMessage(inbox, {
                image: buffer,
                caption: ''
            });
        } else {
            await sock.sendMessage(inbox, {
                video: buffer,
                mimetype: mediaMessage.mimetype || 'video/mp4',
                caption: ''
            });
        }

        console.log('[VV] Successfully delivered media to bot inbox.');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);
    }
}

module.exports = viewonceCommand;
