const test = require('node:test');
const assert = require('node:assert/strict');
const aiCommand = require('../commands/ai');
const imagineCommand = require('../commands/imagine');
const soraCommand = require('../commands/sora');

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function makeMessage(text, id) {
    return {
        key: { remoteJid: `ai-test-${id}@s.whatsapp.net` },
        message: { conversation: text }
    };
}

function makeSocket() {
    const sent = [];
    return {
        sent,
        async sendMessage(chatId, payload) {
            sent.push({ chatId, payload });
        }
    };
}

function restoreEnv(name, original) {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
}

test('`.gpt` uses OpenAI Responses with storage disabled and parses returned text', async () => {
    const oldFetch = global.fetch;
    const oldKey = process.env.OPENAI_API_KEY;
    let request;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    global.fetch = async (url, options) => {
        request = { url, options };
        return jsonResponse({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Mock OpenAI answer' }] }]
        });
    };
    try {
        const sock = makeSocket();
        await aiCommand(sock, 'chat', makeMessage('.gpt Keep this Case', 'gpt'));
        assert.equal(request.url, 'https://api.openai.com/v1/responses');
        assert.equal(request.options.headers.Authorization, 'Bearer test-openai-key');
        const body = JSON.parse(request.options.body);
        assert.equal(body.model, 'gpt-6.1-terra');
        assert.equal(body.input, 'Keep this Case');
        assert.equal(body.store, false);
        assert.equal(sock.sent.at(-1).payload.text, 'Mock OpenAI answer');
    } finally {
        global.fetch = oldFetch;
        restoreEnv('OPENAI_API_KEY', oldKey);
    }
});

test('`.gemini` uses Gemini Interactions and parses REST model output', async () => {
    const oldFetch = global.fetch;
    const oldKey = process.env.GEMINI_API_KEY;
    let request;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    global.fetch = async (url, options) => {
        request = { url, options };
        return jsonResponse({
            status: 'completed',
            steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Mock Gemini answer' }] }]
        });
    };
    try {
        const sock = makeSocket();
        await aiCommand(sock, 'chat', makeMessage('.gemini What is 2+2?', 'gemini'));
        assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
        assert.equal(request.options.headers['x-goog-api-key'], 'test-gemini-key');
        const body = JSON.parse(request.options.body);
        assert.equal(body.model, 'gemini-3.8-flash');
        assert.equal(body.store, false);
        assert.equal(sock.sent.at(-1).payload.text, 'Mock Gemini answer');
    } finally {
        global.fetch = oldFetch;
        restoreEnv('GEMINI_API_KEY', oldKey);
    }
});

test('`.imagine` sends a GPT Image request and delivers decoded image bytes', async () => {
    const oldFetch = global.fetch;
    const oldKey = process.env.OPENAI_API_KEY;
    let request;
    process.env.OPENAI_API_KEY = 'test-openai-image-key';
    global.fetch = async (url, options) => {
        request = { url, options };
        return jsonResponse({ data: [{ b64_json: Buffer.from('mock-png-data').toString('base64') }] });
    };
    try {
        const sock = makeSocket();
        await imagineCommand(sock, 'chat', makeMessage('.imagine a red kite', 'imagine'));
        assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
        assert.equal(request.options.headers.Authorization, 'Bearer test-openai-image-key');
        const body = JSON.parse(request.options.body);
        assert.equal(body.model, 'gpt-image-2.6-flare');
        assert.equal(body.prompt, 'a red kite');
        assert.equal(body.output_format, 'png');
        assert.equal(sock.sent.at(-1).payload.image.toString(), 'mock-png-data');
    } finally {
        global.fetch = oldFetch;
        restoreEnv('OPENAI_API_KEY', oldKey);
    }
});

test('`.flux` submits, polls, and downloads from the official BFL API', async () => {
    const oldFetch = global.fetch;
    const oldKey = process.env.BFL_API_KEY;
    const calls = [];
    process.env.BFL_API_KEY = 'test-bfl-key';
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url) === 'https://api.bfl.ai/v1/flux-2-pro') {
            return jsonResponse({ id: 'task-1', polling_url: 'https://api.bfl.ai/v1/get_result?id=task-1' });
        }
        if (String(url) === 'https://api.bfl.ai/v1/get_result?id=task-1') {
            return jsonResponse({ status: 'Ready', result: { sample: 'https://delivery.bfl.ai/image.png' } });
        }
        if (String(url) === 'https://delivery.bfl.ai/image.png') {
            return new Response(Buffer.from('mock-flux-image'), {
                headers: { 'content-type': 'image/png', 'content-length': '15' }
            });
        }
        throw new Error('Unexpected mocked URL');
    };
    try {
        const sock = makeSocket();
        await imagineCommand(sock, 'chat', makeMessage('.flux A blue boat', 'flux'));
        assert.equal(calls.length, 3);
        assert.equal(calls[0].options.headers['x-key'], 'test-bfl-key');
        assert.equal(JSON.parse(calls[0].options.body).prompt, 'A blue boat');
        assert.equal(calls[0].url, 'https://api.bfl.ai/v1/flux-2-pro');
        assert.equal(sock.sent.at(-1).payload.image.toString(), 'mock-flux-image');
    } finally {
        global.fetch = oldFetch;
        restoreEnv('BFL_API_KEY', oldKey);
    }
});

test('`.sora` generates and delivers a Veo video using the Gemini key', async () => {
    const oldFetch = global.fetch;
    const oldKey = process.env.GEMINI_API_KEY;
    const calls = [];
    process.env.GEMINI_API_KEY = 'test-gemini-video-key';
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith(':predictLongRunning')) {
            return jsonResponse({ name: 'operations/test-operation' });
        }
        if (String(url).endsWith('/operations/test-operation')) {
            return jsonResponse({
                done: true,
                response: {
                    generateVideoResponse: {
                        generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-video:download?alt=media' } }]
                    }
                }
            });
        }
        if (String(url).includes('/files/test-video:download')) {
            return new Response(null, {
                status: 302,
                headers: { location: 'https://storage.googleapis.com/test-video.mp4' }
            });
        }
        if (String(url) === 'https://storage.googleapis.com/test-video.mp4') {
            return new Response(Buffer.from('mock-mp4-data'), {
                headers: { 'content-type': 'video/mp4', 'content-length': '13' }
            });
        }
        throw new Error('Unexpected mocked URL');
    };
    try {
        const sock = makeSocket();
        await soraCommand(sock, 'chat', makeMessage('.sora a calm forest at dawn', 'sora'));
        assert.equal(calls.length, 4);
        assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini-video-key');
        const body = JSON.parse(calls[0].options.body);
        assert.equal(body.instances[0].prompt, 'a calm forest at dawn');
        assert.equal(body.parameters.aspectRatio, '9:16');
        assert.equal(body.parameters.resolution, '720p');
        assert.equal(calls[2].options.headers['x-goog-api-key'], 'test-gemini-video-key');
        assert.equal(calls[2].options.redirect, 'manual');
        assert.equal(calls[3].url, 'https://storage.googleapis.com/test-video.mp4');
        assert.equal(calls[3].options.headers['x-goog-api-key'], undefined);
        assert.equal(sock.sent.at(-1).payload.video.toString(), 'mock-mp4-data');
    } finally {
        global.fetch = oldFetch;
        restoreEnv('GEMINI_API_KEY', oldKey);
    }
});
