const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');

const {
    downloadFirstAvailableVideo,
    downloadFromXcasper,
    downloadWithFallback,
    getYouTubeVideoId,
    getValidSearchCandidates,
    MAX_VIDEO_SEARCH_RESULTS
} = require('../commands/video');

const videos = [
    { title: 'Restricted first result', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    { title: 'Playable second result', url: 'https://www.youtube.com/watch?v=bcdefghijkl' },
    { title: 'Unused third result', url: 'https://youtu.be/cdefghijklM' },
    { title: 'Beyond retry limit', url: 'https://youtu.be/defghijklMN' }
];

test('`.video` tries the next YouTube search result when the first download fails', async () => {
    const attempts = [];
    const result = await downloadFirstAvailableVideo(videos, async (url, options) => {
        attempts.push({ url, options });
        if (url.includes('abcdefghijk')) throw new Error('restricted');
        return [{ buffer: Buffer.from('video-bytes'), mimetype: 'video/mp4', extension: 'mp4' }];
    });

    assert.equal(attempts.length, 2);
    assert.match(attempts[1].url, /bcdefghijkl/);
    assert.equal(attempts[0].options.timeoutMs, 90000);
    assert.equal(result.video.title, 'Playable second result');
    assert.equal(result.media.buffer.toString(), 'video-bytes');
});

test('`.video` stops after the configured search-result retry limit and retains the last cause', async () => {
    const attempts = [];
    await assert.rejects(
        downloadFirstAvailableVideo(videos, async url => {
            attempts.push(url);
            throw new Error(`unavailable ${attempts.length}`);
        }),
        error => {
            assert.equal(error.code, 'YOUTUBE_SEARCH_RESULTS_FAILED');
            assert.equal(error.attemptedCount, MAX_VIDEO_SEARCH_RESULTS);
            assert.match(error.cause.message, /unavailable 3/);
            return true;
        }
    );
    assert.equal(attempts.length, MAX_VIDEO_SEARCH_RESULTS);
});

test('`.video` skips invalid search links before attempting downloads', () => {
    const candidates = getValidSearchCandidates([
        { title: 'Invalid', url: 'https://youtube.com.attacker.example/watch?v=abcdefghijk' },
        videos[1]
    ]);
    assert.deepEqual(candidates.map(video => video.title), ['Playable second result']);
});

test('X CASPER downloader extracts IDs from supported YouTube link forms', () => {
    assert.equal(getYouTubeVideoId('https://www.youtube.com/watch?v=60ItHLz5WEA'), '60ItHLz5WEA');
    assert.equal(getYouTubeVideoId('https://youtu.be/60ItHLz5WEA?t=15'), '60ItHLz5WEA');
    assert.equal(getYouTubeVideoId('https://youtube.com/shorts/60ItHLz5WEA'), '60ItHLz5WEA');
    assert.throws(() => getYouTubeVideoId('https://example.com/watch?v=60ItHLz5WEA'), /valid youtube link/i);
    assert.throws(() => getYouTubeVideoId('https://youtube.com/watch?v=bad'), /11-character/i);
});

test('X CASPER downloader requests bounded MP4/360p media and validates the streamed response', async () => {
    let request;
    const media = await downloadFromXcasper('https://youtu.be/60ItHLz5WEA', {
        get: async (...args) => {
            request = args;
            return {
                headers: {
                    'content-type': 'video/mp4',
                    'content-length': '8',
                    'content-disposition': 'attachment; filename="Alan Walker - Faded (360p, h264).mp4"'
                },
                data: Readable.from([Buffer.from('mp4-'), Buffer.from('data')])
            };
        }
    });

    assert.match(request[0], /\/api\/download\/60ItHLz5WEA\?format=mp4&quality=360$/);
    assert.equal(request[1].responseType, 'stream');
    assert.equal(request[1].timeout, 90000);
    assert.equal(media.buffer.toString(), 'mp4-data');
    assert.equal(media.mimetype, 'video/mp4');
    assert.equal(media.extension, 'mp4');
    assert.match(media.fileName, /Faded/);
});

test('X CASPER downloader rejects non-video responses and enforces a maximum size', async () => {
    await assert.rejects(
        downloadFromXcasper('https://youtu.be/60ItHLz5WEA', {
            get: async () => ({ headers: { 'content-type': 'application/json' }, data: Readable.from(['{"error":"bad"}']) })
        }),
        /instead of video\/mp4/
    );
    await assert.rejects(
        downloadFromXcasper('https://youtu.be/60ItHLz5WEA', {
            get: async () => ({
                headers: { 'content-type': 'video/mp4', 'content-length': '100' },
                data: Readable.from(['ignored'])
            })
        }, { maxBytes: 10 }),
        /64 MB WhatsApp size limit/
    );
});

test('`.video` falls back to yt-dlp if X CASPER is unavailable', async () => {
    const attempts = [];
    const media = await downloadWithFallback(
        'https://youtu.be/60ItHLz5WEA',
        async (url, options) => {
            attempts.push({ url, options });
            return [{ buffer: Buffer.from('fallback-mp4'), mimetype: 'video/mp4', extension: 'mp4' }];
        },
        async () => { throw new Error('X CASPER maintenance'); }
    );

    assert.equal(media.buffer.toString(), 'fallback-mp4');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].options.kind, 'video');
});
