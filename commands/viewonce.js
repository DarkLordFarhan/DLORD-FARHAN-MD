const {
    downloadMediaMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

function findQuotedContext(content, depth = 0) {
    if (!content || typeof content !== 'object' || depth > 12) return null;

    for (const value of Object.values(content)) {
        if (!value || typeof value !== 'object') continue;

        if (value.contextInfo?.quotedMessage) {
            return value.contextInfo;
        }

        const found = findQuotedContext(value, depth + 1);
        if (found) return found;
    }

    return null;
}

function inspectMedia(content, depth = 0, viewOnce = false) {
    if (!content || typeof content !== 'object' || depth > 15) return null;

    if (content.viewOnceMessage ||
        content.viewOnceMessageV2 ||
        content.viewOnceMessageV2Extension) {
        viewOnce = true;
    }

    for (const key of [
        'imageMessage',
        'videoMessage'
    ]) {
        if (content[key]) {
            return {
                type: key === 'imageMessage' ? 'image' : 'video',
                viewOnce: viewOnce || content[key].viewOnce === true
            };
        }
    }

    for (const key of [
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'ephemeralMessage',
        'documentWithCaptionMessage'
    ]) {
        if (content[key]?.message) {
            const result = inspectMedia(
                content[key].message,
                depth + 1,
                viewOnce
            );
            if (result) return result;
        }
    }

    return null;
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const contextInfo = findQuotedContext(message?.message);

        if (!contextInfo?.quotedMessage || !contextInfo.stanzaId) {
            return await sock.sendMessage(chatId, {
                text: '❌ Reply directly to a view-once photo or video with .vv'
            }, { quoted: message });
        }

        const mediaInfo = inspectMedia(contextInfo.quotedMessage);

        if (!mediaInfo || !mediaInfo.viewOnce) {
            return await sock.sendMessage(chatId, {
                text: '❌ The quoted message is not a supported view-once photo or video.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: '⏳ Recovering view-once media...'
        }, { quoted: message });

        const quotedMessage = {
            key: {
                remoteJid: chatId,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant,
                fromMe: false
            },
            message: contextInfo.quotedMessage
        };

        const buffer = await downloadMediaMessage(
            quotedMessage,
            'buffer',
            {},
            {
                logger: sock.logger,
                reuploadRequest: async (msg) => {
                    if (typeof sock.updateMediaMessage !== 'function') {
                        throw new Error('Baileys media re-upload is unavailable.');
                    }
                    return await sock.updateMediaMessage(msg);
                }
            }
        );

        if (!buffer || !buffer.length) {
            throw new Error('Baileys returned empty media.');
        }

        const inbox = jidNormalizedUser(String(sock.user?.id || ''));

        if (!inbox || !inbox.endsWith('@s.whatsapp.net')) {
            throw new Error('Could not identify the bot WhatsApp inbox.');
        }

        const caption = mediaInfo.type === 'image'
            ? '👑 LORD FARHAN | VIEW-ONCE PHOTO'
            : '👑 LORD FARHAN | VIEW-ONCE VIDEO';

        const payload = mediaInfo.type === 'image'
            ? { image: buffer, caption }
            : { video: buffer, mimetype: 'video/mp4', caption };

        await sock.sendMessage(inbox, payload);

        await sock.sendMessage(chatId, {
            text: '✅ VV SUCCESSFUL!\n\nMedia delivered to the bot WhatsApp inbox. 👑'
        }, { quoted: message });

        console.log('[VV] Media recovered and delivered successfully.');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);

        await sock.sendMessage(chatId, {
            text: '❌ VV ERROR: ' + String(error.message || error).slice(0, 250)
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = viewonceCommand;
