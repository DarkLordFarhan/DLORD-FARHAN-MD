const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { addCommand } = require('../commands/add');
const { defineCommand } = require('../commands/define');
const { groupStatsCommand } = require('../commands/groupstats');
const { getProfilePictureCommand, getProfilePictureTarget } = require('../commands/getpp');
const { myActivityCommand } = require('../commands/myactivity');
const { qrCommand } = require('../commands/qr');
const { resetWarnCommand } = require('../commands/resetwarn');
const { formatTime, timeCommand } = require('../commands/time');
const { normalizePhoneNumber, wameCommand } = require('../commands/wame');
const { ytsCommand } = require('../commands/yts');
const isAdmin = require('../lib/isAdmin');

test('QR command sends a generated PNG using Baileys image payload shape', async () => {
    const sent = [];
    const message = { key: { id: 'qr-test' } };
    const png = Buffer.from('fake-png');
    let encodedText;
    await qrCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        message,
        'https://example.com',
        { toBuffer: async (text, options) => { encodedText = [text, options]; return png; } }
    );
    assert.equal(encodedText[0], 'https://example.com');
    assert.equal(encodedText[1].type, 'png');
    assert.equal(sent[0][1].image, png);
    assert.equal(sent[0][2].quoted, message);
});

test('time command formats valid IANA zones and responds safely to an invalid zone', async () => {
    const fixed = new Date('2026-11-17T12:34:56.000Z');
    assert.match(formatTime('UTC', fixed), /12:34:56/);
    assert.match(formatTime('UTC', fixed), /GMT/);
    assert.throws(() => formatTime('Not/A_Timezone', fixed), RangeError);

    const sent = [];
    await timeCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat', {}, 'Not/A_Timezone');
    assert.match(sent[0][1].text, /Unknown timezone/);
});

test('wa.me command accepts international phone formatting and rejects malformed input', async () => {
    assert.equal(normalizePhoneNumber('+254 (795) 463-911'), '254795463911');
    assert.equal(normalizePhoneNumber('letters-only'), null);
    assert.equal(normalizePhoneNumber('123'), null);

    const sent = [];
    await wameCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat', {}, '+254 795 463 911');
    assert.match(sent[0][1].text, /https:\/\/wa\.me\/254795463911/);
    await wameCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat', {}, 'invalid');
    assert.match(sent[1][1].text, /Usage: \.wame/);
});

test('definition command formats a live-style Dictionary API response and handles not-found', async () => {
    const sent = [];
    const requested = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    await defineCommand(sock, 'chat', {}, 'resilient', {
        fetch: async (url) => {
            requested.push(url);
            return {
                ok: true,
                status: 200,
                json: async () => [{
                    word: 'resilient',
                    phonetic: '/rɪˈzɪliənt/',
                    meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Able to recover quickly.' }] }]
                }]
            };
        }
    });
    assert.match(requested[0], /api\.dictionaryapi\.dev\/api\/v2\/entries\/en\/resilient/);
    assert.match(sent[0][1].text, /Able to recover quickly/);

    await defineCommand(sock, 'chat', {}, 'missingword', {
        fetch: async () => ({ status: 404, ok: false })
    });
    assert.match(sent[1][1].text, /No English definition found/);
});

test('`.yts` downloads and sends a validated YouTube video instead of returning links', async () => {
    const sent = [];
    await ytsCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'yts-test' } },
        'test query',
        async query => ({ videos: [
            { title: 'Valid result', url: 'https://www.youtube.com/watch?v=60ItHLz5WEA', timestamp: '3:12', views: 1200 },
            { title: 'Invalid result', url: 'https://bad.example/video' },
            { title: 'Insecure result', url: 'http://youtu.be/60ItHLz5WEA' }
        ] }),
        {
            apiDownloader: async url => {
                assert.match(url, /60ItHLz5WEA/);
                return { buffer: Buffer.from('mp4-video'), mimetype: 'video/mp4', extension: 'mp4' };
            }
        }
    );
    assert.match(sent[0][1].text, /Downloading the best available video/);
    assert.equal(sent[1][1].video.toString(), 'mp4-video');
    assert.equal(sent[1][1].mimetype, 'video/mp4');
    assert.match(sent[1][1].fileName, /Valid result\.mp4/);
    assert.doesNotMatch(JSON.stringify(sent[1][1]), /youtube\.com\/watch/);
});

