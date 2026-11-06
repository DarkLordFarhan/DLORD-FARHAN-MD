const axios = require('axios');

module.exports = async function (sock, chatId) {
    const apiKey = process.env.NEWS_API_KEY || '';
    if (!apiKey) {
        return sock.sendMessage(chatId, { text: 'NewsAPI is not configured on this deployment.' });
    }

    try {
        const response = await axios.get('https://newsapi.org/v2/top-headlines', {
            params: { country: 'us', apiKey }
        });
        const articles = Array.isArray(response.data?.articles)
            ? response.data.articles.slice(0, 5)
            : [];

        if (!articles.length) {
            return sock.sendMessage(chatId, { text: 'No headlines are available right now.' });
        }

        const newsMessage = '📰 *Latest News*:\n\n' + articles
            .map((article, index) => `${index + 1}. *${article.title || 'Untitled'}*\n${article.description || ''}`)
            .join('\n\n');
        await sock.sendMessage(chatId, { text: newsMessage });
    } catch (error) {
        console.error('NewsAPI request failed:', error.response?.status || 'network error');
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch news right now.' });
    }
};
