const { withTimeout } = require('../lib/with-timeout');
const { formatDownloaderError } = require('../lib/media-downloader');
const { downloadFirstAvailableVideo, downloadFromXcasper } = require('./video');

const MAX_ACTIVE_SEARCHES = 2;
const activeSearches = new Set();

function validYouTubeUrl(value) {
    try {
        const url = new URL(String(value));
        return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname.toLowerCase())
            && url.protocol === 'https:';
    } catch {
        return false;
    }
}

async function searchWithLimit(searchVideos, term, timeoutMs) {
    if (activeSearches.size >= MAX_ACTIVE_SEARCHES) {
        const error = new Error('YouTube search is busy with earlier requests.');
        error.code = 'YTS_BUSY';
        throw error;
    }
    const searchTask = Promise.resolve().then(() => searchVideos(term));
    activeSearches.add(searchTask);
    searchTask.then(
        () => activeSearches.delete(searchTask),
        () => activeSearches.delete(searchTask)
    );
    return withTimeout(searchTask, timeoutMs, 'YouTube search timed out.');
}

async function ytsCommand(sock, chatId, message, query, search, options = {}) {
    const term = String(query || '').trim();
    if (!term) {
        await sock.sendMessage(chatId, { text: 'Usage: .yts <search terms>\nExample: .yts latest Kenyan music' }, { quoted: message });
        return;
    }
    if (term.length > 150) {
        await sock.sendMessage(chatId, { text: 'Please keep the YouTube search under 150 characters.' }, { quoted: message });
        return;
    }
    try {
        const searchVideos = search || require('yt-search');
        const searchResult = await searchWithLimit(searchVideos, term, options.timeoutMs ?? 8000);
        const videos = (Array.isArray(searchResult?.videos) ? searchResult.videos : [])
            .filter(video => video && typeof video.title === 'string' && validYouTubeUrl(video.url))
            .slice(0, 3);
        if (!videos.length) {
            await sock.sendMessage(chatId, { text: `No YouTube results found for “${term}”.` }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: `⏳ Found ${videos.length} result(s) for “${term}”. Downloading the best available video...`
        }, { quoted: message });

        const downloaded = await downloadFirstAvailableVideo(
            videos,
            options.downloader,
            3,
            options.apiDownloader || downloadFromXcasper
        );
        const title = String(downloaded.video.title || 'YouTube video')
            .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
            .trim()
            .slice(0, 90) || 'YouTube video';
        await sock.sendMessage(chatId, {
            video: downloaded.media.buffer,
            mimetype: downloaded.media.mimetype || 'video/mp4',
            fileName: `${title}.${downloaded.media.extension || 'mp4'}`,
            caption: `*${title}*\n\nDownloaded from YouTube`
        }, { quoted: message });
    } catch (error) {
        console.error('[yts] YouTube search failed:', error?.message || error);
        const text = error?.code === 'COMMAND_TIMEOUT'
            ? 'YouTube search timed out. The bot can still handle other commands; please retry shortly.'
            : error?.code === 'YTS_BUSY'
                ? 'YouTube search is still finishing earlier requests. Please try again shortly.'
                : error?.code === 'YOUTUBE_SEARCH_RESULTS_FAILED'
                    ? `Tried ${error.attemptedCount} YouTube result(s), but none could be downloaded. ${formatDownloaderError(error.cause || error)}`
                    : error?.code === 'YOUTUBE_SEARCH_NO_VALID_RESULTS'
                        ? 'No usable YouTube video links were found. Try different search terms.'
                        : error?.message?.includes('download')
                            ? `❌ ${formatDownloaderError(error)}`
                            : 'YouTube search is temporarily unavailable. Try again later.';
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = { ytsCommand, validYouTubeUrl, searchWithLimit };
