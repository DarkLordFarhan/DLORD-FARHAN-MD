const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const mediaDownloader = require('../lib/media-downloader');
let searchResults = [];
let downloadHandler = async () => [];
const originalLoad = Module._load;
const songModulePath = require.resolve('../commands/song');
const cachedSongModule = require.cache[songModulePath];
delete require.cache[songModulePath];
Module._load = function (request, parent, isMain) {
    if (request === 'yt-search') return async () => ({ videos: searchResults });
    if (request === '../lib/media-downloader' && parent?.filename === songModulePath) {
        return { ...mediaDownloader, downloadMedia: (...args) => downloadHandler(...args) };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const songCommand = require('../commands/song');
Module._load = originalLoad;
if (cachedSongModule) require.cache[songModulePath] = cachedSongModule;

test('`.play` tries later YouTube results when the first audio download fails', async () => {
    searchResults = [
        { title: 'Restricted result', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
        { title: 'Playable result', url: 'https://www.youtube.com/watch?v=lmnopqrstuv' }
    ];
    const attempts = [];
    downloadHandler = async (url, options) => {
        attempts.push({ url, options });
        if (url.includes('abcdefghijk')) {
            const error = new Error('Download failed');
            error.stderr = 'ERROR: This video is unavailable';
            throw error;
        }
        return [{ buffer: Buffer.from('audio-data'), mimetype: 'audio/mp4', extension: 'm4a' }];
    };

    const sent = [];
    const message = { key: { id: 'play-fallback' }, message: { conversation: '.play test song' } };
    await songCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat@s.whatsapp.net', message);

    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map(attempt => attempt.options), [
        { platform: 'youtube', kind: 'audio' },
        { platform: 'youtube', kind: 'audio' }
    ]);
    const audioMessage = sent.find(([, payload]) => Buffer.isBuffer(payload.audio));
    assert.ok(audioMessage);
    assert.equal(audioMessage[1].mimetype, 'audio/mp4');
    assert.equal(audioMessage[1].fileName, 'Playable result.m4a');
});

test('`.song` reports the provider cause after all search results fail', async () => {
    searchResults = [
        { title: 'Restricted result', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
        { title: 'Unavailable result', url: 'https://www.youtube.com/watch?v=lmnopqrstuv' }
    ];
    downloadHandler = async () => {
        const error = new Error('Download failed');
        error.stderr = 'ERROR: This video is unavailable';
        throw error;
    };

    const sent = [];
    const message = { key: { id: 'song-fail' }, message: { conversation: '.song test song' } };
    await songCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat@s.whatsapp.net', message);

    const failureMessage = sent.find(([, payload]) => /Tried 2 YouTube search result/.test(payload.text || ''));
    assert.ok(failureMessage);
    assert.match(failureMessage[1].text, /private, removed, geo-restricted, or unavailable/i);
});
