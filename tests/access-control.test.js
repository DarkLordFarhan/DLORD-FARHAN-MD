const assert = require('node:assert/strict');
const test = require('node:test');

const isAdmin = require('../lib/isAdmin');
const isLinkedOwner = require('../lib/isLinkedOwner');
const isOwnerOrSudo = require('../lib/isOwner');
const normalizeJid = require('../lib/normalize-jid');
const shouldProcessUpsertMessage = require('../lib/should-process-upsert-message');
const shouldSkipBaileysEcho = shouldProcessUpsertMessage.shouldSkipBaileysEcho;
const resetlinkCommand = require('../commands/resetlink');
const tagAllCommand = require('../commands/tagall');

test('JID normalizer removes device suffixes but preserves phone and LID servers', () => {
    assert.equal(normalizeJid('254795463911:18@s.whatsapp.net'), '254795463911@s.whatsapp.net');
    assert.equal(normalizeJid('123456:4@lid'), '123456@lid');
});

test('private-mode owner matching allows only the linked WhatsApp identity', () => {
    const sock = {
        user: {
            id: '254795463911:4@s.whatsapp.net',
            lid: '1133557799:2@lid'
        }
    };
    assert.equal(isLinkedOwner(sock, { key: { fromMe: false } }, '254795463911:15@s.whatsapp.net'), true);
    assert.equal(isLinkedOwner(sock, { key: { fromMe: false } }, '1133557799:9@lid'), true);
    assert.equal(isLinkedOwner(sock, { key: { fromMe: false } }, '254700000000:1@s.whatsapp.net'), false);
    assert.equal(isLinkedOwner(sock, { key: { fromMe: true } }, 'some-other-id'), true);
});

test('owner helper recognizes the linked account even if settings.ownerNumber is outdated', async () => {
    const sock = { user: { id: '254795463911:4@s.whatsapp.net', lid: '1133557799@lid' } };
    assert.equal(await isOwnerOrSudo('254795463911:15@s.whatsapp.net', sock, 'private-chat'), true);
});

test('group admin detection matches device-suffixed sender and bot JIDs independently', async () => {
    const sock = {
        user: { id: '254711111111:4@s.whatsapp.net', lid: '900000000001@lid' },
        groupMetadata: async () => ({
            participants: [
                { id: '254795463911:18@s.whatsapp.net', phoneNumber: '254795463911@s.whatsapp.net', lid: '1133557799@lid', admin: 'admin' },
                { id: '254711111111:22@s.whatsapp.net', phoneNumber: '254711111111@s.whatsapp.net', lid: '900000000001:7@lid', admin: null }
            ]
        })
    };
    const result = await isAdmin(sock, 'group@g.us', '254795463911:3@s.whatsapp.net');
    assert.deepEqual(result, { isSenderAdmin: true, isBotAdmin: false });
});

test('group admin detection matches the linked LID for both bot and sender', async () => {
    const sock = {
        user: { id: '254711111111:4@s.whatsapp.net', lid: '900000000001:2@lid' },
        groupMetadata: async () => ({
            participants: [
                { id: '254795463911:18@s.whatsapp.net', lid: '1133557799:8@lid', admin: 'superadmin' },
                { id: '254711111111:22@s.whatsapp.net', lid: '900000000001@lid', admin: 'admin' }
            ]
        })
    };
    const result = await isAdmin(sock, 'group@g.us', '1133557799:2@lid');
    assert.deepEqual(result, { isSenderAdmin: true, isBotAdmin: true });
});

test('append batches process only recent self-sent commands, including a command late in the batch', () => {
    const now = 1_800_000_000_000;
    const oldSelfCommand = {
        key: { fromMe: true },
        messageTimestamp: Math.floor((now - 10 * 60_000) / 1000),
        message: { conversation: '.menu' }
    };
    const foreignCommand = {
        key: { fromMe: false },
        messageTimestamp: Math.floor((now - 10_000) / 1000),
        message: { conversation: '.menu' }
    };
    const currentChat = {
        key: { fromMe: true },
        messageTimestamp: Math.floor((now - 10_000) / 1000),
        message: { conversation: 'hello' }
    };
    const currentSelfCommand = {
        key: { fromMe: true },
        messageTimestamp: Math.floor((now - 10_000) / 1000),
        message: { ephemeralMessage: { message: { conversation: '.menu' } } }
    };
    const batch = Array.from({ length: 79 }, () => oldSelfCommand).concat(currentSelfCommand);
    const eligible = batch.filter(message => shouldProcessUpsertMessage(message, 'append', now));

    assert.equal(shouldProcessUpsertMessage(oldSelfCommand, 'append', now), false);
    assert.equal(shouldProcessUpsertMessage(foreignCommand, 'append', now), false);
    assert.equal(shouldProcessUpsertMessage(currentChat, 'append', now), false);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0], currentSelfCommand);
    assert.equal(shouldProcessUpsertMessage(foreignCommand, 'notify', now), true);
});

