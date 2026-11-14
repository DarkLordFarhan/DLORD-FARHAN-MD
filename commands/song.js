const yts = require('yt-search');
const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

async function songCommand(sock, chatId, message) {
    try {
        const query = getCommandArgument(message);
        if (!query) {
            await sock.sendMessage(chatId, {
                text: 'Usage: .play <song name or YouTube link>'
            }, { quoted: message });
            return;
        }

        let video;
        const inputUrl = cleanUrlCandidate(query);
        if (inputUrl) {
            video = {
                url: validateMediaUrl(inputUrl, 'youtube'),
                title: 'YouTube audio',
                thumbnail: ''
            };
        } else {
            const search = await yts(query);
            video = search?.videos?.[0];
            if (!video?.url) {
                await sock.sendMessage(chatId, {
                    text: 'No YouTube results found. Try another song or artist.'
                }, { quoted: message });
                return;
            }
            video.url = validateMediaUrl(video.url, 'youtube');
        }

        if (video.thumbnail) {
            await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption: `🎵 Downloading: *${video.title || 'Your song'}*\n⏱ Duration: ${video.timestamp || 'Unknown'}`
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: `🎵 Downloading: *${video.title || 'Your song'}*`
            }, { quoted: message });
        }

        const [audio] = await downloadMedia(video.url, { platform: 'youtube', kind: 'audio' });
        const safeTitle = String(video.title || 'song').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 90) || 'song';
        await sock.sendMessage(chatId, {
            audio: audio.buffer,
            mimetype: audio.mimetype,
            fileName: `${safeTitle}.mp3`,
            ptt: false
        }, { quoted: message });
    } catch (error) {
        console.error('[SONG] Download failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ ${formatDownloaderError(error)}`
        }, { quoted: message });
    }
}

module.exports = songCommand;
