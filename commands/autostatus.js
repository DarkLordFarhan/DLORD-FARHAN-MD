const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const DEFAULT_REACTION_EMOJIS = ['💚'];
const MAX_REACTION_EMOJIS = 10;
const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const EMOJI_COMPONENTS_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3#*0-9]+$/u;
const EMOJI_BASE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const KEYCAP_EMOJI = /^[#*0-9]\uFE0F?\u20E3$/u;

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true
    }
};

const configPath = path.join(__dirname, '../data/autoStatus.json');

if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
        enabled: false,
        reactOn: false,
        reactEmojis: DEFAULT_REACTION_EMOJIS
    }, null, 2));
}

function isEmojiGrapheme(value) {
    return EMOJI_COMPONENTS_ONLY.test(value) &&
        (EMOJI_BASE.test(value) || KEYCAP_EMOJI.test(value));
}

function parseReactionEmojis(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('Enter at least one emoji.');
    if (input.length > 128) throw new Error('Use no more than 10 emojis.');

    const emojis = input
        .split(/[\s,]+/u)
        .filter(Boolean)
        .flatMap(part => Array.from(emojiSegmenter.segment(part), item => item.segment));
    const uniqueEmojis = [...new Set(emojis)];

    if (!uniqueEmojis.length || uniqueEmojis.some(emoji => !isEmojiGrapheme(emoji))) {
        throw new Error('Use emoji characters only.');
    }
    if (uniqueEmojis.length > MAX_REACTION_EMOJIS) {
        throw new Error(`Choose no more than ${MAX_REACTION_EMOJIS} emojis.`);
    }

    return uniqueEmojis;
}

function getReactionEmojis(config = {}) {
    const configured = Array.isArray(config.reactEmojis)
        ? config.reactEmojis.join(' ')
        : config.reactEmojis;
    if (!configured) return [...DEFAULT_REACTION_EMOJIS];

    try {
        return parseReactionEmojis(configured);
    } catch {
        return [...DEFAULT_REACTION_EMOJIS];
    }
}

function readAutoStatusConfig(filePath = configPath) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        throw new Error('Auto status configuration is invalid.');
    }

    return {
        ...saved,
        enabled: saved.enabled === true,
        reactOn: saved.reactOn === true,
        reactEmojis: getReactionEmojis(saved)
    };
}

function writeAutoStatusConfig(config, filePath = configPath) {
    const updated = {
        ...config,
        reactEmojis: getReactionEmojis(config)
    };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
}

function selectReactionEmoji(config = {}, random = Math.random) {
    const emojis = getReactionEmojis(config);
    const roll = Number(random());
    const index = Number.isFinite(roll)
        ? Math.min(emojis.length - 1, Math.max(0, Math.floor(roll * emojis.length)))
        : 0;
    return emojis[index];
}

