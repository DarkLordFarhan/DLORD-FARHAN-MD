const assert = require('node:assert/strict');
const test = require('node:test');

const newsCommand = require('../commands/news');
const { parseRss } = newsCommand;
const { buildStatusText, formatDuration } = require('../commands/status');
const restartCommand = require('../commands/update').restartCommand;
const { lookupWeather } = require('../commands/weather');

test('weather lookup uses keyless geocoding and current forecast', async () => {
    const requestedHosts = [];
    const result = await lookupWeather('Nairobi', {
        fetch: async (url) => {
            const parsed = new URL(url);
            requestedHosts.push(parsed.hostname);
            if (parsed.hostname.startsWith('geocoding-api.')) {
                return {
                    ok: true,
                    json: async () => ({
                        results: [{ name: 'Nairobi', country: 'Kenya', latitude: -1.28, longitude: 36.82 }]
                    })
                };
            }
            return {
                ok: true,
                json: async () => ({
                    current: {
                        temperature_2m: 18,
                        apparent_temperature: 20,
                        relative_humidity_2m: 96,
                        weather_code: 51,
                        wind_speed_10m: 4
                    }
                })
            };
        }
    });
    assert.deepEqual(requestedHosts, ['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
    assert.equal(result.place.country, 'Kenya');
    assert.equal(result.condition, 'light drizzle');
});

test('RSS parser extracts headline, description, and HTTPS link', () => {
    const items = parseRss(`
      <rss><channel><item>
        <title><![CDATA[Kenya &amp; East Africa]]></title>
        <description>Latest &amp; verified news</description>
        <link>https://news.example.test/story</link>
      </item></channel></rss>
    `);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Kenya & East Africa');
    assert.equal(items[0].description, 'Latest & verified news');
    assert.equal(items[0].link, 'https://news.example.test/story');
});

test('status formatting reports brand, online state, and uptime', () => {
    assert.equal(formatDuration(90061), '1d 1h 1m 1s');
    const text = buildStatusText(
        { user: { id: 'private-account-id' } },
        { uptimeSeconds: 3, memoryUsage: { rss: 1024 * 1024 } }
    );
    assert.match(text, /𝕃𝕆ℝ𝔻 𝔽𝔸ℝℍ𝔸ℕ 𝕄𝔻/);
    assert.match(text, /🟢 Online/);
    assert.match(text, /1\.0 MiB/);
});

test('restart command scopes PM2 restart to LordFarhanBot', async () => {
    const commands = [];
    const sent = [];
    await restartCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { fromMe: true, remoteJid: 'chat' } },
        { runCommand: async (command) => commands.push(command) }
    );
    assert.deepEqual(commands, ['pm2 restart LordFarhanBot']);
    assert.match(sent[0][1].text, /Restarting DLORD FARHAN MD/);
});

test('news responds safely when the feed is unavailable', async () => {
    const sent = [];
    await newsCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { fetch: async () => ({ ok: false, status: 503 }) }
    );
    assert.match(sent[0][1].text, /could not fetch headlines/);
});


test('help sends the supplied menu banner and a complete scrollable command text message', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const helpCommand = require('../commands/help');
    const settings = require('../settings');
    const sent = [];
    await helpCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'menu-chat',
        { key: { id: 'menu-test' } }
    );

    assert.equal(sent.length, 2, 'expected the supplied menu banner followed by the scrollable text menu');
    const banner = sent[0][1];
    const menu = sent[1][1];

    const bannerImage = fs.readFileSync(path.join(__dirname, '../assets/menu_bot_image.jpg'));
    assert.ok(Buffer.isBuffer(banner.image), 'expected the supplied menu banner');
    assert.deepEqual(banner.image, bannerImage);
    assert.ok(banner.caption.length < 1024, 'banner caption should stay within the WhatsApp limit');
    assert.ok(banner.caption.includes(`*${settings.botName}*`));
    assert.ok(banner.caption.includes(`Owner: *${settings.botOwner}*`));
    assert.match(banner.caption, /Time: \*.+ EAT\*/);
    assert.ok(banner.caption.includes('State: *🟢 ONLINE*'));
    assert.ok(banner.caption.includes('Owner WhatsApp: *+254795463911*'));

    assert.equal(typeof menu.text, 'string');
    assert.ok(!('image' in menu), 'the commands should be sent as scrollable text');
    const commandLines = menu.text.split('\n').filter(line => line.trim().startsWith('🔹 .'));
    const aliasLines = menu.text.match(/\s\/\s\.\S+/g) || [];
    const commandCount = commandLines.length + aliasLines.length;
    assert.ok(banner.caption.includes(`Commands listed: *${commandCount}*`));
    assert.ok(menu.text.length > 1024, 'the full menu should be long enough to scroll in chat');
    assert.ok(commandLines.every(line => line.trim().startsWith('🔹 .')),
        'each listed command should have a 🔹 prefix');
    for (const section of ['*🌐 GENERAL*', '*👮 ADMIN*', '*👑 OWNER*', '*🎨 IMAGE & STICKER*',
        '*✨ TEXT EFFECTS*', '*🖼️ PIES*', '*🎮 GAMES*', '*🤖 AI*', '*🎯 FUN*',
        '*📥 DOWNLOADS*', '*💻 GITHUB*']) {
        assert.ok(menu.text.includes(section), `expected menu section ${section}`);
    }

    for (const command of [
        '.help / .menu', '.vv (reply to view-once photo/video)', '.autostatus emoji <emojis>',
        '.metallic <text>', '.ice <text>', '.snow <text>', '.impressive <text>',
        '.matrix <text>', '.light <text>', '.neon <text>', '.devil <text>', '.purple <text>',
        '.thunder <text>', '.leaves <text>', '.1917 <text>', '.arena <text>', '.hacker <text>',
        '.sand <text>', '.blackpink <text>', '.glitch <text>', '.fire <text>',
        '.gif <search term>', '.gpt <question>', '.gemini <question>', '.imagine <prompt>',
        '.dalle <prompt>', '.flux <prompt>', '.sora <prompt>', '.git', '.github', '.repo'
    ]) {
        assert.ok(menu.text.includes(command), `expected scrollable text menu to include ${command}`);
    }
});
