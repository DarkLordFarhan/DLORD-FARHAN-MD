const { extractRawMessageText, reserveAiCooldown } = require('../lib/ai-rate-limit');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const BFL_API_BASE = 'https://api.bfl.ai';
const HORDE_API_BASE = 'https://aihorde.net/api/v2';
// AI Horde documents this public token for anonymous, lowest-priority access.
const HORDE_ANONYMOUS_KEY = '0000000000';
const MAX_PROMPT_LENGTH = 4000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const HORDE_MAX_POLLS = 45;
const HORDE_POLL_INTERVAL_MS = 4000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCommand(message) {
    const rawText = extractRawMessageText(message).trim();
    const splitAt = rawText.search(/\s/);
    const command = (splitAt === -1 ? rawText : rawText.slice(0, splitAt)).toLowerCase();
    const prompt = splitAt === -1 ? '' : rawText.slice(splitAt).trim();
    return { command, prompt };
}

function isSecureBflUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'bfl.ai' || url.hostname.endsWith('.bfl.ai'));
    } catch {
        return false;
    }
}

function providerMessage(provider, status) {
    if (status === 401 || status === 403) return `${provider} rejected its API key or this project lacks model access.`;
    if (status === 402) return `${provider} has no available credits. Check the account billing balance.`;
    if (status === 429) return `${provider} rate limit reached. Try again later.`;
    if (status) return `${provider} returned an API error (${status}). Try again later.`;
    return `${provider} could not complete the image request. Try again later.`;
}

async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

async function fetchHordeJson(url, options = {}, timeoutMs = 20000) {
    const response = await fetch(url, {
        ...options,
        headers: {
            accept: 'application/json',
            'Client-Agent': 'DLORD-FARHAN-MD:1.0',
            ...(options.headers || {})
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error'
    });
    if (!response.ok) throw Object.assign(new Error('AI Horde image API request failed.'), { status: response.status });
    return response.json();
}

async function cancelHordeImageRequest(requestId) {
    try {
        await fetch(`${HORDE_API_BASE}/generate/status/${requestId}`, {
            method: 'DELETE',
            headers: {
                accept: 'application/json',
                'Client-Agent': 'DLORD-FARHAN-MD:1.0'
            },
            signal: AbortSignal.timeout(10000),
            redirect: 'error'
        });
    } catch {
        // Best-effort cancellation; do not mask the original failure.
    }
}

async function generateHordeImage(prompt) {
    const submitted = await fetchHordeJson(`${HORDE_API_BASE}/generate/async`, {
        method: 'POST',
        headers: {
            apikey: HORDE_ANONYMOUS_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt,
            params: { n: 1, steps: 20, width: 512, height: 512 },
            nsfw: false,
            censor_nsfw: true,
            validated_backends: true,
            slow_workers: true,
            extra_slow_workers: false,
            r2: false,
            shared: true
        })
    }, 30000);

    const requestId = submitted?.id;
    if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
        throw new Error('AI Horde returned an invalid image request ID.');
    }

    let completed = false;
    try {
        for (let attempt = 0; attempt < HORDE_MAX_POLLS; attempt += 1) {
            if (attempt > 0) await sleep(HORDE_POLL_INTERVAL_MS);
            const status = await fetchHordeJson(`${HORDE_API_BASE}/generate/check/${requestId}`);
            if (status.is_possible === false) {
                throw Object.assign(new Error('No currently available AI Horde workers can process this image.'), {
                    publicMessage: 'AI Horde has no compatible image workers available right now. Try again later.'
                });
            }
            if (status.faulted) throw new Error('AI Horde could not process this image request.');
            if (status.done) {
                completed = true;
                break;
            }
        }

        if (!completed) {
            throw Object.assign(new Error('AI Horde image generation timed out.'), {
                publicMessage: 'AI Horde’s anonymous image queue is taking too long. Please try again later.'
            });
        }

        const result = await fetchHordeJson(`${HORDE_API_BASE}/generate/status/${requestId}`);
        const generation = Array.isArray(result?.generations) ? result.generations[0] : null;
        if (!generation || generation.censored || generation.state !== 'ok') {
            throw Object.assign(new Error('AI Horde returned no usable image.'), {
                publicMessage: 'AI Horde could not return a usable image for that prompt. Try a different prompt.'
            });
        }

        let encoded = generation.img;
        if (typeof encoded !== 'string' || !encoded) throw new Error('AI Horde returned no image data.');
        encoded = encoded.replace(/^data:image\/webp;base64,/i, '');
        if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('AI Horde image exceeded the supported size.');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('AI Horde returned an invalid image payload.');
        const buffer = Buffer.from(encoded, 'base64');
        if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('AI Horde image exceeded the supported size.');
        return { buffer, mimetype: 'image/webp' };
    } finally {
        if (!completed) await cancelHordeImageRequest(requestId);
    }
}

async function generateOpenAiImage(prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY is not configured.'), { publicMessage: 'OPENAI_API_KEY is not configured in the bot environment.' });

    const response = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-flare',
            prompt,
            n: 1,
            size: '1024x1024',
            quality: 'medium',
            output_format: 'png'
        }),
        signal: AbortSignal.timeout(180000),
        redirect: 'error'
    });
    if (!response.ok) throw Object.assign(new Error('OpenAI image request failed.'), { status: response.status });

    const data = await response.json();
    const encoded = data?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded) throw new Error('OpenAI returned no image data.');
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('OpenAI image output exceeded the supported size.');
    return { buffer, mimetype: 'image/png' };
}