async function autoStatusCommand(sock, chatId, msg, args, filePath = configPath) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command can only be used by the owner!',
                ...channelInfo
            });
            return;
        }

        const config = readAutoStatusConfig(filePath);
        const commandArgs = Array.isArray(args) ? args.map(String) : [];

        if (commandArgs.length === 0) {
            await sock.sendMessage(chatId, {
                text: `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* ${config.enabled ? 'enabled' : 'disabled'}\n💫 *Status Reactions:* ${config.reactOn ? 'enabled' : 'disabled'}\n✨ *Reaction Emojis:* ${config.reactEmojis.join(' ')}\n\n*Commands:*\n.autostatus on/off - Enable/disable automatic status viewing\n.autostatus react on/off - Enable/disable status reactions\n.autostatus emoji <emojis> - Choose up to 10 reaction emojis\n.autostatus emoji - Show the current emoji list\n.autostatus emoji reset - Restore the default 💚 emoji`,
                ...channelInfo
            });
            return;
        }

        const command = commandArgs[0].toLowerCase();
        const reactEmojiAlias = command === 'react' &&
            ['emoji', 'emojis'].includes((commandArgs[1] || '').toLowerCase());
        const emojiCommand = ['emoji', 'emojis'].includes(command) || reactEmojiAlias;

        if (emojiCommand) {
            const startIndex = reactEmojiAlias ? 2 : 1;
            const emojiInput = commandArgs.slice(startIndex).join(' ').trim();

            if (!emojiInput) {
                await sock.sendMessage(chatId, {
                    text: `✨ *Status reaction emojis:* ${config.reactEmojis.join(' ')}\nUse .autostatus emoji ❤️ 😂 🔥 to set a list, or .autostatus emoji reset to restore 💚. One emoji is selected at random for each status.`,
                    ...channelInfo
                });
                return;
            }

            if (emojiInput.toLowerCase() === 'reset') {
                config.reactEmojis = [...DEFAULT_REACTION_EMOJIS];
                writeAutoStatusConfig(config, filePath);
                await sock.sendMessage(chatId, {
                    text: `✅ Status reaction emoji list reset to ${DEFAULT_REACTION_EMOJIS.join(' ')}.`,
                    ...channelInfo
                });
                return;
            }

            try {
                config.reactEmojis = parseReactionEmojis(emojiInput);
            } catch (error) {
                await sock.sendMessage(chatId, {
                    text: `❌ ${error.message}\nExample: .autostatus emoji ❤️ 😂 🔥 (up to 10 emojis).`,
                    ...channelInfo
                });
                return;
            }

            writeAutoStatusConfig(config, filePath);
            await sock.sendMessage(chatId, {
                text: `✅ Status reaction emojis saved: ${config.reactEmojis.join(' ')}\nOne emoji will be selected at random for each status. Enable reactions with .autostatus react on.`,
                ...channelInfo
            });
        } else if (command === 'on') {
            config.enabled = true;
            writeAutoStatusConfig(config, filePath);
            await sock.sendMessage(chatId, {
                text: '✅ Auto status view has been enabled!\nBot will now automatically view contact statuses.',
                ...channelInfo
            });
        } else if (command === 'off') {
            config.enabled = false;
            writeAutoStatusConfig(config, filePath);
            await sock.sendMessage(chatId, {
                text: '❌ Auto status view has been disabled. Status reactions remain controlled separately with .autostatus react on/off.',
                ...channelInfo
            });
        } else if (command === 'react') {
            const reactCommand = (commandArgs[1] || '').toLowerCase();
            if (reactCommand === 'on') {
                config.reactOn = true;
                writeAutoStatusConfig(config, filePath);
                await sock.sendMessage(chatId, {
                    text: `💫 Status reactions enabled. One of these emojis will be used: ${config.reactEmojis.join(' ')}`,
                    ...channelInfo
                });
            } else if (reactCommand === 'off') {
                config.reactOn = false;
                writeAutoStatusConfig(config, filePath);
                await sock.sendMessage(chatId, {
                    text: '❌ Status reactions have been disabled.',
                    ...channelInfo
                });
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Use .autostatus react on/off, or .autostatus react emoji ❤️ 😂 🔥 to set reaction emojis.',
                    ...channelInfo
                });
            }
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Invalid command! Use:\n.autostatus on/off\n.autostatus react on/off\n.autostatus emoji <emojis|reset>',
                ...channelInfo
            });
        }
    } catch (error) {
        console.error('Error in autostatus command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Error occurred while managing auto status!\n' + error.message,
            ...channelInfo
        });
    }
}

async function reactToStatus(sock, statusKey, configOverride) {
    try {
        const config = configOverride || readAutoStatusConfig();
        if (!config.reactOn) return;

        await sock.relayMessage(
            'status@broadcast',
            {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: statusKey.participant || statusKey.remoteJid,
                        fromMe: false
                    },
                    text: selectReactionEmoji(config)
                }
            },
            {
                messageId: statusKey.id,
                statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
            }
        );
    } catch (error) {
        console.error('❌ Error reacting to status:', error.message);
    }
}

async function handleStatusKey(sock, statusKey, config) {
    try {
        if (config.enabled) await sock.readMessages([statusKey]);
        if (config.reactOn) await reactToStatus(sock, statusKey, config);
    } catch (error) {
        if (config.enabled && error.message?.includes('rate-overlimit')) {
            console.log('⚠️ Rate limit hit, waiting before retrying...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            await sock.readMessages([statusKey]);
        } else {
            throw error;
        }
    }
}

async function handleStatusUpdate(sock, status, configOverride) {
    try {
        const config = configOverride || readAutoStatusConfig();
        if (!config.enabled && !config.reactOn) return;

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (status.messages && status.messages.length > 0) {
            const msg = status.messages[0];
            if (msg.key && msg.key.remoteJid === 'status@broadcast') {
                await handleStatusKey(sock, msg.key, config);
                return;
            }
        }

        if (status.key && status.key.remoteJid === 'status@broadcast') {
            await handleStatusKey(sock, status.key, config);
            return;
        }

        if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
            await handleStatusKey(sock, status.reaction.key, config);
        }
    } catch (error) {
        console.error('❌ Error in auto status view:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate,
    parseReactionEmojis,
    selectReactionEmoji,
    reactToStatus
};
