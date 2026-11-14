const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');

function normalizeBotInboxJid(jid) {
    return jidNormalizedUser(String(jid || ''));
}

function unwrap(message) {
    let current = message;
    let viewOnce = false;

    while (current) {
        if (current.viewOnceMessage?.message) {
            viewOnce = true;
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            viewOnce = true;
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            viewOnce = true;
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else {
            break;
        }
    }

    return { current, viewOnce };
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const context =
            message.message?.extendedTextMessage?.contextInfo ||
            message.message?.imageMessage?.contextInfo ||
            message.message?.videoMessage?.contextInfo;

        if (!context?.quotedMessage) {
            await sock.sendMessage(chatId, {
                text: '❌ Reply directly to a view-once photo or video with .vv'
            }, { quoted: message });
            return;
        }

        const { current, viewOnce } = unwrap(context.quotedMessage);

        const image = current?.imageMessage;
        const video = current?.videoMessage;
        const media = image || video;

        if (!media || !(viewOnce || media.viewOnce)) {
            await sock.sendMessage(chatId, {
                text: '❌ No view-once photo/video detected. Reply to the original media.'
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: '⏳ Processing view-once media...'
        }, { quoted: message });

        const type = image ? 'image' : 'video';
        const stream = await downloadContentFromMessage(media, type);
        const chunks = [];

        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }

        const buffer = Buffer.concat(chunks);
        if (!buffer.length) throw new Error('Downloaded media is empty');

        const inbox = normalizeBotInboxJid(sock.user?.id);

        if (!inbox.endsWith('@s.whatsapp.net')) throw new Error('Bot WhatsApp account unavailable');

        await sock.sendMessage(inbox, image
            ? {
                image: buffer,
                caption: '👑 LORD FARHAN | Recovered view-once photo'
            }
            : {
                video: buffer,
                mimetype: media.mimetype || 'video/mp4',
                caption: '👑 LORD FARHAN | Recovered view-once video'
            }
        );

        await sock.sendMessage(chatId, {
            text: '✅ Media processing completed. Check your bot inbox.'
        }, { quoted: message });

        console.log('[VV] Successfully delivered media to bot inbox.');

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);

        await sock.sendMessage(chatId, {
            text: '❌ VV failed: ' + String(error.message || error).slice(0, 250)
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = viewonceCommand;
module.exports.normalizeBotInboxJid = normalizeBotInboxJid;
