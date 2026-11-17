const QUESTION_API = 'https://api.truthordarebot.xyz/v1/wyr';
const MAX_QUESTION_LENGTH = 1200;

function extractQuestion(data) {
    if (typeof data?.question !== 'string') return null;
    const question = data.question.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (!question) return null;
    return question.length > MAX_QUESTION_LENGTH
        ? `${question.slice(0, MAX_QUESTION_LENGTH - 1)}…`
        : question;
}

function formatWouldYouRather(question) {
    const parts = question.split(/\s+or\s+/i);
    const optionA = parts[0]?.replace(/^would you rather\s+/i, '').trim();
    const optionB = parts.slice(1).join(' or ').trim();
    return optionA && optionB
        ? `🤔 *Would You Rather…*\n\n🅰️ ${optionA}\n\n*OR*\n\n🅱️ ${optionB}`
        : `🤔 *Would You Rather…*\n\n${question}`;
}

async function wouldYouRatherCommand(sock, chatId, message, http) {
    try {
        http ||= require('axios');
        const response = await http.get(QUESTION_API, {
            timeout: 8000,
            maxContentLength: 64 * 1024,
            maxBodyLength: 64 * 1024
        });
        const question = extractQuestion(response?.data);
        if (!question) throw new Error('The question service returned no question.');

        await sock.sendMessage(chatId, {
            text: formatWouldYouRather(question)
        }, { quoted: message });
    } catch (error) {
        console.error('[WYR_COMMAND_ERROR]', error?.message || error);
        await sock.sendMessage(chatId, {
            text: 'The question service is unavailable right now. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = { wouldYouRatherCommand, extractQuestion, formatWouldYouRather };
