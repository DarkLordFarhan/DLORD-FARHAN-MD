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


test('help sends one narrow combined menu image with the README banner and bold borders', async () => {
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

    assert.equal(sent.length, 1, 'the banner and commands should be one image message');
    const payload = sent[0][1];

    const menuImagePath = path.join(__dirname, '../assets/command-menu.png');
    const menuHtmlPath = path.join(__dirname, '../assets/command-menu.html');
    const menuImage = fs.readFileSync(menuImagePath);
    const menuHtml = fs.readFileSync(menuHtmlPath, 'utf8');
    assert.ok(Buffer.isBuffer(payload.image), 'expected the combined menu image');
    assert.deepEqual(payload.image, menuImage);
    assert.ok(payload.caption.length < 1024, 'image caption should stay within the WhatsApp limit');
    assert.ok(payload.caption.includes(`*${settings.botName}*`));
    assert.ok(payload.caption.includes(`Owner: *${settings.botOwner}*`));
    assert.match(payload.caption, /Time: \*.+ EAT\*/);
    assert.ok(payload.caption.includes('State: *🟢 ONLINE*'));
    assert.ok(payload.caption.includes('Owner WhatsApp: *+254795463911*'));

    const itemCount = (menuHtml.match(/<li(?=\s|>)/g) || []).length;
    const noteCount = (menuHtml.match(/<li class="note">/g) || []).length;
    const aliasCount = (menuHtml.match(/\.\w+\s\/\s\.\w+/g) || []).length;
    const commandCount = itemCount - noteCount + aliasCount;
    assert.ok(payload.caption.includes(`Commands listed: *${commandCount}*`));
    assert.match(menuHtml, /html, body\s*\{[^}]*width:\s*540px/);
    assert.match(menuHtml, /main\s*\{[^}]*width:\s*540px/);
    assert.match(menuHtml, /section\s*\{[^}]*border:\s*3px solid/);
    assert.match(menuHtml, /border-left:\s*7px solid/);
    assert.match(menuHtml, /<img src="bot_image\.jpg"/);
    assert.match(menuHtml, /li:not\(\.note\)::before\s*\{[^}]*content:\s*'🔹'/);
    assert.match(menuHtml, /ul\s*\{[^}]*display:\s*block/);
    assert.equal(aliasCount, 4, 'menu command total should count the documented aliases');
    const width = menuImage.readUInt32BE(16);
    const height = menuImage.readUInt32BE(20);
    assert.ok(width <= 1100 && height > width, 'menu poster should be narrow and tall');

    for (const command of [
        '.help / .menu', '.vv (reply to view-once photo/video)', '.autostatus emoji &lt;emojis&gt;',
        '.metallic &lt;text&gt;', '.ice &lt;text&gt;', '.snow &lt;text&gt;', '.impressive &lt;text&gt;',
        '.matrix &lt;text&gt;', '.light &lt;text&gt;', '.neon &lt;text&gt;', '.devil &lt;text&gt;',
        '.purple &lt;text&gt;', '.thunder &lt;text&gt;', '.leaves &lt;text&gt;', '.1917 &lt;text&gt;',
        '.arena &lt;text&gt;', '.hacker &lt;text&gt;', '.sand &lt;text&gt;', '.blackpink &lt;text&gt;',
        '.glitch &lt;text&gt;', '.fire &lt;text&gt;', '.gif &lt;search term&gt;', '.gpt &lt;question&gt;',
        '.gemini &lt;question&gt;', '.imagine &lt;prompt&gt;', '.dalle &lt;prompt&gt;', '.flux &lt;prompt&gt;',
        '.sora &lt;prompt&gt;', '.git</li>', '.github</li>', '.repo</li>'
    ]) {
        assert.ok(menuHtml.includes(command), `expected menu image source to include ${command}`);
    }
});
