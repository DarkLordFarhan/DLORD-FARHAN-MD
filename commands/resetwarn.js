const fs = require('fs');
const path = require('path');
const MAX_WARNINGS_FILE_BYTES = 2 * 1024 * 1024;

function getWarningTarget(message) {
    const context = message?.message?.extendedTextMessage?.contextInfo;
    if (Array.isArray(context?.mentionedJid) && context.mentionedJid[0]) return context.mentionedJid[0];
    if (context?.stanzaId && context?.quotedMessage && context?.participant) return context.participant;
    return null;
}

async function resetWarnCommand(sock, chatId, message, permissions = {}, options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Use .resetwarn in a group chat.' }, { quoted: message });
        return;
    }
    if (!permissions.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only a group admin can reset warnings.' }, { quoted: message });
        return;
    }
    const target = getWarningTarget(message);
    if (!target) {
        await sock.sendMessage(chatId, { text: 'Mention a participant or reply to their message.\nExample: .resetwarn @user' }, { quoted: message });
        return;
    }

    const fsImpl = options.fs || fs;
    const filePath = options.filePath || path.join(process.cwd(), 'data', 'warnings.json');
    try {
        let warnings = {};
        if (fsImpl.existsSync(filePath)) {
            const fileSize = fsImpl.statSync(filePath).size;
            if (fileSize > MAX_WARNINGS_FILE_BYTES) {
                throw new Error(`Warnings file exceeds the ${MAX_WARNINGS_FILE_BYTES}-byte safety limit.`);
            }
            warnings = JSON.parse(fsImpl.readFileSync(filePath, 'utf8') || '{}');
        }
        const oldCount = Number(warnings?.[chatId]?.[target]) || 0;
        if (!oldCount) {
            await sock.sendMessage(chatId, { text: `@${target.split('@')[0]} has no warnings to reset.`, mentions: [target] }, { quoted: message });
            return;
        }
        delete warnings[chatId][target];
        if (Object.keys(warnings[chatId]).length === 0) delete warnings[chatId];
        fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
        fsImpl.writeFileSync(filePath, JSON.stringify(warnings, null, 2), 'utf8');
        await sock.sendMessage(chatId, {
            text: `✅ *Warnings reset*\nParticipant: @${target.split('@')[0]}\nPrevious warnings: ${oldCount}`,
            mentions: [target]
        }, { quoted: message });
    } catch (error) {
        console.error('[resetwarn] Warning reset failed:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Could not update the warning record. The warnings file may be invalid or unwritable.' }, { quoted: message });
    }
}

module.exports = { resetWarnCommand, getWarningTarget };
