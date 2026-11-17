const settings = require('../settings');

async function ownerCommand(sock, chatId) {
    const ownerNumber = String(settings.ownerNumber || '').replace(/\D/g, '');
    const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:${settings.botOwner}
TEL;waid=${ownerNumber}:+${ownerNumber}
END:VCARD
`;

    await sock.sendMessage(chatId, {
        contacts: { displayName: settings.botOwner, contacts: [{ vcard }] },
    });
}

module.exports = ownerCommand;
