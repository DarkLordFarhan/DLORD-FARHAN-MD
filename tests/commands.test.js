const assert = require('node:assert/strict');
const test = require('node:test');

const newsCommand = require('../commands/news');
const { parseRss } = newsCommand;
const { buildStatusText, formatDuration } = require('../commands/status');
const restartCommand = require('../commands/update').restartCommand;
const { lookupWeather } = require('../commands/weather');
const { paranoiaCommand } = require('../commands/paranoia');
const { wouldYouRatherCommand, formatWouldYouRather } = require('../commands/wyr');
const { quotedInfoCommand, getQuotedMessageInfo } = require('../commands/quotedinfo');

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

test('paranoia command fetches a bounded question and replies to the request', async () => {
    const sent = [];
    const request = [];
    const message = { key: { id: 'paranoia-test' } };
    await paranoiaCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        message,
        { get: async (...args) => { request.push(args); return { data: { question: 'A sample question?' } }; } }
    );
    assert.equal(request[0][0], 'https://api.truthordarebot.xyz/v1/paranoia');
    assert.equal(request[0][1].timeout, 8000);
    assert.match(sent[0][1].text, /A sample question\?/);
    assert.equal(sent[0][2].quoted, message);
});

test('would-you-rather command formats options and safely handles a question without an OR separator', async () => {
    assert.match(formatWouldYouRather('Fly or be invisible'), /🅰️ Fly[\s\S]*🅱️ be invisible/);
    assert.match(formatWouldYouRather('Would you rather only speak in haiku or only speak in song lyrics?'), /🅰️ only speak in haiku[\s\S]*🅱️ only speak in song lyrics\?/);
    assert.match(formatWouldYouRather('Pick a superpower'), /Pick a superpower/);

    const sent = [];
    await wouldYouRatherCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'wyr-test' } },
        { get: async () => ({ data: { question: 'Fly or be invisible' } }) }
    );
    assert.match(sent[0][1].text, /Would You Rather/);
    assert.match(sent[0][1].text, /be invisible/);
});

test('quoted info only summarizes the explicitly quoted message and requires a quote', async () => {
    const message = {
        key: { id: 'request' },
        message: { extendedTextMessage: { contextInfo: {
            participant: 'member@s.whatsapp.net',
            stanzaId: 'quoted-id',
            quotedMessage: { imageMessage: { caption: 'hello', mimetype: 'image/jpeg', isForwarded: true } }
        } } }
    };
    const info = getQuotedMessageInfo(message);
    assert.equal(info.type, 'imageMessage');
    assert.equal(info.sender, 'member@s.whatsapp.net');
    assert.equal(info.caption, 'hello');
    assert.equal(info.hasMedia, true);
    assert.equal(info.isForwarded, true);

    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    await quotedInfoCommand(sock, 'chat', message);
    assert.match(sent[0][1].text, /Quoted message info/);
    assert.equal(sent[0][2].quoted, message);

    await quotedInfoCommand(sock, 'chat', { key: { id: 'no-quote' }, message: { conversation: '.q' } });
    assert.match(sent[1][1].text, /Reply to the message/);
});


test('help sends the complete branded menu as bordered scrollable text', async () => {
    const helpCommand = require('../commands/help');
    const sent = [];
    await helpCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'menu-chat',
        { key: { id: 'menu-test' } }
    );

    assert.equal(sent.length, 1, 'the complete text menu should be one message');
    const payload = sent[0][1];
    assert.equal(typeof payload.text, 'string', 'the menu should be sent as a text message');
    assert.equal(payload.image, undefined, 'the menu should no longer include an image');
    assert.equal(payload.caption, undefined, 'the menu should no longer use a media caption');
    const menuText = payload.text;
    assert.ok(menuText.startsWith('╔════════◇◆◇═══════╗'));
    assert.ok(menuText.includes('╔═══════════════╗'));
    assert.ok(menuText.includes('║ 🔹 *.metallic*'));
    assert.ok(menuText.includes('║ 🔹 *.github*'));
    assert.ok(menuText.includes('owner-only'), 'the full text menu should retain the .vv notice');
    assert.ok(menuText.includes('AI Horde'), 'the full text menu should retain AI-service notes');

    const listedCommands = [...menuText.matchAll(/║ 🔹 \*\.([^*]+)\*/g)].map(match => match[1]);
    const count = menuText.match(/Commands: \*(\d+)\*/);
    assert.ok(count, 'the bordered header should show a command count');
    assert.equal(Number(count[1]), listedCommands.length, 'the displayed count should match all rendered commands');
    for (const command of [
        'font', 'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light', 'neon',
        'devil', 'purple', 'thunder', 'leaves', '1917', 'arena', 'hacker',
        'sand', 'blackpink', 'glitch', 'fire', 'gif', 'gpt', 'gemini',
        'imagine', 'dalle', 'flux', 'sora', 'vv', 'autostatus', 'git', 'github',
        'q', 'paranoia', 'wyr', 'qr', 'time', 'define', 'wame', 'getpp',
        'yts', 'groupstats', 'myactivity', 'add', 'resetwarn'
    ]) {
        assert.ok(listedCommands.includes(command), `expected bordered text menu to include ${command}`);
    }
});

test('help retries the bordered text menu without forwarding metadata if sending fails', async () => {
    const helpCommand = require('../commands/help');
    const sent = [];
    let rejectedSends = 0;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await helpCommand(
            {
                sendMessage: async (...args) => {
                    sent.push(args);
                    if (rejectedSends < 1) {
                        rejectedSends++;
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

    assert.equal(sent.length, 2, 'expected one formatted text attempt and one plain-text retry');
    assert.equal(typeof sent[0][1].text, 'string');
    assert.equal(typeof sent[1][1].text, 'string');
    assert.equal(sent[0][1].text, sent[1][1].text);
    assert.ok(sent[0][1].contextInfo, 'expected the first text attempt to preserve forwarding metadata');
    assert.equal(sent[1][1].contextInfo, undefined, 'expected the retry to be plain text');
    assert.ok(sent[1][1].text.includes('║ 🔹 *.metallic*'));
    assert.ok(sent[1][1].text.includes('AI Horde'), 'the plain-text menu should preserve all details');
});
