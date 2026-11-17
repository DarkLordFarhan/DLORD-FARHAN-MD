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


test('help sends one scrollable and copyable bordered text menu with owner details', async () => {
    const helpCommand = require('../commands/help');
    const sent = [];
    await helpCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'menu-chat',
        { key: { id: 'menu-test' } }
    );

    assert.equal(sent.length, 1, 'the complete menu should be one text message');
    const payload = sent[0][1];
    assert.equal(typeof payload.text, 'string', 'expected a normal copyable text message');
    assert.equal(payload.image, undefined, 'the menu should not attach an image');
    const menuText = payload.text;
    assert.ok(menuText.includes('Owner:'));
    assert.ok(menuText.includes('Owner: *☠︎ᴰᴸᴼᴿᴰ_ᶠᴬᴿᴴᴬᴺ〆*'));
    assert.ok(menuText.includes('Time:'));
    assert.ok(menuText.includes('State: *🟢 ONLINE*'));
    assert.ok(menuText.includes('Commands: *137*'));
    assert.ok(menuText.includes('Owner WhatsApp: *+254795463911*'));
    assert.ok(menuText.includes('╔════════◇◆◇═══════╗'));
    assert.ok(menuText.includes('╠───────────────╣'));
    assert.ok(menuText.includes('╚═══════════════╝'));
    assert.ok(menuText.includes('.vv is owner-only and handles only view-once media sent by the linked account'));

    const commandLines = menuText.split('\n').filter(line => line.includes('║ 🔹 *'));
    assert.equal(commandLines.length, 137, 'every command and alias should appear in the menu');
    assert.ok(commandLines.every(line => line.startsWith('║ 🔹 *')), 'each command should use the requested 🔹 prefix');
    for (const command of [
        '.font', '.metallic', '.ice', '.snow', '.impressive', '.matrix', '.light', '.neon',
        '.devil', '.purple', '.thunder', '.leaves', '.1917', '.arena', '.hacker',
        '.sand', '.blackpink', '.glitch', '.fire', '.gif', '.gpt', '.gemini',
        '.imagine', '.dalle', '.flux', '.sora', '.vv', '.autostatus', '.git', '.github'
    ]) {
        assert.ok(commandLines.some(line => line.includes(`*${command}*`)), `expected menu to include ${command}`);
    }
    assert.ok(menuText.includes('AI Horde'), 'expected the AI fallback disclosure');
    assert.ok(menuText.includes('LAION'), 'expected the anonymous image-sharing disclosure');
});

test('help retries the menu as plain text without forwarding metadata if the first send fails', async () => {
    const helpCommand = require('../commands/help');
    const sent = [];
    let rejectFirstSend = true;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await helpCommand(
            {
                sendMessage: async (...args) => {
                    sent.push(args);
                    if (rejectFirstSend) {
                        rejectFirstSend = false;
                        throw new Error('simulated send failure');
                    }
                }
            },
            'menu-chat',
            { key: { id: 'menu-fallback-test' } }
        );
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(sent.length, 2, 'expected a retry after the initial send failure');
    assert.equal(typeof sent[0][1].text, 'string');
    assert.equal(typeof sent[1][1].text, 'string');
    assert.equal(sent[0][1].text, sent[1][1].text);
    assert.equal(sent[1][1].image, undefined);
    assert.equal(sent[1][1].contextInfo, undefined);
    assert.ok(sent[1][1].text.includes('║ 🔹 *.metallic*'));
});
