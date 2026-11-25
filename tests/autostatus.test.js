const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const settings = require('../settings');
const {
    autoStatusCommand,
    handleStatusUpdate,
    parseReactionEmojis,
    selectReactionEmoji,
    waitForStatusQueue
} = require('../commands/autostatus');

function makeTempConfig() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dlord-autostatus-'));
    const filePath = path.join(directory, 'autoStatus.json');
    fs.writeFileSync(filePath, JSON.stringify({ enabled: false, reactOn: false }));
    return { directory, filePath };
}

test('status reaction emoji parser accepts emoji sequences and rejects text or oversized lists', () => {
    assert.deepEqual(
        parseReactionEmojis('❤️ 😂, 🇰🇪 👨‍👩‍👧‍👦'),
        ['❤️', '😂', '🇰🇪', '👨‍👩‍👧‍👦']
    );
    assert.throws(() => parseReactionEmojis('not an emoji'), /emoji characters only/i);
    assert.throws(
        () => parseReactionEmojis('😀 😂 🥰 😎 🔥 🎉 💯 ✨ ❤️ 🙌 🐱'),
        /no more than 10/i
    );
});

test('`.autostatus emoji` saves, displays, and resets the selected reaction emojis', async () => {
    const { directory, filePath } = makeTempConfig();
    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    const ownerJid = `${settings.ownerNumber}@s.whatsapp.net`;
    const message = { key: { fromMe: true, remoteJid: ownerJid } };

    try {
        await autoStatusCommand(sock, 'chat', message, ['emoji', '❤️', '🔥', '🇰🇪'], filePath);
        let saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.deepEqual(saved.reactEmojis, ['❤️', '🔥', '🇰🇪']);
        assert.equal(saved.enabled, false);
        assert.match(sent.at(-1)[1].text, /random for each status/i);

        await autoStatusCommand(sock, 'chat', message, ['emoji'], filePath);
        assert.match(sent.at(-1)[1].text, /❤️ 🔥 🇰🇪/);

        await autoStatusCommand(sock, 'chat', message, ['emoji', 'reset'], filePath);
        saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.deepEqual(saved.reactEmojis, ['💚']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('status reactions use Baileys sendMessage, target the status author, and do not require auto-view', async () => {
    const readCalls = [];
    const sent = [];
    const sock = {
        readMessages: async keys => readCalls.push(keys),
        sendMessage: async (...args) => sent.push(args)
    };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'status-message-id',
        participant: 'contact@s.whatsapp.net',
        fromMe: false
    };

    assert.equal(selectReactionEmoji({ reactEmojis: ['🔥', '✨'] }, () => 0.75), '✨');
    const startedAt = Date.now();
    handleStatusUpdate(
        sock,
        { messages: [{ key: statusKey }] },
        { enabled: false, reactOn: true, reactEmojis: ['✨'] }
    );
    handleStatusUpdate(
        sock,
        { messages: [{ key: statusKey }] },
        { enabled: false, reactOn: true, reactEmojis: ['✨'] }
    );
    assert.ok(Date.now() - startedAt < 100, 'status events should be queued without delaying normal message handling');
    await waitForStatusQueue(sock);

    assert.deepEqual(readCalls, [], 'auto-view off should not mark statuses read');
    assert.equal(sent.length, 1, 'duplicate status updates should only be reacted to once');
    assert.equal(sent[0][0], 'status@broadcast');
    assert.deepEqual(sent[0][1].react, {
        text: '✨',
        key: {
            remoteJid: 'status@broadcast',
            id: 'status-message-id',
            participant: 'contact@s.whatsapp.net',
            fromMe: false
        }
    });
    assert.deepEqual(sent[0][2], { statusJidList: ['contact@s.whatsapp.net'] });
});

test('auto-view sends a read receipt for a live status upsert', async () => {
    const readCalls = [];
    const sent = [];
    const sock = {
        readMessages: async keys => readCalls.push(keys),
        sendMessage: async (...args) => sent.push(args)
    };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'view-status-id',
        participant: 'contact@s.whatsapp.net',
        fromMe: false
    };

    handleStatusUpdate(sock, { messages: [{ key: statusKey }] }, {
        enabled: true,
        reactOn: false,
        reactEmojis: ['💚']
    });
    await waitForStatusQueue(sock);

    assert.deepEqual(readCalls, [[statusKey]]);
    assert.deepEqual(sent, []);
});

test('a failed status-view receipt does not prevent the configured reaction', async () => {
    const sent = [];
    const readCalls = [];
    const sock = {
        readMessages: async keys => {
            readCalls.push(keys);
            throw new Error('read receipt unavailable');
        },
        sendMessage: async (...args) => sent.push(args)
    };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'independent-status-id',
        participant: 'contact@s.whatsapp.net',
        fromMe: false
    };

    handleStatusUpdate(sock, { messages: [{ key: statusKey }] }, {
        enabled: true,
        reactOn: true,
        reactEmojis: ['🔥']
    });
    await waitForStatusQueue(sock);

    assert.deepEqual(readCalls, [[statusKey]]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].react.text, '🔥');
});

test('auto-status ignores the linked account own status posts', async () => {
    const sent = [];
    const readCalls = [];
    const sock = {
        readMessages: async keys => readCalls.push(keys),
        sendMessage: async (...args) => sent.push(args)
    };
    handleStatusUpdate(sock, {
        key: {
            remoteJid: 'status@broadcast',
            id: 'own-status-id',
            participant: 'bot@s.whatsapp.net',
            fromMe: true
        }
    }, { enabled: true, reactOn: true, reactEmojis: ['💚'] });
    await waitForStatusQueue(sock);

    assert.deepEqual(readCalls, []);
    assert.deepEqual(sent, []);
});
