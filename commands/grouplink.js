const isAdmin = require('../lib/isAdmin');

async function groupLinkCommand(sock, chatId, senderId, message, options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in a group.' }, { quoted: message });
        return;
    }
    const adminCheck = options.isAdmin || isAdmin;
    const { isSenderAdmin, isBotAdmin } = await adminCheck(sock, chatId, senderId, options.adminOptions);
    if (!isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only a group admin can view the group invite link.' }, { quoted: message });
        return;
    }
    if (!isBotAdmin) {
        await sock.sendMessage(chatId, { text: 'The bot must be a group admin to retrieve the invite link.' }, { quoted: message });
        return;
    }
    try {
        const code = await sock.groupInviteCode(chatId);
        if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('WhatsApp returned no valid invite code.');
        await sock.sendMessage(chatId, { text: `🔗 Current group invite link:\nhttps://chat.whatsapp.com/${code}` }, { quoted: message });
    } catch (error) {
        console.error('[grouplink] Could not retrieve invite link:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Could not retrieve the group invite link. Check the bot admin status and try again.' }, { quoted: message });
    }
}

module.exports = groupLinkCommand;
