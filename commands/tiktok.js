const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

const processedMessages = new Set();

async function tiktokCommand(sock, chatId, message) {
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
            await sock.sendMessage(chatId, { text: 'Usage: .tiktok <TikTok video link>' }, { quoted: message });
            return;
        }

        const tiktokUrl = validateMediaUrl(url, 'tiktok');
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        const [media] = await downloadMedia(tiktokUrl, { platform: 'tiktok', kind: 'video' });
        await sock.sendMessage(chatId, {
            video: media.buffer,
            mimetype: media.mimetype,
            fileName: media.fileName,
            caption: 'Downloaded by LORD FARHAN'
        }, { quoted: message });
    } catch (error) {
        console.error('[TIKTOK] Download failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ ${formatDownloaderError(error)}`
        }, { quoted: message });
    }
}

module.exports = tiktokCommand;
