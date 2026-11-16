const {
    downloadMediaMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

const store = require('../lib/lightweight_store');

function findQuotedContext(content, depth = 0) {
    if (!content || typeof content !== 'object' || depth > 15) return null;

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

function extractOriginalMedia(content, depth = 0, viewOnce = false) {
    if (!content || typeof content !== 'object' || depth > 15) return null;

    const wrappers = [
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'ephemeralMessage',
        'documentWithCaptionMessage'
    ];

    for (const wrapper of wrappers) {
        if (content[wrapper]?.message) {
            const isVO = viewOnce || wrapper.startsWith('viewOnce');
            const result = extractOriginalMedia(
                content[wrapper].message,
                depth + 1,
                isVO
            );
            if (result) return result;
        }
    }

    if (content.imageMessage) {
        return {
            type: 'image',
            media: content.imageMessage,
            viewOnce: viewOnce || content.imageMessage.viewOnce === true
        };
    }

    if (content.videoMessage) {
        return {
            type: 'video',
            media: content.videoMessage,
            viewOnce: viewOnce || content.videoMessage.viewOnce === true
        };
    }

    return null;
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const context = findQuotedContext(message?.message);

        if (!context?.stanzaId) {
            return await sock.sendMessage(chatId, {
                text: '❌ Reply directly to the original view-once photo or video with .vv'
            }, { quoted: message });
        }

        console.log('[VV] Looking up original message:', context.stanzaId);

        // Retrieve the original incoming message saved by store.bind().
        let original = await store.loadMessage(chatId, context.stanzaId);

        // Fallback: search stored chats by the exact WhatsApp message ID.
        if (!original) {
            for (const messages of Object.values(store.messages || {})) {
                if (!Array.isArray(messages)) continue;

                original = messages.find(item =>
                    item?.key?.id === context.stanzaId
                );

                if (original) break;
            }
        }

        if (!original?.message || !original?.key) {
            throw new Error(
                'Original message not found in bot store. The media was not retained.'
            );
        }

        const found = extractOriginalMedia(original.message);

        if (!found || !found.viewOnce) {
            throw new Error(
                'Stored original is not a recognized view-once photo or video.'
            );
        }

        console.log('[VV] Original media found:', found.type);
        console.log('[VV] Original key:', original.key.id);

        await sock.sendMessage(chatId, {
            text: '⏳ Original media found. Recovering it now...'
        }, { quoted: message });

        // Keep the ORIGINAL WhatsApp message key and original media object.
        const downloadableMessage = {
            ...original,
            message: found.type === 'image'
                ? { imageMessage: found.media }
                : { videoMessage: found.media }
        };

        const buffer = await downloadMediaMessage(
            downloadableMessage,
            'buffer',
            {},
            {
                logger: sock.logger,
                reuploadRequest: async msg => {
                    if (typeof sock.updateMediaMessage !== 'function') {
                        throw new Error('Media re-upload is unavailable.');
                    }
                    return await sock.updateMediaMessage(msg);
                }
            }
        );

        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error('Media download returned an empty file.');
        }

        const inbox = jidNormalizedUser(String(sock.user?.id || ''));

        if (!inbox || !inbox.endsWith('@s.whatsapp.net')) {
            throw new Error('Bot WhatsApp inbox could not be identified.');
        }

        const caption = found.type === 'image'
            ? '👑 LORD FARHAN | RECOVERED VIEW-ONCE PHOTO'
            : '👑 LORD FARHAN | RECOVERED VIEW-ONCE VIDEO';

        const payload = found.type === 'image'
            ? { image: buffer, caption }
            : {
                video: buffer,
                mimetype: found.media.mimetype || 'video/mp4',
                caption
            };

        await sock.sendMessage(inbox, payload);

        await sock.sendMessage(chatId, {
            text: '✅ VV SUCCESSFUL!\n\nOriginal media delivered to the bot inbox. 👑'
        }, { quoted: message });

        console.log('[VV] Original media recovered and delivered.');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);

        await sock.sendMessage(chatId, {
            text: '❌ VV ERROR: ' + String(error.message || error).slice(0, 300)
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = viewonceCommand;
