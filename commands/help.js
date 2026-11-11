const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function helpCommand(sock, chatId, message) {
    const nairobiTime = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle: 'short'
    }).format(new Date());
    const helpMessage = `
╔══════════════════════════════════════╗
║          ♛ *𝕯𝕷𝕺𝕽𝕯 𝕱𝕬𝕽𝕳𝕬𝕹 𝕭𝕺𝕿* ♛          ║
╠══════════════════════════════════════╣
║  ⚡ Version: *${settings.version || '3.0.0'}*
║  🕒 Nairobi, Kenya: *${nairobiTime} EAT*
║  👑 Owner: *${settings.botOwner || 'Farhan II'}*
║  💠 Status: *POWERED BY FARHAN II*
╚══════════════════════════════════════╝

╔══════════════ 🌐 GENERAL COMMANDS ══════════════╗
║ 💎 .help / .menu
║ 💎 .ping
║ 💎 .alive
║ 💎 .tts <text>
║ 💎 .owner
║ 💎 .joke
║ 💎 .quote
║ 💎 .fact
║ 💎 .status / .uptime
║ 💎 .weather <city>
║ 💎 .news
║ 💎 .attp <text>
║ 💎 .lyrics <song_title>
║ 💎 .8ball <question>
║ 💎 .groupinfo
║ 💎 .staff / .admins
║ 💎 .vv
║ 💎 .trt <text> <lang>
║ 💎 .ss <link>
║ 💎 .jid
║ 💎 .url
╚══════════════════════════════════════════════╝

╔══════════════ 👮 ADMIN COMMANDS ═══════════════╗
║ 💎 .ban @user
║ 💎 .promote @user
║ 💎 .demote @user
║ 💎 .mute <minutes>
║ 💎 .unmute
║ 💎 .delete / .del
║ 💎 .kick @user
║ 💎 .warnings @user
║ 💎 .warn @user
║ 💎 .antilink
║ 💎 .antibadword
║ 💎 .clear
║ 💎 .tag <message>
║ 💎 .tagall
║ 💎 .tagnotadmin
║ 💎 .hidetag <message>
║ 💎 .chatbot
║ 💎 .resetlink
║ 💎 .antitag <on/off>
║ 💎 .welcome <on/off>
║ 💎 .goodbye <on/off>
║ 💎 .setgdesc <description>
║ 💎 .setgname <new name>
║ 💎 .setgpp (reply to image)
╚══════════════════════════════════════════════╝

╔══════════════ 👑 OWNER COMMANDS ═══════════════╗
║ 💎 .mode <public/private>
║ 💎 .clearsession
║ 💎 .antidelete
║ 💎 .cleartmp
║ 💎 .update
║ 💎 .restart
║ 💎 .settings
║ 💎 .setpp <reply to image>
║ 💎 .autoreact <on/off>
║ 💎 .autostatus <on/off>
║ 💎 .autotyping <on/off>
║ 💎 .autoread <on/off>
║ 💎 .anticall <on/off>
║ 💎 .pmblocker <on/off/status>
║ 💎 .setmention <reply to msg>
║ 💎 .mention <on/off>
╚══════════════════════════════════════════════╝

╔══════════════ 🎨 IMAGE & STICKER ══════════════╗
║ 💎 .blur <image>
║ 💎 .simage <reply to sticker>
║ 💎 .sticker <reply to image>
║ 💎 .removebg
║ 💎 .remini
║ 💎 .crop <reply to image>
║ 💎 .tgsticker <link>
║ 💎 .meme
║ 💎 .take <packname>
║ 💎 .emojimix <emj1>+<emj2>
║ 💎 .igs <instagram link>
╚══════════════════════════════════════════════╝

╔══════════════════ 🖼️ PIES COMMANDS ═════════════════╗
║ 💎 .pies <country>
║ 💎 .china
║ 💎 .indonesia
║ 💎 .japan
║ 💎 .korea
║ 💎 .malaysia
╚══════════════════════════════════════════════╝

╔══════════════════ 🎮 GAME COMMANDS ═════════════════╗
║ 💎 .tictactoe @user
║ 💎 .hangman
║ 💎 .guess <letter>
║ 💎 .trivia
║ 💎 .answer <answer>
║ 💎 .truth
║ 💎 .dare
╚══════════════════════════════════════════════╝

╔══════════════════ 🤖 AI COMMANDS ═══════════════════╗
║ 💎 .gpt <question>
║ 💎 .gemini <question>
║ 💎 .imagine <prompt>
║ 💎 .flux <prompt>
║ 💎 .sora <prompt>
╚══════════════════════════════════════════════╝

╔══════════════════ 🎯 FUN COMMANDS ══════════════════╗
║ 💎 .compliment @user
║ 💎 .insult @user
║ 💎 .flirt
║ 💎 .shayari
║ 💎 .goodnight
║ 💎 .roseday
║ 💎 .character @user
║ 💎 .wasted @user
║ 💎 .ship @user
║ 💎 .simp @user
║ 💎 .stupid @user [text]
╚══════════════════════════════════════════════╝

╔════════════════ 📥 DOWNLOAD COMMANDS ═══════════════╗
║ 💎 .play <song_name>
║ 💎 .song <song_name>
║ 💎 .spotify <query>
║ 💎 .instagram <link>
║ 💎 .facebook <link>
║ 💎 .tiktok <link>
║ 💎 .video <song name>
╚══════════════════════════════════════════════╝

╔══════════════════ 💻 GITHUB COMMANDS ═══════════════╗
║ 💎 .git
║ 💎 .github
╚══════════════════════════════════════════════╝

       ⚡ *👑 𝕃𝕆ℝ𝔻 𝔽𝔸ℝℍ𝔸ℕ 𝔹𝕆𝕋 👑 — POWERED BY FARHAN II* ⚡
`;

    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: helpMessage,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true
                }
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: helpMessage,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true
                }
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: helpMessage });
    }
}

module.exports = helpCommand;
