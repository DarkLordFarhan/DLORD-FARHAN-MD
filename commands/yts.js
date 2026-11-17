const { withTimeout } = require('../lib/with-timeout');

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

function formatResults(query, videos) {
    const lines = [`🔎 *YouTube results for:* ${query}`];
    for (const [index, video] of videos.entries()) {
        const title = String(video.title || 'Untitled').replace(/[\r\n]+/g, ' ').slice(0, 150);
        const duration = typeof video.timestamp === 'string' && video.timestamp ? video.timestamp : 'unknown';
        const views = Number.isFinite(video.views) ? video.views.toLocaleString() : 'unknown';
        lines.push(`\n${index + 1}. *${title}*\n${video.url}\nDuration: ${duration} · Views: ${views}`);
    }
    return lines.join('\n').slice(0, 3500);
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
        const result = await searchWithLimit(searchVideos, term, options.timeoutMs ?? 8000);
        const videos = (Array.isArray(result?.videos) ? result.videos : [])
            .filter(video => video && typeof video.title === 'string' && validYouTubeUrl(video.url))
            .slice(0, 5);
        const text = videos.length ? formatResults(term, videos) : `No YouTube results found for “${term}”.`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('[yts] YouTube search failed:', error?.message || error);
        const text = error?.code === 'COMMAND_TIMEOUT'
            ? 'YouTube search timed out. The bot can still handle other commands; please retry shortly.'
            : error?.code === 'YTS_BUSY'
                ? 'YouTube search is still finishing earlier requests. Please try again shortly.'
                : 'YouTube search is temporarily unavailable. Try again later.';
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = { ytsCommand, validYouTubeUrl, formatResults, searchWithLimit };