async function generateFluxImage(prompt) {
    const apiKey = process.env.BFL_API_KEY;
    if (!apiKey) throw Object.assign(new Error('BFL_API_KEY is not configured.'), { publicMessage: 'BFL_API_KEY is not configured in the bot environment.' });

    const model = process.env.BFL_FLUX_MODEL || 'flux-2-pro';
    if (!/^[a-z0-9-]+$/.test(model)) throw new Error('Invalid BFL_FLUX_MODEL value.');
    const createResponse = await fetch(`${BFL_API_BASE}/v1/${model}`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'x-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt, width: 1024, height: 1024 }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error'
    });
    if (!createResponse.ok) throw Object.assign(new Error('BFL generation request failed.'), { status: createResponse.status });

    const task = await readJson(createResponse);
    if (!task.polling_url || !isSecureBflUrl(task.polling_url)) throw new Error('BFL returned an invalid polling URL.');

    let result;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(1000);
        const pollResponse = await fetch(task.polling_url, {
            headers: { accept: 'application/json', 'x-key': apiKey },
            signal: AbortSignal.timeout(20000),
            redirect: 'error'
        });
        if (!pollResponse.ok) throw Object.assign(new Error('BFL result polling failed.'), { status: pollResponse.status });
        result = await readJson(pollResponse);
        if (result.status === 'Ready') break;
        if (['Error', 'Failed', 'Request Moderated', 'Content Moderated', 'No Card Generated', 'Task not found'].includes(result.status)) {
            throw Object.assign(new Error('BFL image generation did not complete.'), { moderated: /Moderated/.test(result.status) });
        }
    }
    const imageUrl = result?.result?.sample;
    if (result?.status !== 'Ready' || !isSecureBflUrl(imageUrl)) throw new Error('BFL image generation timed out or returned no image.');

    const imageResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(60000),
        redirect: 'error'
    });
    if (!imageResponse.ok) throw new Error('Could not download the generated FLUX image.');
    const contentLength = Number(imageResponse.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('FLUX image exceeds the supported size.');
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('FLUX image exceeds the supported size.');
    const mimetype = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimetype)) throw new Error('BFL returned an unsupported image format.');
    return { buffer, mimetype };
}

async function imagineCommand(sock, chatId, message) {
    const { command, prompt } = parseCommand(message);
    const usesFlux = command === '.flux';
    if (!usesFlux && !['.imagine', '.dalle'].includes(command)) {
        await sock.sendMessage(chatId, { text: 'Use .imagine <prompt>, .dalle <prompt>, or .flux <prompt>.' }, { quoted: message });
        return;
    }
    if (!prompt) {
        await sock.sendMessage(chatId, { text: `Please provide a prompt. Example: ${command} a quiet cabin beside a lake at sunrise` }, { quoted: message });
        return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        await sock.sendMessage(chatId, { text: `Please keep the image prompt under ${MAX_PROMPT_LENGTH} characters.` }, { quoted: message });
        return;
    }

    const keyName = usesFlux ? 'BFL_API_KEY' : 'OPENAI_API_KEY';
    const usingHorde = !process.env[keyName];
    const waitSeconds = reserveAiCooldown(message, 60000);
    if (waitSeconds) {
        await sock.sendMessage(chatId, { text: `Please wait ${waitSeconds} seconds before another image-generation request.` }, { quoted: message });
        return;
    }

    const officialProvider = usesFlux ? 'Black Forest Labs FLUX' : 'OpenAI Images';
    const provider = usingHorde ? 'AI Horde anonymous image generation' : officialProvider;
    if (usingHorde) {
        await sock.sendMessage(chatId, {
            text: 'Using AI Horde’s anonymous community fallback. Your prompt goes to volunteer-run workers, and anonymous images are shared with LAION. Do not include private or sensitive information; the queue may be slow.'
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: `Generating with ${provider}. This may take a little while.` }, { quoted: message });
    }

    try {
        const image = usingHorde
            ? await generateHordeImage(prompt)
            : usesFlux
                ? await generateFluxImage(prompt)
                : await generateOpenAiImage(prompt);
        const aliasCaption = command === '.dalle' ? `${provider} (.dalle alias)` : provider;
        await sock.sendMessage(chatId, {
            image: image.buffer,
            mimetype: image.mimetype,
            caption: `Generated with ${aliasCaption}: ${prompt.slice(0, 350)}`
        }, { quoted: message });
    } catch (error) {
        console.error(`[AI-IMAGE] ${provider} request failed:`, error.status || (error.name === 'AbortError' ? 'timeout' : 'provider error'));
        await sock.sendMessage(chatId, {
            text: error.publicMessage || (usingHorde
                ? 'AI Horde could not complete the image request. Anonymous workers may be unavailable or overloaded; please try again later.'
                : error.status ? providerMessage(provider, error.status) : `${provider} image generation failed. Check the API key, model access, and account credits.`)
        }, { quoted: message });
    }
}

module.exports = imagineCommand;
