const sharp = require('sharp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

function getQuotedContext(message) {
    return message?.message?.extendedTextMessage?.contextInfo ||
        message?.message?.imageMessage?.contextInfo ||
        message?.message?.videoMessage?.contextInfo ||
        message?.message?.stickerMessage?.contextInfo ||
        null;
}

async function toImageCommand(sock, chatId, message) {
    const context = getQuotedContext(message);
    const sticker = context?.quotedMessage?.stickerMessage;
    if (!sticker) {
        await sock.sendMessage(chatId, {
            text: 'Reply to a sticker with .toimage to convert it to a PNG image.'
        }, { quoted: message });
        return;
    }

    const quotedMessage = {
        key: {
            remoteJid: chatId,
            id: context.stanzaId,
            ...(context.participant ? { participant: context.participant } : {})
        },
        message: context.quotedMessage
    };

    try {
        const download = sock.downloadMediaMessage || downloadMediaMessage;
        if (typeof download !== 'function') {
            throw new Error('This Baileys build does not expose the media download helper.');
        }
        const stickerBuffer = await download(
            quotedMessage,
            'buffer',
            {},
            {
                logger: sock.logger || { info() {} },
                ...(typeof sock.updateMediaMessage === 'function'
                    ? { reuploadRequest: sock.updateMediaMessage }
                    : {})
            }
        );
        if (!Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
            throw new Error('WhatsApp returned an empty sticker.');
        }
        if (stickerBuffer.length > 16 * 1024 * 1024) {
            throw new Error('The sticker is too large to convert (limit: 16 MB).');
        }

        // Sharp outputs the first frame for animated WebP stickers, producing a
        // normal still PNG that can be opened or saved as an image.
        const imageBuffer = await sharp(stickerBuffer, { animated: false }).png().toBuffer();
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            mimetype: 'image/png',
            caption: '✅ Sticker converted to image.'
        }, { quoted: message });
    } catch (error) {
        console.error('[TOIMAGE] Sticker conversion failed:', error?.stack || error);
        await sock.sendMessage(chatId, {
            text: `❌ Could not convert that sticker to an image: ${String(error?.message || error).slice(0, 180)}`
        }, { quoted: message });
    }
}

module.exports = toImageCommand;
module.exports.getQuotedContext = getQuotedContext;
