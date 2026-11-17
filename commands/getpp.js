const { startLimitedOperation, withTimeout } = require('../lib/with-timeout');

const MAX_PENDING_PROFILE_OPERATIONS = 2;
const pendingProfileLookups = new WeakMap();
const pendingProfileSends = new WeakMap();

function getProfilePictureTarget(message, senderId) {
    const context = message?.message?.extendedTextMessage?.contextInfo;
    if (Array.isArray(context?.mentionedJid) && context.mentionedJid[0]) return context.mentionedJid[0];
    if (context?.stanzaId && context?.quotedMessage && context?.participant) return context.participant;
    return senderId || message?.key?.participant || (message?.key?.remoteJid?.endsWith('@s.whatsapp.net') ? message.key.remoteJid : null);
}

async function getProfilePictureCommand(sock, chatId, message, senderId, options = {}) {
    const target = getProfilePictureTarget(message, senderId);
    if (!target || target.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'I could not identify a participant. Mention someone or reply to their message.' }, { quoted: message });
        return;
    }
    try {
        const imageUrl = await withTimeout(
            startLimitedOperation(
                pendingProfileLookups,
                sock,
                MAX_PENDING_PROFILE_OPERATIONS,
                () => sock.profilePictureUrl(target, 'image'),
                'Earlier profile-picture lookups are still pending.'
            ),
            options.timeoutMs ?? 8000,
            'Profile-picture lookup timed out.'
        );
        if (!imageUrl) throw new Error('No profile photo was returned.');
        const profileSend = startLimitedOperation(
            pendingProfileSends,
            sock,
            MAX_PENDING_PROFILE_OPERATIONS,
            () => sock.sendMessage(chatId, {
                image: { url: imageUrl },
                caption: `Profile picture for @${target.split('@')[0].split(':')[0]}`,
                mentions: [target]
            }, { quoted: message }),
            'Earlier profile-picture messages are still pending.'
        );
        try {
            await withTimeout(
                profileSend,
                options.sendTimeoutMs ?? options.timeoutMs ?? 8000,
                'Profile-picture message send timed out.'
            );
        } catch (sendError) {
            if (sendError?.code === 'COMMAND_TIMEOUT' || sendError?.code === 'COMMAND_BUSY') {
                console.error('[getpp] Profile-picture send timed out; not sending a second possibly-duplicate reply.');
                return;
            }
            throw sendError;
        }
    } catch (error) {
        console.error('[getpp] Profile picture is unavailable:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'That participant has no profile picture available to the bot, or WhatsApp could not load it.' }, { quoted: message });
    }
}

module.exports = { getProfilePictureCommand, getProfilePictureTarget };
