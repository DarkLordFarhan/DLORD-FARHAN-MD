const yts = require('yt-search');
const axios = require('axios');
const {
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    validateMediaUrl
} = require('../lib/media-downloader');

const MAX_VIDEO_SEARCH_RESULTS = 3;
const SEARCH_RESULT_TIMEOUT_MS = 90000;
const MAX_API_VIDEO_BYTES = 64 * 1024 * 1024;
const XCASPER_API_BASE = (process.env.XCASPER_YOUTUBE_API_BASE || 'https://ytv.xcasper.space').replace(/\/+$/, '');

function getYouTubeVideoId(rawUrl) {
    const validUrl = validateMediaUrl(rawUrl, 'youtube');
    const parsed = new URL(validUrl);
    const hostname = parsed.hostname.toLowerCase();
    let videoId = '';

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
        videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    } else {
        videoId = parsed.searchParams.get('v') ||
            parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] || '';
    }

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        throw new Error('Could not extract a valid 11-character YouTube video ID.');
    }
    return videoId;
}

async function downloadFromXcasper(rawUrl, httpClient = axios, options = {}) {
    const videoId = getYouTubeVideoId(rawUrl);
    const maxBytes = Math.max(1, Number(options.maxBytes) || MAX_API_VIDEO_BYTES);
    const timeoutMs = Math.max(1000, Math.min(180000, Number(options.timeoutMs) || SEARCH_RESULT_TIMEOUT_MS));
    const endpoint = `${XCASPER_API_BASE}/api/download/${encodeURIComponent(videoId)}?format=mp4&quality=360`;
    const response = await httpClient.get(endpoint, {
        responseType: 'stream',
        timeout: timeoutMs,
        maxRedirects: 5,
        headers: { Accept: 'video/mp4' }
    });

    const stream = response.data;
    const headers = response.headers || {};
    const contentType = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'video/mp4') {
        stream?.destroy?.();
        throw new Error(`X CASPER returned ${contentType || 'an unknown content type'} instead of video/mp4.`);
    }

    const declaredLength = Number(headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        stream?.destroy?.();
        throw new Error('X CASPER video exceeds the 64 MB WhatsApp size limit.');
    }

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
            stream?.destroy?.();
            throw new Error('X CASPER video exceeds the 64 MB WhatsApp size limit.');
        }
        chunks.push(buffer);
    }
    if (!totalBytes) throw new Error('X CASPER returned an empty video stream.');

    const disposition = String(headers['content-disposition'] || '');
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const quotedFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
    const fileName = (encodedFilename ? decodeURIComponent(encodedFilename) : quotedFilename) || `${videoId}.mp4`;
    return {
        buffer: Buffer.concat(chunks, totalBytes),
        extension: 'mp4',
        mimetype: 'video/mp4',
        fileName,
        provider: 'xcasper'
    };
}

async function downloadWithFallback(videoUrl, downloader = downloadMedia, apiDownloader = downloadFromXcasper, fallbackTimeoutMs = 180000) {
    let apiError;
    try {
        const media = await apiDownloader(videoUrl);
        if (!media?.buffer || !media.buffer.length) throw new Error('X CASPER returned no video data.');
        return media;
    } catch (error) {
        apiError = error;
        console.warn('[VIDEO] X CASPER API failed; trying yt-dlp fallback:', String(error?.message || error).slice(0, 220));
    }

    try {
        const [media] = await downloader(videoUrl, { platform: 'youtube', kind: 'video', timeoutMs: fallbackTimeoutMs });
        if (!media?.buffer) throw new Error('The yt-dlp extractor returned no video file.');
        return media;
    } catch (fallbackError) {
        const error = new Error(`X CASPER API failed (${apiError?.message || apiError}); yt-dlp fallback failed (${fallbackError?.message || fallbackError}).`);
        error.cause = fallbackError;
        error.apiError = apiError;
        throw error;
    }
}

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

async function downloadFirstAvailableVideo(videos, downloader = downloadMedia, maxResults = MAX_VIDEO_SEARCH_RESULTS, apiDownloader = null) {
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
            const media = apiDownloader
                ? await downloadWithFallback(video.url, downloader, apiDownloader, SEARCH_RESULT_TIMEOUT_MS)
                : (await downloader(video.url, {
                    platform: 'youtube',
                    kind: 'video',
                    timeoutMs: SEARCH_RESULT_TIMEOUT_MS
                }))?.[0];
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
            media = await downloadWithFallback(videoUrl);
            title = media.fileName ? media.fileName.replace(/\.mp4$/i, '').replace(/\s*\(\d+p,\s*h264\)$/i, '') : '';
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

            const result = await downloadFirstAvailableVideo(candidates, downloadMedia, MAX_VIDEO_SEARCH_RESULTS, downloadFromXcasper);
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
module.exports.downloadFromXcasper = downloadFromXcasper;
module.exports.downloadWithFallback = downloadWithFallback;
module.exports.getYouTubeVideoId = getYouTubeVideoId;
module.exports.getValidSearchCandidates = getValidSearchCandidates;
module.exports.MAX_VIDEO_SEARCH_RESULTS = MAX_VIDEO_SEARCH_RESULTS;
