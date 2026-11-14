const assert = require('node:assert/strict');
const test = require('node:test');

const {
    downloadFirstAvailableVideo,
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
