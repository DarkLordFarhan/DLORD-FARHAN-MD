const QUESTION_API = 'https://api.truthordarebot.xyz/v1/paranoia';
const MAX_QUESTION_LENGTH = 1200;

function extractQuestion(data) {
    const value = data?.question ?? data?.result;
    if (typeof value !== 'string') return null;
    const question = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (!question) return null;
    return question.length > MAX_QUESTION_LENGTH
        ? `${question.slice(0, MAX_QUESTION_LENGTH - 1)}…`
        : question;
}

async function paranoiaCommand(sock, chatId, message, http) {
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
            text: `😱 *Paranoia question*\n\n_${question}_`
        }, { quoted: message });
    } catch (error) {
        console.error('[PARANOIA_COMMAND_ERROR]', error?.message || error);
        await sock.sendMessage(chatId, {
            text: 'The paranoia question service is unavailable right now. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = { paranoiaCommand, extractQuestion };
