function normalizePhoneNumber(input) {
    const raw = String(input || '').trim();
    if (!raw || !/^[+()\d\s.-]+$/.test(raw)) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

async function wameCommand(sock, chatId, message, input) {
    const number = normalizePhoneNumber(input);
    if (!number) {
        await sock.sendMessage(chatId, {
            text: 'Usage: .wame <international phone number>\nExample: .wame +254 795 463 911'
        }, { quoted: message });
        return;
    }
    await sock.sendMessage(chatId, {
        text: `WhatsApp chat link: https://wa.me/${number}`
    }, { quoted: message });
}

module.exports = { normalizePhoneNumber, wameCommand };
