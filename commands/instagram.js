const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

const processedMessages = new Set();
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

async function instagramCommand(sock, chatId, message) {
    const messageId = message.key?.id;
    if (messageId && processedMessages.has(messageId)) return;
    if (messageId) {
        processedMessages.add(messageId);
        setTimeout(() => processedMessages.delete(messageId), 5 * 60 * 1000).unref?.();
    }

    try {
        const input = getCommandArgument(message);
        const url = cleanUrlCandidate(input);
        if (!url) {
            await sock.sendMessage(chatId, {
                text: 'Usage: .instagram <Instagram post, Reel, or carousel link>'
            }, { quoted: message });
            return;
        }

        const instagramUrl = validateMediaUrl(url, 'instagram');
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
        const mediaFiles = await downloadMedia(instagramUrl, {
            platform: 'instagram',
            kind: 'video',
            playlist: true,
            maxFiles: 10
        });

        for (let index = 0; index < mediaFiles.length; index++) {
            const media = mediaFiles[index];
            const isImage = IMAGE_EXTENSIONS.has(media.extension);
            const caption = `Downloaded by LORD FARHAN${mediaFiles.length > 1 ? ` (${index + 1}/${mediaFiles.length})` : ''}`;
            await sock.sendMessage(chatId, isImage
                ? { image: media.buffer, mimetype: media.mimetype, fileName: media.fileName, caption }
                : { video: media.buffer, mimetype: media.mimetype, fileName: media.fileName, caption },
            { quoted: message });
        }
    } catch (error) {
        console.error('[INSTAGRAM] Download failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ ${formatDownloaderError(error)}`
        }, { quoted: message });
    }
}

module.exports = instagramCommand;
