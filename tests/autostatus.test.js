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
    readAutoStatusConfig,
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

test('`.autostatus` saved view, reaction, and emoji changes apply to the next live status immediately', async () => {
    const { directory, filePath } = makeTempConfig();
    const sent = [];
    const readCalls = [];
    const sock = {
        sendMessage: async (...args) => sent.push(args),
        readMessages: async keys => readCalls.push(keys)
    };
    const ownerJid = `${settings.ownerNumber}@s.whatsapp.net`;
    const message = { key: { fromMe: true, remoteJid: ownerJid } };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'realtime-status-id',
        participant: 'contact@s.whatsapp.net',
        fromMe: false
    };
    const liveUpdate = () => handleStatusUpdate(
        sock,
        { messages: [{ key: statusKey }] },
        undefined,
        { configPath: filePath }
    );

    try {
        await autoStatusCommand(sock, 'chat', message, ['on'], filePath);
        assert.equal(readAutoStatusConfig(filePath).enabled, true);
        const start = Date.now();
        liveUpdate();
        await waitForStatusQueue(sock);
        assert.ok(Date.now() - start < 500, 'status viewing should not wait on an artificial pacing delay');
        assert.equal(readCalls.length, 1, 'enabling auto-view should affect the very next status event');

        await autoStatusCommand(sock, 'chat', message, ['react', 'on'], filePath);
        await autoStatusCommand(sock, 'chat', message, ['emoji', '❤️', '🔥'], filePath);
        const reacted = [];
        sock.sendMessage = async (...args) => reacted.push(args);
        statusKey.id = 'realtime-reaction-id';
        liveUpdate();
        await waitForStatusQueue(sock);
        const reactionPayloads = () => reacted.filter(([, payload]) => payload?.react);
        assert.equal(reactionPayloads().length, 1, 'enabling status reactions should affect the very next status event');
        assert.ok(['❤️', '🔥'].includes(reactionPayloads()[0][1].react.text));
        assert.equal(readCalls.length, 2);

        await autoStatusCommand(sock, 'chat', message, ['off'], filePath);
        await autoStatusCommand(sock, 'chat', message, ['react', 'off'], filePath);
        statusKey.id = 'realtime-disabled-id';
        liveUpdate();
        await waitForStatusQueue(sock);
        assert.equal(reactionPayloads().length, 1, 'disabling both actions should stop work on the next status event');
        assert.equal(readCalls.length, 2);
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

test('auto-view maps participantPn to participant for Baileys read receipts', async () => {
    const readCalls = [];
    const sock = { readMessages: async keys => readCalls.push(keys) };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'pn-only-status-id',
        participantPn: 'contact@s.whatsapp.net',
        fromMe: false
    };

    handleStatusUpdate(sock, { messages: [{ key: statusKey }] }, {
        enabled: true,
        reactOn: false,
        reactEmojis: ['💚']
    });
    await waitForStatusQueue(sock);

    assert.deepEqual(readCalls, [[{ ...statusKey, participant: 'contact@s.whatsapp.net' }]]);
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
