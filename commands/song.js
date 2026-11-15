const yts = require('yt-search');
const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

const MAX_SONG_SEARCH_RESULTS = 3;

function getSongCandidates(videos) {
    const candidates = [];
    const seen = new Set();

    for (const video of Array.isArray(videos) ? videos : []) {
        if (!video?.url) continue;
        try {
            const url = validateMediaUrl(video.url, 'youtube');
            if (seen.has(url)) continue;
            seen.add(url);
            candidates.push({ ...video, url });
            if (candidates.length >= MAX_SONG_SEARCH_RESULTS) break;
        } catch (error) {
            console.warn('[SONG] Skipping invalid YouTube search result:', error.message);
        }
    }

    return candidates;
}

async function downloadFirstAvailableAudio(videos, downloader = downloadMedia) {
    const candidates = getSongCandidates(videos);
    if (!candidates.length) {
        const error = new Error('YouTube search returned no valid audio links.');
        error.code = 'YOUTUBE_AUDIO_SEARCH_NO_VALID_RESULTS';
        throw error;
    }

    let lastError;
    for (let index = 0; index < candidates.length; index += 1) {
        const video = candidates[index];
        try {
            const downloaded = await downloader(video.url, { platform: 'youtube', kind: 'audio' });
            const audio = downloaded?.[0];
            if (!audio?.buffer) throw new Error('The extractor returned no audio file.');
            console.log(`[SONG] Search result ${index + 1}/${candidates.length} downloaded: ${String(video.title || 'Untitled').slice(0, 120)}`);
            return { audio, video, attemptedCount: index + 1 };
        } catch (error) {
            lastError = error;
            console.warn(`[SONG] Search result ${index + 1}/${candidates.length} failed: ${String(video.title || 'Untitled').slice(0, 120)} — ${String(error?.message || error).slice(0, 250)}`);
        }
    }

    const error = new Error(`All ${candidates.length} YouTube audio search results failed.`);
    error.code = 'YOUTUBE_AUDIO_SEARCH_RESULTS_FAILED';
    error.attemptedCount = candidates.length;
    error.cause = lastError;
    throw error;
}

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
        let audio;
        const inputUrl = cleanUrlCandidate(query);
        if (inputUrl) {
            video = {
                url: validateMediaUrl(inputUrl, 'youtube'),
                title: 'YouTube audio',
                thumbnail: ''
            };
            await sock.sendMessage(chatId, {
                text: '🎵 Downloading audio from the YouTube link...'
            }, { quoted: message });
            [audio] = await downloadMedia(video.url, { platform: 'youtube', kind: 'audio' });
        } else {
            let search;
            try {
                search = await yts(query);
            } catch (error) {
                console.error('[SONG] YouTube search failed:', error?.message || error);
                await sock.sendMessage(chatId, {
                    text: '❌ YouTube song search is temporarily unavailable. Try again later or paste a public YouTube link.'
                }, { quoted: message });
                return;
            }
            const candidates = getSongCandidates(search?.videos);
            if (!candidates.length) {
                await sock.sendMessage(chatId, {
                    text: 'No YouTube results found. Try another song or artist.'
                }, { quoted: message });
                return;
            }

            await sock.sendMessage(chatId, {
                text: `🎵 Found ${candidates.length} result(s). Trying them until one downloads...`
            }, { quoted: message });

            const result = await downloadFirstAvailableAudio(candidates, downloadMedia);
            audio = result.audio;
            video = result.video;
        }

        const safeTitle = String(video.title || 'song').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 90) || 'song';
        await sock.sendMessage(chatId, {
            audio: audio.buffer,
            mimetype: audio.mimetype,
            fileName: `${safeTitle}.${audio.extension || 'm4a'}`,
            ptt: false
        }, { quoted: message });
    } catch (error) {
        console.error('[SONG] Download failed:', error?.message || error, error?.cause?.stderr || '');
        const underlyingError = error?.cause || error;
        const failureText = error?.code === 'YOUTUBE_AUDIO_SEARCH_RESULTS_FAILED'
            ? `Tried ${error.attemptedCount} YouTube search result(s), but none could be downloaded. ${formatDownloaderError(underlyingError)}`
            : `❌ ${formatDownloaderError(underlyingError)}`;
        await sock.sendMessage(chatId, {
            text: failureText
        }, { quoted: message });
    }
}

module.exports = songCommand;
module.exports.downloadFirstAvailableAudio = downloadFirstAvailableAudio;
module.exports.getSongCandidates = getSongCandidates;
