const { extractRawMessageText, reserveAiCooldown } = require('../lib/ai-rate-limit');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const BFL_API_BASE = 'https://api.bfl.ai';
const MAX_PROMPT_LENGTH = 4000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
    if (!process.env[keyName]) {
        await sock.sendMessage(chatId, { text: `${keyName} is not configured in the bot environment.` }, { quoted: message });
        return;
    }
    const waitSeconds = reserveAiCooldown(message, 60000);
    if (waitSeconds) {
        await sock.sendMessage(chatId, { text: `Please wait ${waitSeconds} seconds before another image-generation request.` }, { quoted: message });
        return;
    }

    const provider = usesFlux ? 'Black Forest Labs FLUX' : 'OpenAI Images';
    await sock.sendMessage(chatId, { text: `Generating with ${provider}. This may take a little while.` }, { quoted: message });
    try {
        const image = usesFlux ? await generateFluxImage(prompt) : await generateOpenAiImage(prompt);
        const aliasCaption = command === '.dalle' ? 'OpenAI image generation (DALL·E alias)' : provider;
        await sock.sendMessage(chatId, {
            image: image.buffer,
            mimetype: image.mimetype,
            caption: `Generated with ${aliasCaption}: ${prompt.slice(0, 350)}`
        }, { quoted: message });
    } catch (error) {
        console.error(`[AI-IMAGE] ${provider} request failed:`, error.status || (error.name === 'AbortError' ? 'timeout' : 'provider error'));
        await sock.sendMessage(chatId, {
            text: error.publicMessage || (error.status ? providerMessage(provider, error.status) : `${provider} image generation failed. Check the API key, model access, and account credits.`)
        }, { quoted: message });
    }
}

module.exports = imagineCommand;