test('`.yts` falls back to the existing downloader when the API fails', async () => {
    const sent = [];
    const fallbackAttempts = [];
    await ytsCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        {},
        'test query',
        async () => ({ videos: [
            { title: 'Fallback video', url: 'https://www.youtube.com/watch?v=60ItHLz5WEA' }
        ] }),
        {
            apiDownloader: async () => { throw new Error('API unavailable'); },
            downloader: async (url, options) => {
                fallbackAttempts.push({ url, options });
                return [{ buffer: Buffer.from('fallback-video'), mimetype: 'video/mp4', extension: 'mp4' }];
            }
        }
    );

    assert.equal(fallbackAttempts.length, 1);
    assert.equal(fallbackAttempts[0].options.kind, 'video');
    assert.equal(sent[1][1].video.toString(), 'fallback-video');
});

test('`.yts` reports when no valid YouTube search results are found', async () => {
    const sent = [];
    await ytsCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        {},
        'test query',
        async () => ({ videos: [
            { title: 'Invalid result', url: 'https://bad.example/video' },
            { title: 'Insecure result', url: 'http://youtu.be/60ItHLz5WEA' }
        ] })
    );
    assert.match(sent[0][1].text, /No YouTube results found/);
});

test('YouTube search returns control after a stalled provider request', async () => {
    const sent = [];
    await ytsCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        {},
        'slow query',
        () => new Promise(() => {}),
        { timeoutMs: 10 }
    );
    assert.match(sent[0][1].text, /timed out/);
});

test('admin verification fails closed after a stalled group-metadata lookup', async () => {
    const status = await isAdmin(
        { groupMetadata: () => new Promise(() => {}) },
        'group@g.us',
        'admin@s.whatsapp.net',
        { timeoutMs: 10 }
    );
    assert.deepEqual(status, { isSenderAdmin: false, isBotAdmin: false });
});

test('admin verification caps outstanding stalled metadata requests per socket', async () => {
    let requests = 0;
    const sock = { groupMetadata: () => { requests += 1; return new Promise(() => {}); } };
    const results = await Promise.all(Array.from({ length: 6 }, () => isAdmin(
        sock,
        'group@g.us',
        'admin@s.whatsapp.net',
        { timeoutMs: 10 }
    )));
    assert.equal(requests, 4);
    assert.ok(results.every(result => !result.isSenderAdmin && !result.isBotAdmin));
});

test('groupstats and myactivity read cumulative message counts without mutating them', async () => {
    const sent = [];
    const data = {
        'group@g.us': {
            'user@s.whatsapp.net': 5,
            'other@s.whatsapp.net': 3
        }
    };
    const loadMessageCounts = () => data;
    const sock = { sendMessage: async (...args) => sent.push(args) };
    await groupStatsCommand(sock, 'group@g.us', {}, { loadMessageCounts });
    assert.match(sent[0][1].text, /Cumulative messages recorded: \*8\*/);
    assert.deepEqual(sent[0][1].mentions, ['user@s.whatsapp.net', 'other@s.whatsapp.net']);

    await myActivityCommand(sock, 'group@g.us', {}, 'user:9@s.whatsapp.net', { loadMessageCounts });
    assert.match(sent[1][1].text, /Messages recorded: \*5\*/);
    assert.match(sent[1][1].text, /Rank: \*1 of 2\*/);
    assert.equal(data['group@g.us']['user@s.whatsapp.net'], 5);
});

test('getpp resolves only a mentioned, quoted, or requesting participant', async () => {
    const target = '254795463911@s.whatsapp.net';
    const message = { key: { id: 'getpp-test' }, message: { extendedTextMessage: { contextInfo: { mentionedJid: [target] } } } };
    assert.equal(getProfilePictureTarget(message, 'requester@s.whatsapp.net'), target);
    const sent = [];
    await getProfilePictureCommand({
        profilePictureUrl: async jid => `https://cdn.example/${jid}.jpg`,
        sendMessage: async (...args) => sent.push(args)
    }, 'chat', message, 'requester@s.whatsapp.net');
    assert.deepEqual(sent[0][1].image, { url: `https://cdn.example/${target}.jpg` });
    assert.equal(sent[0][2].quoted, message);
});

test('getpp returns control after a stalled profile-picture lookup', async () => {
    const sent = [];
    const originalError = console.error;
    console.error = () => {};
    try {
        await getProfilePictureCommand({
            profilePictureUrl: () => new Promise(() => {}),
            sendMessage: async (...args) => sent.push(args)
        }, 'chat', {}, 'requester@s.whatsapp.net', { timeoutMs: 10 });
    } finally {
        console.error = originalError;
    }
    assert.match(sent[0][1].text, /WhatsApp could not load it/);
});

