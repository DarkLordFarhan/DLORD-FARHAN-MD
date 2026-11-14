const yts = require('yt-search');
const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

async function videoCommand(sock, chatId, message) {
    try {
        const query = getCommandArgument(message);
        if (!query) {
            await sock.sendMessage(chatId, { text: 'Usage: .video <YouTube link or search terms>' }, { quoted: message });
            return;
        }

        let videoUrl = cleanUrlCandidate(query);
        let title = '';
        let thumbnail = '';

        if (videoUrl) {
            videoUrl = validateMediaUrl(videoUrl, 'youtube');
        } else {
            const search = await yts(query);
            const video = search?.videos?.[0];
            if (!video?.url) {
                await sock.sendMessage(chatId, { text: 'No YouTube videos found for that search.' }, { quoted: message });
                return;
            }
            videoUrl = validateMediaUrl(video.url, 'youtube');
            title = video.title || '';
            thumbnail = video.thumbnail || '';
        }

        if (thumbnail) {
            await sock.sendMessage(chatId, {
                image: { url: thumbnail },
                caption: `*${title || 'YouTube video'}*\nDownloading...`
            }, { quoted: message });
        }

        const [media] = await downloadMedia(videoUrl, { platform: 'youtube', kind: 'video' });
        const safeTitle = String(title || 'YouTube-Video').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 90) || 'YouTube-Video';
        await sock.sendMessage(chatId, {
            video: media.buffer,
            mimetype: media.mimetype,
            fileName: `${safeTitle}.${media.extension}`,
            caption: `*${safeTitle}*\n\nDownloaded by LORD FARHAN`
        }, { quoted: message });
    } catch (error) {
        console.error('[VIDEO] Download failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ ${formatDownloaderError(error)}`
        }, { quoted: message });
    }
}

module.exports = videoCommand;
