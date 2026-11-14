const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
const ephotoCalls = [];
Module._load = function (request, parent, isMain) {
    if (request === 'mumaker') {
        return {
            ephoto: async (url, text) => {
                ephotoCalls.push({ url, text });
                return { status: true, image: 'https://images.example.test/generated.jpg' };
            }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const textmakerCommand = require('../commands/textmaker');
Module._load = originalLoad;

const gifApiCalls = [];
const fakeAxios = {
    defaults: {},
    get: async (url, options) => {
        gifApiCalls.push({ url, options });
        return {
            data: {
                data: [{
                    images: {
                        fixed_height: {
                            mp4: 'https://media1.giphy.com/media/sample/200w.mp4'
                        }
                    }
                }]
            }
        };
    }
};
Module._load = function (request, parent, isMain) {
    if (request === 'axios') return fakeAxios;
    if (request === '../settings') return { giphyApiKey: 'test-giphy-key' };
    return originalLoad.call(this, request, parent, isMain);
};
const gifCommand = require('../commands/gif');
Module._load = originalLoad;

test('all Ephoto commands call the API with the original case-preserved text', async () => {
    const effects = [
        'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light', 'neon', 'devil',
        'purple', 'thunder', 'leaves', '1917', 'arena', 'hacker', 'sand', 'blackpink',
        'glitch', 'fire'
    ];
    for (const effect of effects) {
        const sent = [];
        const text = `CaseSensitive ${effect}`;
        const message = { message: { conversation: `.${effect} ${text}` } };
        await textmakerCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat@s.whatsapp.net', message, `.${effect} ${text}`.toLowerCase(), effect);
        assert.equal(ephotoCalls.at(-1).text, text);
        assert.equal(sent.length, 1);
        assert.equal(sent[0][1].image.url, 'https://images.example.test/generated.jpg');
    }
    assert.equal(ephotoCalls.length, effects.length);
    assert.ok(ephotoCalls.every(call => call.url.startsWith('https://en.ephoto360.com/')));
});

test('GIF command sends the returned MP4 rendition and uses the official search query fields', async () => {
    const sent = [];
    const message = { message: { conversation: '.gif Happy Dance' } };
    await gifCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat@s.whatsapp.net', message);

    assert.equal(gifApiCalls.length, 1);
    assert.equal(gifApiCalls[0].url, 'https://api.giphy.com/v1/gifs/search');
    assert.deepEqual(gifApiCalls[0].options.params, {
        api_key: 'test-giphy-key',
        q: 'Happy Dance',
        limit: 1,
        rating: 'g',
        bundle: 'messaging_non_clips'
    });
    assert.equal(sent[0][1].video.url, 'https://media1.giphy.com/media/sample/200w.mp4');
    assert.equal(sent[0][1].gifPlayback, true);
});
