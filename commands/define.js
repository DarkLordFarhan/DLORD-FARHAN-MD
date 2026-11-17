function formatDefinitions(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    const entry = entries.find(item => item && Array.isArray(item.meanings)) || entries[0];
    const word = String(entry.word || 'Definition').slice(0, 80);
    const phonetic = entry.phonetic || entry.phonetics?.find(item => item?.text)?.text;
    const lines = [`📖 *${word}*${phonetic ? ` (${String(phonetic).slice(0, 50)})` : ''}`];
    let count = 0;
    for (const meaning of entry.meanings || []) {
        for (const item of meaning.definitions || []) {
            const definition = String(item.definition || '').replace(/\s+/g, ' ').trim();
            if (!definition) continue;
            lines.push(`• _${String(meaning.partOfSpeech || 'meaning').slice(0, 30)}_: ${definition.slice(0, 260)}`);
            count += 1;
            if (count >= 4) return lines.join('\n');
        }
    }
    return lines.join('\n');
}

async function defineCommand(sock, chatId, message, word, options = {}) {
    const term = String(word || '').trim();
    if (!term || term.length > 60 || !/^[\p{L}'’-]+$/u.test(term)) {
        await sock.sendMessage(chatId, { text: 'Usage: .define <one word>\nExample: .define resilient' }, { quoted: message });
        return;
    }
    try {
        const fetchImpl = options.fetch || global.fetch;
        if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
        const response = await fetchImpl(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`, {
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (response.status === 404) {
            await sock.sendMessage(chatId, { text: `No English definition found for “${term}”.` }, { quoted: message });
            return;
        }
        if (response.ok === false) throw new Error(`Dictionary service returned HTTP ${response.status}.`);
        const text = formatDefinitions(await response.json());
        await sock.sendMessage(chatId, {
            text: text || `No definition was returned for “${term}”.`
        }, { quoted: message });
    } catch (error) {
        console.error('[define] Dictionary lookup failed:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'The dictionary service is unavailable right now. Please try again shortly.' }, { quoted: message });
    }
}

module.exports = { defineCommand, formatDefinitions };
