const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const store = require('../lib/lightweight_store');

test('lightweight store restores Buffer media keys from persisted Baileys messages', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lordfarhan-store-test-'));
    const filePath = path.join(tempDir, 'store.json');
    const previous = {
        messages: store.messages,
        contacts: store.contacts,
        chats: store.chats
    };

    try {
        store.messages = {
            'chat@s.whatsapp.net': [{
                key: { id: 'cached-media', remoteJid: 'chat@s.whatsapp.net' },
                message: { imageMessage: { mediaKey: Buffer.from([0, 1, 2, 255]) } }
            }]
        };
        store.contacts = {};
        store.chats = {};
        store.writeToFile(filePath);
        store.messages = {};

        store.readFromFile(filePath);

        const mediaKey = store.messages['chat@s.whatsapp.net'][0].message.imageMessage.mediaKey;
        assert.ok(Buffer.isBuffer(mediaKey));
        assert.deepEqual([...mediaKey], [0, 1, 2, 255]);
    } finally {
        store.messages = previous.messages;
        store.contacts = previous.contacts;
        store.chats = previous.chats;
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
