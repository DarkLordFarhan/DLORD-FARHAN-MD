const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    autorecordingCommand,
    handleAutoRecordingForMessage,
    isAutoRecordingEnabled
} = require('../commands/autorecording');
const membersCommand = require('../commands/members');
const { groupRulesCommand, readRules } = require('../commands/grouprules');
const groupLinkCommand = require('../commands/grouplink');

function tempJsonPath(fileName) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'group-tools-')), fileName);
}

test('`.autorecording` is owner-only, persists on/off, and reports its state', async () => {
    const configPath = tempJsonPath('autorecording.json');
    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    const message = { key: { remoteJid: 'chat', participant: 'owner@s.whatsapp.net' }, message: { conversation: '.autorecording on' } };

    await autorecordingCommand(sock, 'chat', message, { configPath, isOwnerOrSudo: async () => false });
    assert.match(sent[0][1].text, /only available for the owner/i);
    assert.equal(fs.existsSync(configPath), false);

    await autorecordingCommand(sock, 'chat', message, { configPath, isOwnerOrSudo: async () => true });
    assert.equal(isAutoRecordingEnabled(configPath), true);
    assert.match(sent[1][1].text, /enabled/i);

    message.message.conversation = '.autorecording off';
    await autorecordingCommand(sock, 'chat', message, { configPath, isOwnerOrSudo: async () => true });
    assert.equal(isAutoRecordingEnabled(configPath), false);
    assert.match(sent[2][1].text, /disabled/i);
});

test('autorecording sends a recording presence and always clears it', async () => {
    const configPath = tempJsonPath('autorecording.json');
    fs.writeFileSync(configPath, JSON.stringify({ enabled: true }));
    const events = [];
    const sock = {
        presenceSubscribe: async chat => events.push(`subscribe:${chat}`),
        sendPresenceUpdate: async (state, chat) => events.push(`${state}:${chat}`)
    };
    const shown = await handleAutoRecordingForMessage(sock, 'group@g.us', 'hello', { configPath, delayMs: 0 });
    assert.equal(shown, true);
    assert.deepEqual(events, ['subscribe:group@g.us', 'available:group@g.us', 'recording:group@g.us', 'paused:group@g.us']);
});

test('`.members` lists the group size and member roles and rejects private chats', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (...args) => sent.push(args),
        groupMetadata: async () => ({ subject: 'Test group', participants: [
            { id: '111@s.whatsapp.net', notify: 'Alice', admin: 'admin' },
            { id: '222@s.whatsapp.net', notify: 'Bob' }
        ] })
    };
    await membersCommand(sock, 'group@g.us', { key: { id: 'members' } });
    assert.match(sent[0][1].text, /Test group/);
    assert.match(sent[0][1].text, /Total members: 2/);
    assert.match(sent[0][1].text, /Alice \(admin\)/);
    assert.match(sent[0][1].text, /Bob/);

    await membersCommand(sock, 'private@s.whatsapp.net', {});
    assert.match(sent[1][1].text, /only be used in a group/i);
});

test('`.rules` stores rules per group and only admins can update or clear them', async () => {
    const filePath = tempJsonPath('rules.json');
    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    const adminOptions = { filePath, isAdmin: async () => ({ isSenderAdmin: true }) };
    await groupRulesCommand(sock, 'group-1@g.us', 'admin@s.whatsapp.net', {}, 'Be kind and stay on topic.', adminOptions);
    assert.equal(readRules(filePath)['group-1@g.us'], 'Be kind and stay on topic.');
    assert.match(sent[0][1].text, /saved/i);

    await groupRulesCommand(sock, 'group-1@g.us', 'member@s.whatsapp.net', {}, '', { filePath });
    assert.match(sent[1][1].text, /Be kind and stay on topic/);
    await groupRulesCommand(sock, 'group-2@g.us', 'member@s.whatsapp.net', {}, 'Not allowed', {
        filePath,
        isAdmin: async () => ({ isSenderAdmin: false })
    });
    assert.match(sent[2][1].text, /only a group admin/i);
    assert.equal(readRules(filePath)['group-2@g.us'], undefined);

    await groupRulesCommand(sock, 'group-1@g.us', 'admin@s.whatsapp.net', {}, 'off', adminOptions);
    assert.equal(readRules(filePath)['group-1@g.us'], undefined);
});

test('`.grouplink` requires both sender and bot admin and does not reset the link', async () => {
    const sent = [];
    let inviteCodeCalls = 0;
    const sock = {
        sendMessage: async (...args) => sent.push(args),
        groupInviteCode: async () => { inviteCodeCalls += 1; return 'ABC123xyz'; }
    };
    await groupLinkCommand(sock, 'group@g.us', 'member@s.whatsapp.net', {}, {
        isAdmin: async () => ({ isSenderAdmin: false, isBotAdmin: true })
    });
    assert.match(sent[0][1].text, /only a group admin/i);
    assert.equal(inviteCodeCalls, 0);

    await groupLinkCommand(sock, 'group@g.us', 'admin@s.whatsapp.net', {}, {
        isAdmin: async () => ({ isSenderAdmin: true, isBotAdmin: true })
    });
    assert.match(sent[1][1].text, /https:\/\/chat\.whatsapp\.com\/ABC123xyz/);
    assert.equal(inviteCodeCalls, 1);
});
