const axios = require('axios');

module.exports = async function (sock, chatId, message, city) {
    const apiKey = process.env.OPENWEATHER_API_KEY || '';
    const location = String(city || '').trim();
    if (!apiKey) {
        return sock.sendMessage(chatId, { text: 'Weather service is not configured on this deployment.' }, { quoted: message });
    }
    if (!location) {
        return sock.sendMessage(chatId, { text: 'Please provide a city name.' }, { quoted: message });
    }

    try {
        const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
            params: { q: location, appid: apiKey, units: 'metric' }
        });
        const weather = response.data;
        const condition = weather?.weather?.[0]?.description;
        const temperature = weather?.main?.temp;
        if (!weather?.name || !condition || typeof temperature !== 'number') {
            throw new Error('Unexpected weather response');
        }

        const weatherText = `Weather in ${weather.name}: ${condition}. Temperature: ${temperature}°C.`;
        await sock.sendMessage(chatId, { text: weatherText }, { quoted: message });
    } catch (error) {
        console.error('Weather API request failed:', error.response?.status || 'network error');
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch the weather right now.' }, { quoted: message });
    }
};