test('getpp returns control after a stalled image send without retrying a possibly late send', async () => {
    let attempts = 0;
    await getProfilePictureCommand({
        profilePictureUrl: async () => 'https://cdn.example/profile.jpg',
        sendMessage: () => { attempts += 1; return new Promise(() => {}); }
    }, 'chat', {}, 'requester@s.whatsapp.net', { timeoutMs: 50, sendTimeoutMs: 10 });
    assert.equal(attempts, 1);
});

test('add command validates group-admin permissions and submits one participant to Baileys', async () => {
    const message = { key: { id: 'add-test' } };
    const sent = [];
    const updates = [];
    const sock = {
        sendMessage: async (...args) => sent.push(args),
        groupParticipantsUpdate: async (...args) => { updates.push(args); return [{ status: '200' }]; }
    };
    await addCommand(sock, 'group@g.us', message, '+254 795 463 911', { isSenderAdmin: true, isBotAdmin: true });
    assert.deepEqual(updates[0], ['group@g.us', ['254795463911@s.whatsapp.net'], 'add']);
    assert.match(sent[0][1].text, /accepted the add request/);

    await addCommand(sock, 'group@g.us', message, '254700000000', { isSenderAdmin: false, isBotAdmin: true });
    assert.equal(updates.length, 1, 'unauthorized use must not call the participant-update API');
    assert.match(sent[1][1].text, /Only a group admin/);
});

test('add handler returns control if WhatsApp does not answer the participant update', async () => {
    const sent = [];
    await addCommand({
        sendMessage: async (...args) => sent.push(args),
        groupParticipantsUpdate: () => new Promise(() => {})
    }, 'group@g.us', {}, '254795463911', { isSenderAdmin: true, isBotAdmin: true }, { timeoutMs: 10 });
    assert.match(sent[0][1].text, /timed out/);
    assert.match(sent[0][1].text, /check the group before retrying/);
});

test('add handler caps outstanding participant updates per socket', async () => {
    let updates = 0;
    const sent = [];
    const sock = {
        sendMessage: async (...args) => sent.push(args),
        groupParticipantsUpdate: () => { updates += 1; return new Promise(() => {}); }
    };
    await Promise.all(Array.from({ length: 3 }, (_, index) => addCommand(
        sock,
        'group@g.us',
        {},
        `25479546391${index}`,
        { isSenderAdmin: true, isBotAdmin: true },
        { timeoutMs: 10 }
    )));
    assert.equal(updates, 2);
    assert.ok(sent.some(([, payload]) => /Earlier add requests are still pending/.test(payload.text)));
});

test('resetwarn clears only the selected group participant warning record', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'farhan-resetwarn-'));
    const filePath = path.join(directory, 'warnings.json');
    const target = 'member@s.whatsapp.net';
    const chatId = 'group@g.us';
    fs.writeFileSync(filePath, JSON.stringify({ [chatId]: { [target]: 2, 'other@s.whatsapp.net': 1 } }));
    const sent = [];
    const message = {
        key: { id: 'resetwarn-test' },
        message: { extendedTextMessage: { contextInfo: { mentionedJid: [target] } } }
    };
    try {
        await resetWarnCommand(
            { sendMessage: async (...args) => sent.push(args) },
            chatId,
            message,
            { isSenderAdmin: true, isBotAdmin: false },
            { filePath }
        );
        const updated = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(updated[chatId][target], undefined);
        assert.equal(updated[chatId]['other@s.whatsapp.net'], 1);
        assert.match(sent[0][1].text, /Previous warnings: 2/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('resetwarn refuses an oversized warning file before parsing it', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'farhan-resetwarn-large-'));
    const filePath = path.join(directory, 'warnings.json');
    fs.writeFileSync(filePath, Buffer.alloc(2 * 1024 * 1024 + 1, 32));
    const sent = [];
    const originalError = console.error;
    console.error = () => {};
    try {
        await resetWarnCommand(
            { sendMessage: async (...args) => sent.push(args) },
            'group@g.us',
            { message: { extendedTextMessage: { contextInfo: { mentionedJid: ['member@s.whatsapp.net'] } } } },
            { isSenderAdmin: true },
            { filePath }
        );
    } finally {
        console.error = originalError;
        fs.rmSync(directory, { recursive: true, force: true });
    }
    assert.match(sent[0][1].text, /Could not update the warning record/);
});
