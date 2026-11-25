const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const sharp = require('sharp');

const originalLoad = Module._load;
let downloadedMessage;
let downloadOptions;
let stickerBuffer;
Module._load = function (request, parent, isMain) {
    if (request === '@whiskeysockets/baileys') {
        return {
            downloadMediaMessage: async (message, type, options, context) => {
                downloadedMessage = { message, type, options };
                downloadOptions = context;
                return stickerBuffer;
            }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const toImageCommand = require('../commands/toimage');
Module._load = originalLoad;

test('`.toimage` converts a quoted sticker to a PNG and passes the original quote key to Baileys', async () => {
    stickerBuffer = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    }).webp().toBuffer();
    downloadedMessage = undefined;
    downloadOptions = undefined;
    const sent = [];
    const updateMediaMessage = async message => message;
    const sock = {
        updateMediaMessage,
        downloadMediaMessage: undefined,
        sendMessage: async (...args) => sent.push(args)
    };
    const original = {
        key: { id: 'toimage-command', remoteJid: 'group@g.us', fromMe: true },
        message: {
            extendedTextMessage: {
                text: '.toimage',
                contextInfo: {
                    stanzaId: 'sticker-message-id',
                    participant: 'owner@s.whatsapp.net',
                    quotedMessage: { stickerMessage: { mimetype: 'image/webp' } }
                }
            }
        }
    };

    await toImageCommand(sock, 'group@g.us', original);

    assert.equal(downloadedMessage.type, 'buffer');
    assert.equal(downloadedMessage.message.key.remoteJid, 'group@g.us');
    assert.equal(downloadedMessage.message.key.id, 'sticker-message-id');
    assert.equal(downloadedMessage.message.key.participant, 'owner@s.whatsapp.net');
    assert.equal(downloadOptions.reuploadRequest, updateMediaMessage);
    const [chatId, payload, sendOptions] = sent[0];
    assert.equal(chatId, 'group@g.us');
    assert.equal(payload.mimetype, 'image/png');
    assert.equal(payload.image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(sendOptions.quoted, original);
});

test('`.toimage` asks for a quoted sticker and does not attempt a download otherwise', async () => {
    const sent = [];
    await toImageCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat@s.whatsapp.net', {
        key: { id: 'no-sticker' },
        message: { conversation: '.toimage' }
    });

    assert.match(sent[0][1].text, /reply to a sticker/i);
    assert.equal(sent[0][2].quoted.key.id, 'no-sticker');
});
