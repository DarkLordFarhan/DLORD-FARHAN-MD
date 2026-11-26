const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');

const DEFAULT_RULES_PATH = path.join(__dirname, '..', 'data', 'group-rules.json');

function readRules(filePath = DEFAULT_RULES_PATH) {
    try {
        const rules = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
    } catch {
        return {};
    }
}

function writeRules(rules, filePath = DEFAULT_RULES_PATH) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(rules, null, 2));
    fs.renameSync(temporaryPath, filePath);
}

async function groupRulesCommand(sock, chatId, senderId, message, text = '', options = {}) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in a group.' }, { quoted: message });
        return;
    }

    const filePath = options.filePath || DEFAULT_RULES_PATH;
    const newRules = String(text || '').trim();
    if (!newRules) {
        const currentRules = readRules(filePath)[chatId];
        await sock.sendMessage(chatId, {
            text: currentRules
                ? `📜 *${options.groupName || 'Group'} rules*\n\n${currentRules}`
                : 'No group rules have been set. A group admin can set them with `.rules <text>`.'
        }, { quoted: message });
        return;
    }
    if (newRules.length > 1500) {
        await sock.sendMessage(chatId, { text: 'Group rules must be 1,500 characters or fewer.' }, { quoted: message });
        return;
    }

    const adminCheck = options.isAdmin || isAdmin;
    const { isSenderAdmin } = await adminCheck(sock, chatId, senderId, options.adminOptions);
    if (!isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only a group admin can set or clear group rules.' }, { quoted: message });
        return;
    }

    const rules = readRules(filePath);
    if (/^(?:off|clear|delete)$/i.test(newRules)) delete rules[chatId];
    else rules[chatId] = newRules;
    try {
        writeRules(rules, filePath);
        await sock.sendMessage(chatId, {
            text: rules[chatId] ? '✅ Group rules have been saved.' : '✅ Group rules have been cleared.'
        }, { quoted: message });
    } catch (error) {
        console.error('[rules] Could not save group rules:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Could not save the group rules.' }, { quoted: message });
    }
}

module.exports = { groupRulesCommand, readRules, writeRules };
