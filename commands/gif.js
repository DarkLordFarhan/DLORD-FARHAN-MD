const axios = require('axios');
const settings = require('../settings');

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const GIPHY_CDN_HOST = /(^|\.)giphy\.com$/i;

function getQuery(message) {
    const rawText = String(
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ''
    ).trim();
    return rawText.replace(/^\S+\s*/, '').trim();
}

function isGiphyCdnUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && GIPHY_CDN_HOST.test(url.hostname);
    } catch {
        return false;
    }
}

async function gifCommand(sock, chatId, message) {
    const query = getQuery(message);
    if (!query) {
        await sock.sendMessage(chatId, {
            text: 'Usage: .gif <search term>'
        }, { quoted: message });
        return;
    }
    if (query.length > 50) {
        await sock.sendMessage(chatId, {
            text: 'GIF search terms must be 50 characters or fewer.'
        }, { quoted: message });
        return;
    }

    const apiKey = process.env.GIPHY_API_KEY || settings.giphyApiKey;
    if (!apiKey) {
        await sock.sendMessage(chatId, {
            text: 'GIF search needs a GIPHY API key. Add GIPHY_API_KEY to the bot environment and restart it.'
        }, { quoted: message });
        return;
    }

    try {
        const response = await axios.get(GIPHY_SEARCH_URL, {
            params: {
                api_key: apiKey,
                q: query,
                limit: 1,
                rating: 'g',
                bundle: 'messaging_non_clips'
            },
            timeout: 15000
        });
        const gif = response.data?.data?.[0];
        const images = gif?.images || {};
        const mp4Url = images.fixed_height?.mp4 || images.downsized_small?.mp4 || images.preview?.mp4;

        if (!mp4Url) {
            await sock.sendMessage(chatId, {
                text: `No GIF found for “${query}”. Try another search term.`
            }, { quoted: message });
            return;
        }
        if (!isGiphyCdnUrl(mp4Url)) throw new Error('GIPHY returned an invalid media URL.');

        await sock.sendMessage(chatId, {
            video: { url: mp4Url },
            mimetype: 'video/mp4',
            gifPlayback: true,
            caption: `GIF: ${query}`
        }, { quoted: message });
    } catch (error) {
        const status = error.response?.status;
        console.error('[GIF] GIPHY request failed:', status || error.code || error.message);
        const text = status === 401 || status === 403
            ? 'GIPHY rejected the configured API key. Check GIPHY_API_KEY.'
            : 'GIPHY search failed. Try again later.';
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = gifCommand;