test('append commands from the linked phone or LID are recognized without `fromMe: true`', () => {
    const now = 1_800_000_000_000;
    const sock = {
        user: {
            id: '254795463911:4@s.whatsapp.net',
            lid: '1133557799:2@lid'
        }
    };
    const selfChatCommand = {
        key: { fromMe: false, remoteJid: '254795463911:9@s.whatsapp.net' },
        messageTimestamp: Math.floor((now - 10_000) / 1000),
        message: { conversation: '.menu' }
    };
    const linkedGroupCommand = {
        key: { participant: '1133557799:7@lid', remoteJid: 'group@g.us' },
        messageTimestamp: Math.floor((now - 10_000) / 1000),
        message: { conversation: '.vv' }
    };

    assert.equal(shouldProcessUpsertMessage(selfChatCommand, 'append', now, sock), true);
    assert.equal(shouldProcessUpsertMessage(linkedGroupCommand, 'append', now, sock), true);
    assert.equal(shouldProcessUpsertMessage(selfChatCommand, 'append', now), false);
});

test('BAE5 echo suppression preserves dot-commands from the linked account', () => {
    const sock = { user: { id: '254795463911:4@s.whatsapp.net' } };
    const linkedCommand = {
        key: { id: 'BAE5abcdefghijkl', fromMe: true, remoteJid: '254795463911@s.whatsapp.net' },
        message: { conversation: '.menu' }
    };
    const linkedBotReply = {
        key: { id: 'BAE5abcdefghijkl', fromMe: true, remoteJid: '254795463911@s.whatsapp.net' },
        message: { conversation: 'Bot connected successfully.' }
    };
    const otherCommand = {
        key: { id: 'BAE5abcdefghijkl', fromMe: false, remoteJid: '254700000000@s.whatsapp.net' },
        message: { conversation: '.menu' }
    };

    assert.equal(shouldSkipBaileysEcho(linkedCommand, sock), false);
    assert.equal(shouldSkipBaileysEcho(linkedBotReply, sock), true);
    assert.equal(shouldSkipBaileysEcho(otherCommand, sock), true);
    assert.equal(shouldSkipBaileysEcho({ key: { id: 'OTHER123' } }, sock), false);
});

test('admin can use tagall even when the bot account is not a group admin', async () => {
    const sent = [];
    const sock = {
        user: { id: '254711111111:4@s.whatsapp.net' },
        groupMetadata: async () => ({
            participants: [
                { id: '254795463911:18@s.whatsapp.net', admin: 'admin' },
                { id: '254711111111:22@s.whatsapp.net', admin: null }
            ]
        }),
        sendMessage: async (...args) => sent.push(args)
    };

    await tagAllCommand(sock, 'group@g.us', '254795463911:3@s.whatsapp.net', { key: { id: 'tagall-test' } });
    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /Hello Everyone/);
    assert.doesNotMatch(sent[0][1].text, /make the bot an admin/i);
});

test('resetlink recognizes an admin with a device-suffixed JID', async () => {
    const sent = [];
    const sock = {
        user: { id: '254711111111:4@s.whatsapp.net', lid: '900000000001@lid' },
        groupMetadata: async () => ({
            participants: [
                { id: '254795463911:18@s.whatsapp.net', phoneNumber: '254795463911@s.whatsapp.net', admin: 'admin' },
                { id: '254711111111:22@s.whatsapp.net', admin: 'admin' }
            ]
        }),
        groupRevokeInvite: async () => 'new-invite-code',
        sendMessage: async (...args) => sent.push(args)
    };

    await resetlinkCommand(sock, 'group@g.us', '254795463911:3@s.whatsapp.net');
    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /new-invite-code/);
});
