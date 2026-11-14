let cachedToken = '';
let tokenExpiresAt = 0;

async function getSpotifyToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('Spotify API credentials are not configured.');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    if (!response.ok) throw new Error(`Spotify token request failed (${response.status}).`);

    const data = await response.json();
    if (!data.access_token) throw new Error('Spotify did not return an access token.');
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + Math.max(30, Number(data.expires_in) - 30) * 1000;
    return cachedToken;
}

async function searchSpotify(query) {
    const token = await getSpotifyToken();
    const trackMatch = query.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/i);
    const endpoint = trackMatch
        ? `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackMatch[1])}`
        : `https://api.spotify.com/v1/search?${new URLSearchParams({ q: query, type: 'track', limit: '5' })}`;
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Spotify search failed (${response.status}).`);

    const data = await response.json();
    if (trackMatch) return [data];
    return data.tracks?.items || [];
}

async function spotifyCommand(sock, chatId, message) {
    try {
        const rawText = String(
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        ).trim();
        const query = rawText.replace(/^\S+\s*/, '').trim();
        if (!query) {
            await sock.sendMessage(chatId, {
                text: 'Usage: .spotify <track, artist, or Spotify track link>'
            }, { quoted: message });
            return;
        }

        const tracks = await searchSpotify(query);
        const track = tracks[0];
        if (!track) {
            await sock.sendMessage(chatId, { text: 'No Spotify tracks matched that search.' }, { quoted: message });
            return;
        }

        const artists = (track.artists || []).map(artist => artist.name).join(', ') || 'Unknown artist';
        const duration = Number.isFinite(track.duration_ms)
            ? `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}`
            : 'Unknown';
        const spotifyUrl = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;
        const caption = `🎵 ${track.name || 'Unknown title'}\n👤 ${artists}\n⏱ ${duration}\n${spotifyUrl}\n\nSpotify's official API provides track metadata, not downloadable audio.`;
        const cover = track.album?.images?.[0]?.url;

        await sock.sendMessage(chatId, cover
            ? { image: { url: cover }, caption }
            : { text: caption },
        { quoted: message });
    } catch (error) {
        console.error('[SPOTIFY] API error:', error?.message || error);
        const text = error.message === 'Spotify API credentials are not configured.'
            ? 'Spotify catalog search needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the bot environment. Spotify does not provide an official API for downloading full tracks.'
            : 'Spotify could not complete the catalog search. Check the API credentials and try again.';
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = spotifyCommand;
