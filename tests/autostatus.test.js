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
    selectReactionEmoji
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

test('status reactions use a configured emoji even when automatic status viewing is off', async () => {
    const readCalls = [];
    const relayed = [];
    const sock = {
        readMessages: async keys => readCalls.push(keys),
        relayMessage: async (...args) => relayed.push(args)
    };
    const statusKey = {
        remoteJid: 'status@broadcast',
        id: 'status-message-id',
        participant: 'contact@s.whatsapp.net'
    };

    assert.equal(selectReactionEmoji({ reactEmojis: ['🔥', '✨'] }, () => 0.75), '✨');
    await handleStatusUpdate(
        sock,
        { key: statusKey },
        { enabled: false, reactOn: true, reactEmojis: ['✨'] }
    );

    assert.deepEqual(readCalls, [], 'auto-view off should not mark statuses read');
    assert.equal(relayed.length, 1);
    assert.equal(relayed[0][1].reactionMessage.text, '✨');
});
