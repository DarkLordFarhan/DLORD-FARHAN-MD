const STYLES = [
    { id: 1, name: 'Bold', upper: 0x1D400, lower: 0x1D41A, digits: 0x1D7CE },
    { id: 2, name: 'Italic', upper: 0x1D434, lower: 0x1D44E, exceptions: { h: 0x210E } },
    { id: 3, name: 'Bold Italic', upper: 0x1D468, lower: 0x1D482 },
    {
        id: 4, name: 'Script', upper: 0x1D49C, lower: 0x1D4B6,
        exceptions: {
            B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112,
            M: 0x2133, R: 0x211B, e: 0x212F, g: 0x210A, o: 0x2134
        }
    },
    { id: 5, name: 'Bold Script', upper: 0x1D4D0, lower: 0x1D4EA },
    {
        id: 6, name: 'Fraktur', upper: 0x1D504, lower: 0x1D51E,
        exceptions: { C: 0x212D, H: 0x210C, I: 0x2111, R: 0x211C, Z: 0x2128 }
    },
    {
        id: 7, name: 'Double-Struck', upper: 0x1D538, lower: 0x1D552, digits: 0x1D7D8,
        exceptions: { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 }
    },
    { id: 8, name: 'Sans Serif', upper: 0x1D5A0, lower: 0x1D5BA, digits: 0x1D7E2 },
    { id: 9, name: 'Sans Serif Bold', upper: 0x1D5D4, lower: 0x1D5EE, digits: 0x1D7EC },
    { id: 10, name: 'Monospace', upper: 0x1D670, lower: 0x1D68A, digits: 0x1D7F6 },
    { id: 12, name: 'Fullwidth', fullwidth: true }
];

function transform(text, style) {
    const exceptions = style.exceptions || {};
    return Array.from(text, character => {
        if (exceptions[character]) return String.fromCodePoint(exceptions[character]);
        const code = character.codePointAt(0);
        if (style.fullwidth) {
            if (code === 0x20) return character;
            if (code >= 0x21 && code <= 0x7E) return String.fromCodePoint(code + 0xFEE0);
            return character;
        }
        if (code >= 0x41 && code <= 0x5A && style.upper) {
            return String.fromCodePoint(style.upper + code - 0x41);
        }
        if (code >= 0x61 && code <= 0x7A && style.lower) {
            return String.fromCodePoint(style.lower + code - 0x61);
        }
        if (code >= 0x30 && code <= 0x39 && style.digits) {
            return String.fromCodePoint(style.digits + code - 0x30);
        }
        if (style.circled) return character;
        return character;
    }).join('');
}

function transformCircled(text) {
    return Array.from(text, character => {
        const code = character.codePointAt(0);
        if (code >= 0x41 && code <= 0x5A) return String.fromCodePoint(0x24B6 + code - 0x41);
        if (code >= 0x61 && code <= 0x7A) return String.fromCodePoint(0x24D0 + code - 0x61);
        if (code >= 0x31 && code <= 0x39) return String.fromCodePoint(0x2460 + code - 0x31);
        if (code === 0x30) return '⓪';
        return character;
    }).join('');
}

const ALL_STYLES = [...STYLES.slice(0, -1), { id: 11, name: 'Circled', circled: true }, STYLES.at(-1)];

function styleText(text, style) {
    return style.circled ? transformCircled(text) : transform(text, style);
}

function extractCommandText(message) {
    return String(
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ''
    ).trim();
}

async function fancyFontCommand(sock, chatId, message) {
    const rawText = extractCommandText(message);
    const match = rawText.match(/^\.(?:font|fonts|fancyfont|fancy)(?:\s+([\s\S]*))?$/i);
    const input = (match?.[1] || '').trim();
    if (!input) {
        return sock.sendMessage(chatId, {
            text: 'Give me a name to style. Example: .font Farhan\nChoose one style: .font 3 Farhan'
        }, { quoted: message });
    }
    if (input.length > 100) {
        return sock.sendMessage(chatId, { text: 'Please keep the name/text to 100 characters or fewer.' }, { quoted: message });
    }

    const selected = input.match(/^(\d+)\s+([\s\S]+)$/);
    if (selected) {
        const styleId = Number(selected[1]);
        const style = ALL_STYLES.find(candidate => candidate.id === styleId);
        if (!style) {
            return sock.sendMessage(chatId, {
                text: `Choose a style from 1 to ${ALL_STYLES.length}. Example: .font 3 Farhan`
            }, { quoted: message });
        }
        const name = selected[2].trim();
        return sock.sendMessage(chatId, {
            text: `*${style.name}*\n${styleText(name, style)}\n\nCopy the styled text above.`
        }, { quoted: message });
    }
    if (/^\d+$/.test(input)) {
        return sock.sendMessage(chatId, {
            text: `Add a name after the style number. Example: .font 3 Farhan (styles 1–${ALL_STYLES.length})`
        }, { quoted: message });
    }

    const preview = ALL_STYLES.map(style => `${style.id}. ${style.name}: ${styleText(input, style)}`).join('\n');
    return sock.sendMessage(chatId, {
        text: `✨ *FANCY NAME FONTS* ✨\nOriginal: ${input}\n\n${preview}\n\nTo return one style only, send: .font <number> <name>`
    }, { quoted: message });
}

module.exports = fancyFontCommand;
module.exports.ALL_STYLES = ALL_STYLES;
module.exports.styleText = styleText;
