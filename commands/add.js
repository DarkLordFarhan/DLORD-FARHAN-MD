const { startLimitedOperation, withTimeout } = require('../lib/with-timeout');

const MAX_PENDING_ADD_UPDATES = 2;
const pendingAddUpdates = new WeakMap();

function normalizeNumber(input) {
    const raw = String(input || '').trim();
    if (!raw || !/^[+()\d\s.-]+$/.test(raw)) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function numberFromJid(jid) {
    if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
    return normalizeNumber(jid.split('@')[0].split(':')[0]);
}

async function addCommand(sock, chatId, message, numberInput, permissions = {}, options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '.add can only be used in a group chat.' }, { quoted: message });
        return;
    }
    if (!permissions.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only a group admin can add participants.' }, { quoted: message });
        return;
    }
    if (!permissions.isBotAdmin) {
        await sock.sendMessage(chatId, { text: 'WhatsApp requires the bot to be a group admin to add participants.' }, { quoted: message });
        return;
    }

    const context = message?.message?.extendedTextMessage?.contextInfo;
    const mentionedJid = context?.mentionedJid?.[0];
    const number = mentionedJid ? numberFromJid(mentionedJid) : normalizeNumber(numberInput);
    if (!number) {
        await sock.sendMessage(chatId, {
            text: 'Usage: .add <international phone number>\nExample: .add 254795463911\nFor privacy and compatibility, use a number rather than a WhatsApp LID mention.'
        }, { quoted: message });
        return;
    }

    const targetJid = `${number}@s.whatsapp.net`;
    try {
        const participantUpdate = startLimitedOperation(
            pendingAddUpdates,
            sock,
            MAX_PENDING_ADD_UPDATES,
            () => sock.groupParticipantsUpdate(chatId, [targetJid], 'add'),
            'Earlier add requests are still pending.'
        );
        const results = await withTimeout(
            participantUpdate,
            options.timeoutMs ?? 8000,
            'WhatsApp did not respond to the add request in time.'
        );
        const result = Array.isArray(results) ? results[0] : results;
        const status = String(result?.status ?? '');
        if (status === '200' || status === '201') {
            await sock.sendMessage(chatId, { text: `WhatsApp accepted the add request for @${number}.`, mentions: [targetJid] }, { quoted: message });
        } else if (status === '409') {
            await sock.sendMessage(chatId, { text: 'That number is already a group participant.' }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: 'WhatsApp did not add that participant. They may need to use the group invite link, or WhatsApp may have blocked the add request.'
            }, { quoted: message });
        }
    } catch (error) {
        console.error('[add] Participant add failed:', error?.message || error);
        const text = error?.code === 'COMMAND_TIMEOUT'
            ? 'The add request timed out. WhatsApp may still finish it, so check the group before retrying.'
            : error?.code === 'COMMAND_BUSY'
                ? 'Earlier add requests are still pending. Check the group before trying again.'
            : 'The add request failed. Check the number and the bot’s group-admin permissions.';
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = { addCommand, normalizeNumber, numberFromJid };
