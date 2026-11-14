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


test('`.gpt` and `.gemini` use AI Horde anonymous text fallback only when their provider keys are absent', async () => {
    const oldFetch = global.fetch;
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    const oldGeminiKey = process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url) === 'https://oai.aihorde.net/v1/models') {
            return jsonResponse({
                data: [
                    {
                        id: 'koboldcpp/Llama-3.2-3B-Instruct',
                        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
                        top_provider: { max_completion_tokens: 512 },
                        x_horde: { workers: 2, queued: 1 }
                    },
                    {
                        id: 'koboldcpp/uncensored-heretic',
                        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
                        top_provider: { max_completion_tokens: 1024 },
                        x_horde: { workers: 10, queued: 0 }
                    }
                ]
            });
        }
        if (String(url) === 'https://oai.aihorde.net/v1/chat/completions') {
            return jsonResponse({ choices: [{ message: { content: 'Mock AI Horde answer' } }] });
        }
        throw new Error(`Unexpected mocked URL: ${url}`);
    };
    try {
        const sock = makeSocket();
        await aiCommand(sock, 'chat', makeMessage('.gpt A public fallback test', 'horde-gpt'));
        await aiCommand(sock, 'chat', makeMessage('.gemini Another public fallback test', 'horde-gemini'));

        assert.equal(calls.length, 4);
        for (const call of calls) assert.equal(call.options.redirect, 'error');
        for (const call of calls.filter(call => call.url.endsWith('/chat/completions'))) {
            assert.equal(call.options.headers.Authorization, 'Bearer 0000000000');
            const body = JSON.parse(call.options.body);
            assert.deepEqual(body.models, ['koboldcpp/Llama-3.2-3B-Instruct']);
            assert.equal(body.max_tokens, 512);
            assert.equal(body.horde.include_reasoning, false);
        }
        assert.equal(sock.sent.filter(item => item.payload.text === 'Mock AI Horde answer').length, 2);
        assert.ok(sock.sent.some(item => item.payload.text?.includes('sent to volunteer-run workers')));
    } finally {
        global.fetch = oldFetch;
        restoreEnv('OPENAI_API_KEY', oldOpenAiKey);
        restoreEnv('GEMINI_API_KEY', oldGeminiKey);
    }
});

test('`.imagine` and `.flux` use AI Horde anonymous image fallback and disclose LAION sharing', async () => {
    const oldFetch = global.fetch;
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    const oldBflKey = process.env.BFL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.BFL_API_KEY;
    const calls = [];
    let requestNumber = 0;
    const imagePayload = Buffer.from('mock-webp-image').toString('base64');
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url) === 'https://aihorde.net/api/v2/generate/async') {
            requestNumber += 1;
            return jsonResponse({ id: `11111111-1111-4111-8111-${String(requestNumber).padStart(12, '0')}` }, 202);
        }
        if (String(url).includes('/generate/check/')) return jsonResponse({ done: true, is_possible: true });
        if (String(url).includes('/generate/status/') && options.method !== 'DELETE') {
            return jsonResponse({ generations: [{ img: imagePayload, state: 'ok', censored: false }] });
        }
        throw new Error(`Unexpected mocked URL: ${url}`);
    };
    try {
        const sock = makeSocket();
        await imagineCommand(sock, 'chat', makeMessage('.imagine a paper boat', 'horde-imagine'));
        await imagineCommand(sock, 'chat', makeMessage('.flux a blue mountain', 'horde-flux'));

        const submissions = calls.filter(call => call.url.endsWith('/generate/async'));
        assert.equal(submissions.length, 2);
        for (const [index, call] of submissions.entries()) {
            assert.equal(call.options.headers.apikey, '0000000000');
            assert.equal(call.options.redirect, 'error');
            const body = JSON.parse(call.options.body);
            assert.equal(body.prompt, index === 0 ? 'a paper boat' : 'a blue mountain');
            assert.equal(body.nsfw, false);
            assert.equal(body.censor_nsfw, true);
            assert.equal(body.validated_backends, true);
            assert.equal(body.params.n, 1);
            assert.equal(body.r2, false);
            assert.equal(body.shared, true);
        }
        assert.equal(sock.sent.filter(item => item.payload.image).length, 2);
        assert.ok(sock.sent.every(item => !item.payload.image || item.payload.mimetype === 'image/webp'));
        assert.ok(sock.sent.some(item => item.payload.text?.includes('shared with LAION')));
    } finally {
        global.fetch = oldFetch;
        restoreEnv('OPENAI_API_KEY', oldOpenAiKey);
        restoreEnv('BFL_API_KEY', oldBflKey);
    }
});
