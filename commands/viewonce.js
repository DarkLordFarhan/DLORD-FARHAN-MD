const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');

function unwrapQuotedMedia(message) {
    let current = message;
    let foundViewOnce = false;
    let depth = 0;

    while (current && depth++ < 15) {
        if (current.imageMessage || current.videoMessage) {
            const media = current.imageMessage || current.videoMessage;
            return {
                media,
                type: current.imageMessage ? 'image' : 'video',
                viewOnce: foundViewOnce || media.viewOnce === true
            };
        }

        const wrappers = [
            'viewOnceMessage',
            'viewOnceMessageV2',
            'viewOnceMessageV2Extension',
            'ephemeralMessage',
            'documentWithCaptionMessage'
        ];

        let next = null;

        for (const wrapper of wrappers) {
            if (current[wrapper]?.message) {
                if (wrapper.startsWith('viewOnce')) foundViewOnce = true;
                next = current[wrapper].message;
                break;
            }
        }

        if (!next) break;
        current = next;
    }

    return null;
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const content = message?.message || {};

        let contextInfo = null;

        for (const value of Object.values(content)) {
            if (value?.contextInfo?.quotedMessage) {
                contextInfo = value.contextInfo;
                break;
            }
        }

        if (!contextInfo?.quotedMessage) {
            return await sock.sendMessage(chatId, {
                text: '❌ Reply directly to a view-once photo or video with .vv'
            }, { quoted: message });
        }

        const result = unwrapQuotedMedia(contextInfo.quotedMessage);

        if (!result || !result.viewOnce) {
            return await sock.sendMessage(chatId, {
                text: '❌ No view-once photo or video detected. Reply to the original view-once media.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: '⏳ Processing your view-once media...'
        }, { quoted: message });

        const stream = await downloadContentFromMessage(result.media, result.type);
        const chunks = [];

        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }

        const buffer = Buffer.concat(chunks);

        if (!buffer.length) {
            throw new Error('Downloaded media is empty.');
        }

        const inbox = jidNormalizedUser(String(sock.user?.id || ''));

        if (!inbox || !inbox.endsWith('@s.whatsapp.net')) {
            throw new Error('Could not identify the bot WhatsApp inbox.');
        }

        const caption = result.type === 'image'
            ? '👑 LORD FARHAN | VIEW-ONCE PHOTO'
            : '👑 LORD FARHAN | VIEW-ONCE VIDEO';

        const payload = result.type === 'image'
            ? { image: buffer, caption }
            : {
                video: buffer,
                mimetype: result.media.mimetype || 'video/mp4',
                caption
            };

        await sock.sendMessage(inbox, payload);

        await sock.sendMessage(chatId, {
            text: '✅ VV SUCCESSFUL!\n\nYour media has been delivered to the bot WhatsApp inbox. 👑'
        }, { quoted: message });

        console.log(`[VV] ${result.type} successfully delivered to bot inbox.`);

    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);

        await sock.sendMessage(chatId, {
            text: '❌ VV ERROR: ' + String(error.message || error).slice(0, 300)
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = viewonceCommand;
