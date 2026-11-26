const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'data', 'autorecording.json');

function readConfig(configPath = DEFAULT_CONFIG_PATH) {
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { enabled: parsed.enabled === true };
    } catch {
        return { enabled: false };
    }
}

function writeConfig(config, configPath = DEFAULT_CONFIG_PATH) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ enabled: Boolean(config.enabled) }, null, 2));
}

function getArguments(message) {
    const text = String(
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        ''
    ).trim();
    return text.replace(/^\.autorecording\b/i, '').trim().split(/\s+/).filter(Boolean);
}

async function autorecordingCommand(sock, chatId, message, options = {}) {
    const configPath = options.configPath || DEFAULT_CONFIG_PATH;
    try {
        const senderId = message?.key?.participant || message?.key?.remoteJid || chatId;
        const ownerCheck = options.isOwnerOrSudo || isOwnerOrSudo;
        const isOwner = await ownerCheck(senderId, sock, chatId);
        if (!message?.key?.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner.' }, { quoted: message });
            return;
        }

        const config = readConfig(configPath);
        const action = getArguments(message)[0]?.toLowerCase();
        if (action === 'on' || action === 'enable') config.enabled = true;
        else if (action === 'off' || action === 'disable') config.enabled = false;
        else if (action) {
            await sock.sendMessage(chatId, { text: 'Usage: .autorecording on/off' }, { quoted: message });
            return;
        } else config.enabled = !config.enabled;

        writeConfig(config, configPath);
        await sock.sendMessage(chatId, {
            text: `✅ Auto-recording presence has been ${config.enabled ? 'enabled' : 'disabled'}.`
        }, { quoted: message });
    } catch (error) {
        console.error('[autorecording] Command failed:', error?.message || error);
        await sock.sendMessage(chatId, { text: '❌ Could not update auto-recording settings.' }, { quoted: message });
    }
}

function isAutoRecordingEnabled(configPath = DEFAULT_CONFIG_PATH) {
    return readConfig(configPath).enabled;
}

async function handleAutoRecordingForMessage(sock, chatId, userMessage = '', options = {}) {
    if (!isAutoRecordingEnabled(options.configPath || DEFAULT_CONFIG_PATH)) return false;
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('available', chatId);
        await sock.sendPresenceUpdate('recording', chatId);
        const configuredDelay = Number(options.delayMs);
        const delayMs = Number.isFinite(configuredDelay)
            ? Math.max(0, Math.min(8000, configuredDelay))
            : Math.max(2500, Math.min(6000, String(userMessage || '').length * 120));
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return true;
    } catch (error) {
        console.error('[autorecording] Could not send recording presence:', error?.message || error);
        return false;
    } finally {
        try {
            await sock.sendPresenceUpdate('paused', chatId);
        } catch (error) {
            console.error('[autorecording] Could not clear recording presence:', error?.message || error);
        }
    }
}

module.exports = {
    autorecordingCommand,
    handleAutoRecordingForMessage,
    isAutoRecordingEnabled,
    readConfig,
    writeConfig
};
