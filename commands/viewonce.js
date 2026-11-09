const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

function unwrap(msg) {
    while (msg) {
        if (msg.ephemeralMessage?.message) {
            msg = msg.ephemeralMessage.message;
            continue;
        }
        if (msg.viewOnceMessage?.message) {
            msg = msg.viewOnceMessage.message;
            continue;
        }
        if (msg.viewOnceMessageV2?.message) {
            msg = msg.viewOnceMessageV2.message;
            continue;
        }
        if (msg.viewOnceMessageV2Extension?.message) {
            msg = msg.viewOnceMessageV2Extension.message;
            continue;
        }
        break;
    }
    return msg;
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const context = message.message?.extendedTextMessage?.contextInfo;
        if (!context?.quotedMessage) {
            return sock.sendMessage(chatId, {
                text: '❌ Reply directly to a view-once photo or video with .vv'
            }, { quoted: message });
        }

        const quoted = unwrap(context.quotedMessage);
        const image = quoted?.imageMessage;
        const video = quoted?.videoMessage;
        const media = image || video;

        if (!media || !media.viewOnce) {
            return sock.sendMessage(chatId, {
                text: '❌ No view-once image or video detected. Reply to the original view-once media.'
            }, { quoted: message });
        }

        const type = image ? 'image' : 'video';
        const stream = await downloadContentFromMessage(media, type);
        const chunks = [];

        for await (const chunk of stream) chunks.push(chunk);

        const buffer = Buffer.concat(chunks);
        if (!buffer.length) throw new Error('Downloaded media is empty');

        await sock.sendMessage(chatId, image
            ? { image: buffer, caption: media.caption || '' }
            : { video: buffer, caption: media.caption || '' },
            { quoted: message });

    } catch (error) {
        console.error('[VV ERROR]', error);
        await sock.sendMessage(chatId, {
            text: '❌ Could not retrieve this view-once media. Check the bot logs.'
        }, { quoted: message });
    }
}

module.exports = viewonceCommand;
