const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

async function fetchJson(url, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch unavailable');
    const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(10000)
            : undefined
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
}

function describeWeatherCode(code) {
    const descriptions = {
        0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
        45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'moderate drizzle',
        55: 'dense drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
        61: 'light rain', 63: 'moderate rain', 65: 'heavy rain', 66: 'freezing rain',
        67: 'heavy freezing rain', 71: 'light snow', 73: 'moderate snow',
        75: 'heavy snow', 77: 'snow grains', 80: 'light rain showers',
        81: 'moderate rain showers', 82: 'heavy rain showers',
        85: 'light snow showers', 86: 'heavy snow showers',
        95: 'thunderstorm', 96: 'thunderstorm with hail',
        99: 'thunderstorm with heavy hail'
    };
    return descriptions[Number(code)] || 'conditions unavailable';
}

async function lookupWeather(city, options = {}) {
    const location = String(city || '').trim();
    if (!location || location.length > 100) throw new Error('LOCATION_INVALID');

    const fetchImpl = options.fetch || globalThis.fetch;
    const geocodingUrl = new URL(GEOCODING_URL);
    geocodingUrl.search = new URLSearchParams({
        name: location,
        count: '1',
        language: 'en',
        format: 'json'
    });
    const geocoding = await fetchJson(geocodingUrl, fetchImpl);
    const place = geocoding.results?.[0];
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        throw new Error('LOCATION_NOT_FOUND');
    }

    const forecastUrl = new URL(FORECAST_URL);
    forecastUrl.search = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
        timezone: 'auto'
    });
    const forecast = await fetchJson(forecastUrl, fetchImpl);
    const current = forecast.current;
    if (!current || typeof current.temperature_2m !== 'number') {
        throw new Error('WEATHER_RESPONSE_INVALID');
    }
    return { place, current, condition: describeWeatherCode(current.weather_code) };
}

async function weatherCommand(sock, chatId, message, city, options = {}) {
    const location = String(city || '').trim();
    if (!location) {
        return sock.sendMessage(
            chatId,
            { text: 'Please provide a city, e.g., .weather Nairobi' },
            message ? { quoted: message } : undefined
        );
    }
    try {
        const { place, current, condition } = await lookupWeather(location, options);
        const placeName = [place.name, place.country].filter(Boolean).join(', ');
        const feelsLike = typeof current.apparent_temperature === 'number'
            ? ` (feels like ${current.apparent_temperature}°C)`
            : '';
        const humidity = typeof current.relative_humidity_2m === 'number'
            ? `, humidity ${current.relative_humidity_2m}%`
            : '';
        const wind = typeof current.wind_speed_10m === 'number'
            ? `, wind ${current.wind_speed_10m} km/h`
            : '';
        await sock.sendMessage(
            chatId,
            { text: `Weather in ${placeName}: ${condition}; ${current.temperature_2m}°C${feelsLike}${humidity}${wind}.` },
            message ? { quoted: message } : undefined
        );
    } catch (error) {
        const text = error.message === 'LOCATION_NOT_FOUND'
            ? 'I could not find that city. Try a city name such as Nairobi or London.'
            : 'Sorry, I could not fetch the weather right now.';
        await sock.sendMessage(
            chatId,
            { text },
            message ? { quoted: message } : undefined
        );
    }
}

module.exports = weatherCommand;
module.exports.describeWeatherCode = describeWeatherCode;
module.exports.lookupWeather = lookupWeather;
