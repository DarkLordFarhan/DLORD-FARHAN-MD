const yts = require('yt-search');
const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

const MAX_VIDEO_SEARCH_RESULTS = 3;
const SEARCH_RESULT_TIMEOUT_MS = 90000;

function getValidSearchCandidates(videos, maxResults = MAX_VIDEO_SEARCH_RESULTS) {
    const candidates = [];
    const seen = new Set();
    const limit = Math.max(1, Math.min(MAX_VIDEO_SEARCH_RESULTS, Number(maxResults) || MAX_VIDEO_SEARCH_RESULTS));

    for (const video of Array.isArray(videos) ? videos : []) {
        if (!video?.url) continue;

        try {
            const url = validateMediaUrl(video.url, 'youtube');
            if (seen.has(url)) continue;
            seen.add(url);
            candidates.push({ ...video, url });
            if (candidates.length >= limit) break;
        } catch (error) {
            console.warn('[VIDEO] Skipping invalid YouTube search result:', error.message);
        }
    }

    return candidates;
}

async function downloadFirstAvailableVideo(videos, downloader = downloadMedia, maxResults = MAX_VIDEO_SEARCH_RESULTS) {
    const candidates = getValidSearchCandidates(videos, maxResults);
    if (!candidates.length) {
        const error = new Error('YouTube search returned no valid video links.');
        error.code = 'YOUTUBE_SEARCH_NO_VALID_RESULTS';
        throw error;
    }

    let lastError;
    for (let index = 0; index < candidates.length; index += 1) {
        const video = candidates[index];
        try {
            const downloaded = await downloader(video.url, {
                platform: 'youtube',
                kind: 'video',
                timeoutMs: SEARCH_RESULT_TIMEOUT_MS
            });
            const media = downloaded?.[0];
            if (!media?.buffer) throw new Error('The extractor returned no video file.');

            console.log(`[VIDEO] Search result ${index + 1}/${candidates.length} downloaded: ${String(video.title || 'Untitled').slice(0, 120)}`);
            return { media, video, attemptedCount: index + 1 };
        } catch (error) {
            lastError = error;
            console.warn(`[VIDEO] Search result ${index + 1}/${candidates.length} failed: ${String(video.title || 'Untitled').slice(0, 120)} — ${String(error?.message || error).slice(0, 250)}`);
        }
    }

    const error = new Error(`All ${candidates.length} YouTube search results failed.`);
    error.code = 'YOUTUBE_SEARCH_RESULTS_FAILED';
    error.attemptedCount = candidates.length;
    error.cause = lastError;
    throw error;
}

function safeVideoTitle(title) {
    return String(title || 'YouTube-Video')
        .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
        .trim()
        .slice(0, 90) || 'YouTube-Video';
}

async function videoCommand(sock, chatId, message) {
    try {
        const query = getCommandArgument(message);
        if (!query) {
            await sock.sendMessage(chatId, {
                text: 'Usage: .video <YouTube link or search terms>'
            }, { quoted: message });
            return;
        }

        const candidateUrl = cleanUrlCandidate(query);
        let title = '';
        let media;

        if (candidateUrl) {
            const videoUrl = validateMediaUrl(candidateUrl, 'youtube');
            await sock.sendMessage(chatId, {
                text: '⏳ Downloading the YouTube link...'
            }, { quoted: message });
            [media] = await downloadMedia(videoUrl, { platform: 'youtube', kind: 'video' });
        } else {
            let search;
            try {
                search = await yts(query);
            } catch (error) {
                console.error('[VIDEO] YouTube title search failed:', error?.message || error);
                await sock.sendMessage(chatId, {
                    text: '❌ YouTube search is temporarily unavailable. Try again later or paste a public YouTube link.'
                }, { quoted: message });
                return;
            }

            const candidates = getValidSearchCandidates(search?.videos);
            if (!candidates.length) {
                await sock.sendMessage(chatId, {
                    text: 'No valid YouTube videos were found for that search. Try different search terms.'
                }, { quoted: message });
                return;
            }

            await sock.sendMessage(chatId, {
                text: `🔎 Found ${candidates.length} YouTube result(s). Trying them until one downloads...`
            }, { quoted: message });

            const result = await downloadFirstAvailableVideo(candidates, downloadMedia);
            media = result.media;
            title = result.video.title || '';
        }

        if (!media?.buffer) throw new Error('The media extractor returned no video file.');
        const safeTitle = safeVideoTitle(title);
        await sock.sendMessage(chatId, {
            video: media.buffer,
            mimetype: media.mimetype,
            fileName: `${safeTitle}.${media.extension}`,
            caption: `*${safeTitle}*\n\nDownloaded by LORD FARHAN`
        }, { quoted: message });
    } catch (error) {
        console.error('[VIDEO] Download failed:', error?.message || error);
        let text;
        if (error?.code === 'YOUTUBE_SEARCH_RESULTS_FAILED') {
            const lastFailure = error.cause ? formatDownloaderError(error.cause) : '';
            text = `❌ Tried ${error.attemptedCount} YouTube search result(s), but none could be downloaded.${lastFailure ? ` Last failure: ${lastFailure}` : ''} Try a more specific search or paste a public YouTube link.`;
        } else if (error?.code === 'YOUTUBE_SEARCH_NO_VALID_RESULTS') {
            text = '❌ YouTube search returned no usable video links. Try different search terms.';
        } else {
            text = `❌ ${formatDownloaderError(error)}`;
        }
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = videoCommand;
module.exports.downloadFirstAvailableVideo = downloadFirstAvailableVideo;
module.exports.getValidSearchCandidates = getValidSearchCandidates;
module.exports.MAX_VIDEO_SEARCH_RESULTS = MAX_VIDEO_SEARCH_RESULTS;
