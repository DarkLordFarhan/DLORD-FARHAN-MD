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

test('help sends one image with a numbered category selector and replies open every category', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const helpCommand = require('../commands/help');
    const handleMenuCategoryReply = helpCommand.handleMenuCategoryReply;
    const settings = require('../settings');
    const sent = [];
    const sock = {
        sendMessage: async (...args) => {
            sent.push(args);
            return { key: { id: sent.length === 1 ? 'menu-image-1' : `menu-reply-${sent.length}` } };
        }
    };

    await helpCommand(sock, 'menu-chat', { key: { id: 'menu-request' } });
    assert.equal(sent.length, 1, 'the menu should be delivered as one image message');

    const banner = sent[0][1];
    const bannerImage = fs.readFileSync(path.join(__dirname, '../assets/menu_bot_image.jpg'));
    assert.ok(Buffer.isBuffer(banner.image), 'expected the supplied menu banner');
    assert.deepEqual(banner.image, bannerImage);
    assert.ok(banner.caption.length < 1024, 'intro and numbered categories should fit the image caption');
    assert.ok(banner.caption.includes(`*${settings.botName}*`));
    assert.ok(banner.caption.includes(`Owner: *${settings.botOwner}*`));
    assert.match(banner.caption, /Time: \*.+ EAT\*/);
    assert.ok(banner.caption.includes('State: *🟢 ONLINE*'));
    assert.match(banner.caption, /Commands listed: \*\d+\*/);
    assert.ok(banner.caption.includes('Owner WhatsApp: *+254795463911*'));
    assert.ok(banner.caption.includes('Reply to this image with a category number'));

    const categoryNames = [
        '🌐 GENERAL', '👮 ADMIN', '👑 OWNER', '🎨 IMAGE & STICKER', '✨ TEXT EFFECTS',
        '🖼️ PIES', '🎮 GAMES', '🤖 AI', '🎯 FUN', '📥 DOWNLOADS', '💻 GITHUB'
    ];
    categoryNames.forEach((category, index) => {
        assert.ok(banner.caption.includes(`${index + 1}. *${category}*`),
            `expected numbered category ${index + 1}: ${category}`);
    });

    const unquotedNumberHandled = await handleMenuCategoryReply(sock, 'menu-chat', {
        message: { conversation: '1' }
    });
    assert.equal(unquotedNumberHandled, false, 'numbers unrelated to a quoted menu should not be intercepted');
    assert.equal(sent.length, 1);

    const expectedCommands = [
        '.help / .menu', '.vv (reply to view-once photo/video)', '.ban @user',
        '.autostatus emoji <emojis>', '.metallic <text>', '.pies <country>',
        '.tictactoe @user', '.gpt <question>', '.gif <search term>',
        '.play <song_name>', '.repo'
    ];
    const replies = [];
    for (let categoryNumber = 1; categoryNumber <= categoryNames.length; categoryNumber += 1) {
        const handled = await handleMenuCategoryReply(sock, 'menu-chat', {
            key: { remoteJid: 'menu-chat' },
            message: {
                extendedTextMessage: {
                    text: String(categoryNumber),
                    contextInfo: { stanzaId: 'menu-image-1' }
                }
            }
        });
        assert.equal(handled, true, `category ${categoryNumber} reply should be handled`);
        const response = sent.at(-1)[1];
        assert.equal(typeof response.text, 'string');
        assert.ok(response.text.startsWith(`*${categoryNumber}. ${categoryNames[categoryNumber - 1]}*`));
        assert.match(response.text, /🔹 \./, `category ${categoryNumber} should contain commands`);
        replies.push(response.text);
    }

    for (const command of expectedCommands) {
        assert.ok(replies.join('\n').includes(command), `expected a category reply to include ${command}`);
    }

    const invalidSelectionHandled = await handleMenuCategoryReply(sock, 'menu-chat', {
        message: {
            extendedTextMessage: {
                text: '99',
                contextInfo: { stanzaId: 'menu-image-1' }
            }
        }
    });
    assert.equal(invalidSelectionHandled, true);
    assert.match(sent.at(-1)[1].text, /Choose a category number from 1 to 11/);
});
