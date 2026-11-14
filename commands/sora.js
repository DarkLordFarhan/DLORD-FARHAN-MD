const { extractRawMessageText, reserveAiCooldown } = require('../lib/ai-rate-limit');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isSafeOperationName(value) {
    return /^operations\/[A-Za-z0-9._-]+$/.test(value) ||
        /^models\/veo-[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/.test(value);
}

function isGoogleApiUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['generativelanguage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname);
    } catch {
        return false;
    }
}

async function downloadVeoVideo(videoUri, apiKey) {
    let currentUrl = videoUri;
    for (let hop = 0; hop < 5; hop += 1) {
        if (!isGoogleApiUrl(currentUrl)) throw new Error('Veo redirected to an untrusted download host.');
        const currentHost = new URL(currentUrl).hostname;
        const headers = currentHost === 'generativelanguage.googleapis.com' ? { 'x-goog-api-key': apiKey } : {};
        const response = await fetch(currentUrl, {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(180000)
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) throw new Error('Veo returned an invalid video redirect.');
            await response.body?.cancel();
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }
        return response;
    }
    throw new Error('Veo video download exceeded the redirect limit.');
}

async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

async function soraCommand(sock, chatId, message) {
    const rawText = extractRawMessageText(message).trim();
    const splitAt = rawText.search(/\s/);
    const command = (splitAt === -1 ? rawText : rawText.slice(0, splitAt)).toLowerCase();
    const prompt = splitAt === -1 ? '' : rawText.slice(splitAt).trim();

    if (command !== '.sora') {
        await sock.sendMessage(chatId, { text: 'Use .sora <video prompt>.' }, { quoted: message });
        return;
    }
    if (!prompt) {
        await sock.sendMessage(chatId, { text: 'Provide a prompt. Example: .sora a cinematic sunrise over the ocean, slow camera movement' }, { quoted: message });
        return;
    }
    if (prompt.length > 2000) {
        await sock.sendMessage(chatId, { text: 'Please keep the video prompt under 2,000 characters.' }, { quoted: message });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        await sock.sendMessage(chatId, { text: 'Set GEMINI_API_KEY in the bot environment to enable Veo video generation.' }, { quoted: message });
        return;
    }
    const waitSeconds = reserveAiCooldown(message, 180000);
    if (waitSeconds) {
        await sock.sendMessage(chatId, { text: `Please wait ${waitSeconds} seconds before requesting another AI video.` }, { quoted: message });
        return;
    }

    const model = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview';
    if (!/^veo-[A-Za-z0-9.-]+$/.test(model)) {
        await sock.sendMessage(chatId, { text: 'GEMINI_VIDEO_MODEL has an invalid value.' }, { quoted: message });
        return;
    }

    try {
        await sock.sendMessage(chatId, { text: 'Generating an 8-second video with Google Veo. This can take several minutes.' }, { quoted: message });
        const createResponse = await fetch(`${GEMINI_API_BASE}/models/${model}:predictLongRunning`, {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { aspectRatio: '9:16', durationSeconds: '8', resolution: '720p' }
            }),
            signal: AbortSignal.timeout(60000),
            redirect: 'error'
        });
        if (!createResponse.ok) {
            console.error('[VEO] create request status:', createResponse.status);
            await sock.sendMessage(chatId, {
                text: createResponse.status === 401 || createResponse.status === 403
                    ? 'Google rejected the Gemini API key or this project lacks Veo access.'
                    : createResponse.status === 429
                        ? 'Google Veo quota or rate limit reached. Try again later.'
                        : `Google Veo returned an API error (${createResponse.status}). Check model access and billing.`
            }, { quoted: message });
            return;
        }

        let operation = await readJson(createResponse);
        const operationName = String(operation.name || '').replace(/^\/+/, '');
        if (!isSafeOperationName(operationName)) throw new Error('Veo returned an invalid operation name.');

        for (let attempt = 0; !operation.done && attempt < 60; attempt += 1) {
            await sleep(10000);
            const pollResponse = await fetch(`${GEMINI_API_BASE}/${operationName}`, {
                headers: { 'x-goog-api-key': apiKey },
                signal: AbortSignal.timeout(30000),
                redirect: 'error'
            });
            if (!pollResponse.ok) throw Object.assign(new Error('Veo operation polling failed.'), { status: pollResponse.status });
            operation = await readJson(pollResponse);
        }
        if (!operation.done) throw new Error('Veo generation timed out while still processing.');
        if (operation.error) throw new Error('Veo reported a generation error.');

        const videoUri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!videoUri || !isGoogleApiUrl(videoUri)) throw new Error('Veo returned no valid video download URL.');
        const videoResponse = await downloadVeoVideo(videoUri, apiKey);
        if (!videoResponse.ok) throw Object.assign(new Error('Veo video download failed.'), { status: videoResponse.status });
        const contentLength = Number(videoResponse.headers.get('content-length') || 0);
        if (contentLength > MAX_VIDEO_BYTES) throw new Error('Veo video exceeds the supported size.');
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        if (!videoBuffer.length || videoBuffer.length > MAX_VIDEO_BYTES) throw new Error('Veo video exceeds the supported size.');

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: `Generated with Google Veo: ${prompt.slice(0, 300)}`
        }, { quoted: message });
    } catch (error) {
        console.error('[VEO] request failed:', error.status || (error.name === 'AbortError' ? 'timeout' : 'provider error'));
        await sock.sendMessage(chatId, {
            text: error.status === 402
                ? 'Google Veo requires an active billing account or available credits.'
                : 'Google Veo video generation failed. Check the API key, model access, billing, and try again.'
        }, { quoted: message });
    }
}

module.exports = soraCommand;
