const settings = require('../settings');
const fs = require('fs');
const path = require('path');

const OWNER_WHATSAPP = '+254795463911';

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

    const scrolledMenu = `🔹 *COMMAND MENU* 🔹\n\n${menuBody.trimStart()}`
        .replace(/^(\s*)•\s+/gm, '$1🔹 ')
        .trimEnd();

    const contextInfo = {
        forwardingScore: 1,
        isForwarded: true
    };

    try {
        const bannerPath = path.join(__dirname, '../assets/bot_image.jpg');
        if (fs.existsSync(bannerPath)) {
            await sock.sendMessage(chatId, {
                image: fs.readFileSync(bannerPath),
                caption: introMessage,
                contextInfo
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: introMessage, contextInfo }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in help banner:', error);
        await sock.sendMessage(chatId, { text: introMessage, contextInfo }, { quoted: message });
    }

    try {
        await sock.sendMessage(chatId, { text: scrolledMenu, contextInfo }, { quoted: message });
    } catch (error) {
        console.error('Error in help menu:', error);
        await sock.sendMessage(chatId, { text: scrolledMenu });
    }
}

module.exports = helpCommand;
