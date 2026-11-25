const settings = require('../settings');

const MENU_SECTION_TITLES = new Set([
    '🌐 GENERAL', '👮 ADMIN', '👑 OWNER', '🎨 IMAGE & STICKER', '✨ TEXT EFFECTS',
    '🖼️ PIES', '🎮 GAMES', '🤖 AI', '🎯 FUN', '📥 DOWNLOADS', '💻 GITHUB'
]);

function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(' ');
}

function createMenuText(commandSource) {
    const sections = [];
    let currentSection = null;

    for (const line of commandSource.split(/\r?\n/)) {
        const heading = line.match(/^\*([^*]+)\*$/);
        if (heading && MENU_SECTION_TITLES.has(heading[1])) {
            currentSection = { title: heading[1], commands: [], notes: [] };
            sections.push(currentSection);
            continue;
        }
        if (!currentSection || !line.trim()) continue;

        const bullet = line.match(/^•\s+(.+)$/);
        const content = bullet ? bullet[1].trim() : line.trim();
        if (content.startsWith('.')) {
            for (const alias of content.split(/\s+\/\s+/)) {
                const command = alias.trim().match(/^\S+/)?.[0];
                if (command?.startsWith('.')) currentSection.commands.push(command);
            }
        } else if (currentSection.title === '🤖 AI' || currentSection.title === '🌐 GENERAL') {
            currentSection.notes.push(content);
        }
    }

    const commandCount = sections.reduce((total, section) => total + section.commands.length, 0);
    const nairobiTime = new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date());
    const intro = [
        '╔════════◇◆◇═══════╗',
        `├ *${settings.botName || 'LORD FARHAN BOT'}*`,
        `├▢👑 Owner: *${settings.botOwner || 'Farhan II'}*`,
        `├▢🕐 Time: *${nairobiTime} EAT*`,
        `├▢⏱️ Uptime: *${formatUptime(process.uptime())}*`,
        '├▢📶 State: *🟢 ONLINE*',
        `├▢🔖 Version: *v${settings.version || '3.0.0'}*`,
        `├▢📚 Commands: *${commandCount}*`,
        '├▢☎️ Owner WhatsApp: *+254795463911*',
        '╚════════◇◆◇═══════╝'
    ].join('\n');
    const categoryText = sections.map(section => [
        '╔═══════════════╗',
        `  *${section.title}*`,
        '╠───────────────╣',
        ...section.commands.map(command => `║ 🔹 *${command}*`),
        ...section.notes.map(note => `║ ℹ️ ${note}`),
        '╚═══════════════╝'
    ].join('\n')).join('\n\n');

    return `${intro}\n\n${categoryText}`;
}

async function helpCommand(sock, chatId, message) {
    const nairobiTime = new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date());
    const helpMessage = `
*♛ LORD FARHAN BOT ♛*
Version: *${settings.version || '3.0.0'}*
Nairobi: *${nairobiTime} EAT*
Owner: *${settings.botOwner || 'Farhan II'}*
*POWERED BY FARHAN II*

*🌐 GENERAL*
• .help / .menu
• .ping
• .alive
• .tts <text>
• .owner
• .joke
• .quote
• .q / .quotedinfo (reply to a message)
• .fact
• .status / .uptime
• .weather <city>
• .news
• .define <word>
• .time [timezone]
• .qr <text or link>
• .wame <international phone number>
• .getpp (mention/reply)
• .attp <text>
• .lyrics <song_title>
• .8ball <question>
• .groupinfo
• .groupstats
• .myactivity
• .staff / .admins
• .vv (reply to view-once photo/video/audio)
  Note: .vv is owner-only and handles only view-once media sent by the linked account
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
• .resetwarn @user (admin)
• .add <phone number>
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
• .toimage <reply to sticker>
• .sticker <reply to image>
• .removebg
• .remini
• .crop <reply to image>
• .tgsticker <link>
• .meme
• .take
• .emojimix <emj1>+<emj2>
• .igs <instagram link>

*✨ TEXT EFFECTS*
• .font <name> [or .font <number> <name>]
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
• .paranoia
• .wyr / .wouldyourather
• .simp @user
• .stupid @user [text]
• .gif <search term>

*📥 DOWNLOADS*
• .yts <search terms>
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

⚡ *LORD FARHAN BOT — POWERED BY FARHAN II* ⚡
`;
    const menuMessage = createMenuText(helpMessage);
    try {
        await sock.sendMessage(chatId, {
            text: menuMessage,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true
            }
        }, { quoted: message });
    } catch (error) {
        console.error('Error sending the menu with forwarding metadata; retrying as plain text:', error);
        await sock.sendMessage(chatId, { text: menuMessage }, { quoted: message });
    }
}

module.exports = helpCommand;
