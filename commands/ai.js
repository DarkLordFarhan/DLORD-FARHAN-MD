const { extractRawMessageText, reserveAiCooldown } = require('../lib/ai-rate-limit');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const HORDE_BASE_URL = 'https://oai.aihorde.net/v1';
// AI Horde documents this public token for anonymous, lowest-priority access.
const HORDE_ANONYMOUS_TOKEN = '0000000000';
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

function getHordeTextModels(data) {
    const excludedModelNames = /uncensored|heretic|dolphin|maid|erotic|roleplay|stheno|nsfw|adult/i;
    return (Array.isArray(data?.data) ? data.data : [])
        .filter(model => {
            const inputs = model?.architecture?.input_modalities || [];
            const outputs = model?.architecture?.output_modalities || [];
            const workers = Number(model?.x_horde?.workers || 0);
            const completionLength = Number(model?.top_provider?.max_completion_tokens || 0);
            return typeof model?.id === 'string' &&
                inputs.includes('text') && outputs.includes('text') &&
                workers > 0 && completionLength >= 128 &&
                !excludedModelNames.test(model.id);
        })
        .sort((a, b) => {
            const workerDifference = Number(b.x_horde.workers || 0) - Number(a.x_horde.workers || 0);
            if (workerDifference) return workerDifference;
            return Number(a.x_horde.queued || 0) - Number(b.x_horde.queued || 0);
        })
        .slice(0, 5)
        .map(model => model.id);
}

async function generateHordeText(query) {
    const modelsResponse = await fetch(`${HORDE_BASE_URL}/models`, {
        headers: {
            Authorization: `Bearer ${HORDE_ANONYMOUS_TOKEN}`,
            accept: 'application/json'
        },
        signal: AbortSignal.timeout(20000),
        redirect: 'error'
    });
    if (!modelsResponse.ok) throw Object.assign(new Error('AI Horde model discovery failed.'), { status: modelsResponse.status });

    const modelIds = getHordeTextModels(await modelsResponse.json());
    if (!modelIds.length) throw new Error('No suitable AI Horde text workers are currently online.');

    const response = await fetch(`${HORDE_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${HORDE_ANONYMOUS_TOKEN}`,
            'Content-Type': 'application/json',
            accept: 'application/json'
        },
        body: JSON.stringify({
            models: modelIds,
            messages: [{ role: 'user', content: query }],
            max_tokens: 512,
            horde: { include_reasoning: false }
        }),
        signal: AbortSignal.timeout(180000),
        redirect: 'error'
    });
    if (!response.ok) throw Object.assign(new Error('AI Horde text generation failed.'), { status: response.status });

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const answer = typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
            ? content.map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim()
            : '';
    if (!answer) throw new Error('AI Horde returned an empty response.');
    return answer;
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
    const usingHorde = !apiKey;
    const waitSeconds = reserveAiCooldown(message, 10000);
    if (waitSeconds) {
        await sock.sendMessage(chatId, {
            text: `Please wait ${waitSeconds} seconds before sending another AI request.`
        }, { quoted: message });
        return;
    }

    try {
        await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
        let answer;

        if (usingHorde) {
            await sock.sendMessage(chatId, {
                text: 'Using AI Horde’s anonymous community fallback (lowest queue priority). Your question is sent to volunteer-run workers; do not include private or sensitive information.'
            }, { quoted: message });
            answer = await generateHordeText(query);
        } else {
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
            answer = command === '.gpt' ? getOpenAIText(data) : getGeminiText(data);
            if (!answer) throw new Error('The provider returned an empty response.');
        }

        await sock.sendMessage(chatId, { text: answer }, { quoted: message });
    } catch (error) {
        console.error(`[AI] ${usingHorde ? 'AI Horde' : provider} request failed:`, error.status || error.name || 'Error');
        await sock.sendMessage(chatId, {
            text: usingHorde
                ? 'AI Horde could not complete the request. Its anonymous volunteer pool may be busy or unavailable; please try again later.'
                : `${provider} could not complete the request. Check the provider key/model and try again.`
        }, { quoted: message });
    }
}

module.exports = aiCommand;
