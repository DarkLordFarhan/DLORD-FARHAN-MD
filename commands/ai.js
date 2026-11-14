const { extractRawMessageText, reserveAiCooldown } = require('../lib/ai-rate-limit');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_PROMPT_LENGTH = 6000;

function getOpenAIText(data) {
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    return (data.output || [])
        .flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text' && typeof item.text === 'string')
        .map(item => item.text.trim())
        .filter(Boolean)
        .join('\n\n');
}

function getGeminiText(data) {
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    return (data.steps || [])
        .filter(step => step.type === 'model_output')
        .flatMap(step => step.content || [])
        .filter(item => item.type === 'text' && typeof item.text === 'string')
        .map(item => item.text.trim())
        .filter(Boolean)
        .join('\n\n');
}

function getFailureMessage(provider, status) {
    if (status === 401 || status === 403) return `${provider} rejected its API key or this project lacks access to the selected model. Check the key and model access.`;
    if (status === 402) return `${provider} requires an active billing account or available credits.`;
    if (status === 429) return `${provider} quota or rate limit reached. Try again later or check provider usage limits.`;
    if (status) return `${provider} returned an API error (${status}). Try again later.`;
    return `${provider} could not be reached. Try again later.`;
}

async function aiCommand(sock, chatId, message) {
    const rawText = extractRawMessageText(message).trim();
    const firstSpace = rawText.search(/\s/);
    const command = (firstSpace === -1 ? rawText : rawText.slice(0, firstSpace)).toLowerCase();
    const query = firstSpace === -1 ? '' : rawText.slice(firstSpace).trim();

    if (command !== '.gpt' && command !== '.gemini') {
        await sock.sendMessage(chatId, {
            text: 'Use .gpt <question> or .gemini <question>.'
        }, { quoted: message });
        return;
    }
    if (!query) {
        await sock.sendMessage(chatId, {
            text: `Please provide a question. Example: ${command} explain photosynthesis in simple terms.`
        }, { quoted: message });
        return;
    }
    if (query.length > MAX_PROMPT_LENGTH) {
        await sock.sendMessage(chatId, {
            text: `Please keep the question under ${MAX_PROMPT_LENGTH} characters.`
        }, { quoted: message });
        return;
    }

    const provider = command === '.gpt' ? 'OpenAI' : 'Gemini';
    const keyName = command === '.gpt' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    const apiKey = process.env[keyName];
    if (!apiKey) {
        await sock.sendMessage(chatId, {
            text: `${keyName} is not configured in the bot environment.`
        }, { quoted: message });
        return;
    }

    const waitSeconds = reserveAiCooldown(message, 10000);
    if (waitSeconds) {
        await sock.sendMessage(chatId, {
            text: `Please wait ${waitSeconds} seconds before sending another AI request.`
        }, { quoted: message });
        return;
    }

    try {
        await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
        let url;
        let headers;
        let body;

        if (command === '.gpt') {
            url = OPENAI_RESPONSES_URL;
            headers = {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            };
            body = {
                model: process.env.OPENAI_TEXT_MODEL || 'gpt-6.1-terra',
                input: query,
                max_output_tokens: 800,
                store: false
            };
        } else {
            url = GEMINI_INTERACTIONS_URL;
            headers = {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json'
            };
            body = {
                model: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
                input: query,
                generation_config: { max_output_tokens: 800 },
                store: false
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
            redirect: 'error'
        });
        if (!response.ok) {
            console.error(`[AI] ${provider} API status: ${response.status}`);
            await sock.sendMessage(chatId, {
                text: getFailureMessage(provider, response.status)
            }, { quoted: message });
            return;
        }

        const data = await response.json();
        const answer = command === '.gpt' ? getOpenAIText(data) : getGeminiText(data);
        if (!answer) throw new Error('The provider returned an empty response.');

        await sock.sendMessage(chatId, { text: answer }, { quoted: message });
    } catch (error) {
        console.error(`[AI] ${provider} request failed:`, error.name || 'Error');
        await sock.sendMessage(chatId, {
            text: `${provider} could not complete the request. Check the provider key/model and try again.`
        }, { quoted: message });
    }
}

module.exports = aiCommand;
