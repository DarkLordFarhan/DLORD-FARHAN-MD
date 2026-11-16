const {
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

function findQuotedContext(content, depth = 0) {
    if (!content || typeof content !== 'object' || depth > 20) return null;

    if (content.contextInfo?.quotedMessage) {
        return content.contextInfo;
    }

    for (const value of Object.values(content)) {
        if (!value || typeof value !== 'object') continue;
        const found = findQuotedContext(value, depth + 1);
        if (found) return found;
    }

    return null;
}

function unwrapMessage(message) {
    let current = message;
    let depth = 0;

    while (current && typeof current === 'object' && depth++ < 20) {
        const wrapper =
            current.viewOnceMessage ||
            current.viewOnceMessageV2 ||
            current.viewOnceMessageV2Extension ||
            current.ephemeralMessage ||
            current.documentWithCaptionMessage;

        if (!wrapper?.message) break;
        current = wrapper.message;
    }

    return current;
}

function extractMedia(quotedMessage) {
    const content = unwrapMessage(quotedMessage);
    if (!content) return null;

    if (content.imageMessage) {
        return { type: 'image', media: content.imageMessage };
    }

    if (content.videoMessage) {
        return { type: 'video', media: content.videoMessage };
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

async function viewonceCommand(sock, chatId, message) {
    const reply = async text => {
        try {
            await sock.sendMessage(
                chatId,
                { text },
                { quoted: message }
            );
        } catch (error) {
            console.error('[VV REPLY ERROR]', error);
        }
    };

    try {
        console.log('[VV] Command received:', chatId);

        const context = findQuotedContext(message?.message);

        if (!context?.quotedMessage) {
            await reply('⚠️ Reply directly to a view-once photo or video with .vv.');
            return;
        }

        const found = extractMedia(context.quotedMessage);

        if (!found) {
            console.log(
                '[VV] Quoted message structure:',
                Object.keys(context.quotedMessage)
            );
            await reply('❌ No photo or video was found in the quoted message. Reply to the original media and try again.');
            return;
        }

        const botId = sock.user?.id || sock.user?.jid;

        if (!botId) {
            await reply('❌ Bot connection is not ready. Try again after reconnecting.');
            return;
        }

        const inbox = jidNormalizedUser(botId);

        console.log('[VV] Media type:', found.type);
        console.log('[VV] Downloading original media...');

        const buffer = await downloadMedia(found.media, found.type);

        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error('WhatsApp returned an empty media file.');
        }

        if (found.type === 'image') {
            await sock.sendMessage(inbox, {
                image: buffer,
                caption: '👑 LORD FARHAN | RECOVERED VIEW-ONCE PHOTO'
            });
        } else {
            await sock.sendMessage(inbox, {
                video: buffer,
                mimetype: found.media.mimetype || 'video/mp4',
                caption: '👑 LORD FARHAN | RECOVERED VIEW-ONCE VIDEO'
            });
        }

        console.log('[VV] SUCCESS - Media delivered to bot inbox.');

        await reply('✅ VV SUCCESSFUL! Recovered media sent to the bot inbox. 👑');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);

        await reply(
            '❌ VV ERROR: ' +
            String(error?.message || error).slice(0, 250)
        );
    }
}

module.exports = viewonceCommand;
