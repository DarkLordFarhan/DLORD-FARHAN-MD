const settings = require('../settings');
const fs = require('fs');
const path = require('path');

const OWNER_WHATSAPP = '+254795463911';
const menuSessions = new Map();
const MENU_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MENU_SESSIONS = 500;

function parseMenuCategories(menuBody) {
    const categories = [];
    let currentCategory = null;

    for (const rawLine of menuBody.trim().split('\n')) {
        const line = rawLine.trim();
        const heading = line.match(/^\*([^*]+)\*$/);
        if (heading) {
            currentCategory = { title: heading[1], commands: [] };
            categories.push(currentCategory);
            continue;
        }

        if (!currentCategory || !line || line.startsWith('⚡')) continue;
        currentCategory.commands.push(line.replace(/^•\s*/, ''));
    }

    return categories;
}

function rememberMenuSession(chatId, sentMessage, categories) {
    const messageId = sentMessage?.key?.id;
    if (!messageId) return;

    const now = Date.now();
    for (const [key, session] of menuSessions) {
        if (session.expiresAt <= now) menuSessions.delete(key);
    }
    while (menuSessions.size >= MAX_MENU_SESSIONS) {
        menuSessions.delete(menuSessions.keys().next().value);
    }

    menuSessions.set(`${chatId}:${messageId}`, {
        categories,
        expiresAt: now + MENU_SESSION_TTL_MS
    });
}

async function handleMenuCategoryReply(sock, chatId, message) {
    const selectedText = (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).trim();
    const quotedMenuId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (!/^\d{1,2}$/.test(selectedText) || !quotedMenuId) return false;

    const sessionKey = `${chatId}:${quotedMenuId}`;
    const session = menuSessions.get(sessionKey);
    if (!session || session.expiresAt <= Date.now()) {
        menuSessions.delete(sessionKey);
        return false;
    }

    const categoryNumber = Number(selectedText);
    const category = session.categories[categoryNumber - 1];
    if (!category) {
        await sock.sendMessage(chatId, {
            text: `Choose a category number from 1 to ${session.categories.length}.`
        }, { quoted: message });
        return true;
    }

    const commandLines = category.commands.map(item =>
        item.startsWith('.') ? `🔹 ${item}` : `• ${item}`
    );
    await sock.sendMessage(chatId, {
        text: `*${categoryNumber}. ${category.title}*\n\n${commandLines.join('\n')}`
    }, { quoted: message });
    return true;
}

