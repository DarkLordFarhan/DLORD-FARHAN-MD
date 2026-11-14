const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

async function facebookCommand(sock, chatId, message) {
    try {
        const input = getCommandArgument(message);
        const url = cleanUrlCandidate(input);
        if (!url) {
            await sock.sendMessage(chatId, {
                text: 'Usage: .facebook <public Facebook video or Reel link>'
            }, { quoted: message });
            return;
        }

        const facebookUrl = validateMediaUrl(url, 'facebook');
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
        const [media] = await downloadMedia(facebookUrl, { platform: 'facebook', kind: 'video' });
        await sock.sendMessage(chatId, {
            video: media.buffer,
            mimetype: media.mimetype,
            fileName: media.fileName,
            caption: 'Downloaded by LORD FARHAN'
        }, { quoted: message });
    } catch (error) {
        console.error('[FACEBOOK] Download failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ ${formatDownloaderError(error)}`
        }, { quoted: message });
    }
}

module.exports = facebookCommand;