async function helpCommand(sock, chatId, message) {
    const nairobiTime = new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date());
    const botName = settings.botName || 'LORD FARHAN BOT';
    const ownerName = settings.botOwner || 'Farhan II';
    const ownerVersion = settings.version || '3.0.0';

    const menuBody = `
*🌐 GENERAL*
• .help / .menu
• .ping
• .alive
• .tts <text>
• .owner
• .joke
• .quote
• .fact
• .status / .uptime
• .weather <city>
• .news
• .attp <text>
• .lyrics <song_title>
• .8ball <question>
• .groupinfo
• .staff / .admins
• .vv (reply to view-once photo/video)
• .trt <text> <lang>
• .ss <link>
• .jid
• .url

*👮 ADMIN*
• .ban @user
• .promote @user
• .demote @user
• .mute <minutes>
• .unmute
• .delete / .del
• .kick @user
• .warnings @user
• .warn @user
• .antilink
• .antibadword
• .clear
• .tag <message>
• .tagall
• .tagnotadmin
• .hidetag <message>
• .chatbot
• .resetlink
• .antitag <on/off>
• .welcome <on/off>
• .goodbye <on/off>
• .setgdesc <description>
• .setgname <new name>
• .setgpp (reply to image)

*👑 OWNER*
• .mode <public/private>
• .clearsession
• .antidelete
• .cleartmp
• .update
• .restart
• .settings
• .setpp (reply to image)
• .autoreact <on/off>
• .autostatus on/off
• .autostatus react on/off
• .autostatus emoji <emojis>
• .autotyping <on/off>
• .autoread <on/off>
• .anticall <on/off>
• .pmblocker <on/off/status>
• .setmention (reply to msg)
• .mention <on/off>

*🎨 IMAGE & STICKER*
• .blur <image>
• .simage <reply to sticker>
• .sticker <reply to image>
• .removebg
• .remini
• .crop <reply to image>
• .tgsticker <link>
• .meme
• .take <packname>
• .emojimix <emj1>+<emj2>
• .igs <instagram link>

*✨ TEXT EFFECTS*
• .metallic <text>
• .ice <text>
• .snow <text>
• .impressive <text>
• .matrix <text>
• .light <text>
• .neon <text>
• .devil <text>
• .purple <text>
• .thunder <text>
• .leaves <text>
• .1917 <text>
• .arena <text>
• .hacker <text>
• .sand <text>
• .blackpink <text>
• .glitch <text>
• .fire <text>

*🖼️ PIES*
• .pies <country>
• .china
• .indonesia
• .japan
• .korea
• .malaysia

*🎮 GAMES*
• .tictactoe @user
• .hangman
• .guess <letter>
• .trivia
• .answer <answer>
• .truth
• .dare

*🤖 AI*
• .gpt <question>
• .gemini <question>
• .imagine <prompt>
• .dalle <prompt>
  OpenAI image alias
• .flux <prompt>
• .sora <prompt>
  Veo video; Gemini key required
• Missing text/image keys use AI Horde
• Prompts go to volunteer workers
• Anonymous images shared with LAION
• Avoid private/sensitive prompts

*🎯 FUN*
• .compliment @user
• .insult @user
• .flirt
• .shayari
• .goodnight
• .roseday
• .character @user
• .wasted @user
• .ship @user
• .simp @user
• .stupid @user [text]
• .gif <search term>

*📥 DOWNLOADS*
• .play <song_name>
• .song <song_name>
• .spotify <query>
• .instagram <link>
• .facebook <link>
• .tiktok <link>
• .video <song name>

*💻 GITHUB*
• .git
• .github
• .repo

⚡ *LORD FARHAN BOT — POWERED BY FARHAN II* ⚡
`;

    const listedCommands = (menuBody.match(/^•\s+\.\S+/gm) || []).length;
    const aliasCommands = (menuBody.match(/\s\/\s\.\S+/g) || []).length;
    const commandCount = listedCommands + aliasCommands;

    const introMessage = [
        `*${botName}*`,
        `Owner: *${ownerName}*`,
        `Time: *${nairobiTime} EAT*`,
        'State: *🟢 ONLINE*',
        `Commands listed: *${commandCount}*`,
        `Version: *${ownerVersion}*`,
        `Owner WhatsApp: *${OWNER_WHATSAPP}*`
    ].join('\n');

    const categories = parseMenuCategories(menuBody);
    const categoryList = categories
        .map((category, index) => `${index + 1}. *${category.title}*`)
        .join('\n');
    const menuCaption = [
        introMessage,
        '*📂 COMMAND CATEGORIES*',
        categoryList,
        'Reply to this image with a category number to see its commands.'
    ].join('\n\n');

    const contextInfo = {
        forwardingScore: 1,
        isForwarded: true
    };

    let sentMenu;
    try {
        const bannerPath = path.join(__dirname, '../assets/menu_bot_image.jpg');
        if (fs.existsSync(bannerPath)) {
            sentMenu = await sock.sendMessage(chatId, {
                image: fs.readFileSync(bannerPath),
                caption: menuCaption,
                contextInfo
            }, { quoted: message });
        } else {
            sentMenu = await sock.sendMessage(chatId, { text: menuCaption, contextInfo }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in help banner:', error);
        sentMenu = await sock.sendMessage(chatId, { text: menuCaption, contextInfo }, { quoted: message });
    }

    rememberMenuSession(chatId, sentMenu, categories);
}

module.exports = helpCommand;
module.exports.handleMenuCategoryReply = handleMenuCategoryReply;
