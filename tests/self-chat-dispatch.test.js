const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('self-chat append commands reach menu and ping handlers', () => {
    const smokeScript = `
        const assert = require('node:assert/strict');
        const { handleMessages } = require('./main');
        (async () => {
            const sent = [];
            const sock = {
                sendMessage: async (...args) => {
                    sent.push(args);
                    return { key: { id: 'smoke-' + sent.length } };
                }
            };
            const update = (fromMe, text) => ({
                type: 'append',
                messages: [{
                    key: { remoteJid: '254795463911@s.whatsapp.net', fromMe, id: 'input-' + text },
                    message: { conversation: text }
                }]
            });

            await handleMessages(sock, update(false, '.menu'), () => {});
            assert.equal(sent.length, 0, 'non-self append commands must remain ignored');

            await handleMessages(sock, update(true, '.menu'), () => {});
            assert.equal(sent.length, 2, 'self-chat .menu sends an image and a text command list');
            assert.ok(Buffer.isBuffer(sent[0][1].image));
            assert.ok(sent[1][1].text.split('\\n').every(line => line.startsWith('🔹 .')));

            await handleMessages(sock, update(true, '.ping'), () => {});
            assert.equal(sent.length, 4, 'self-chat .ping sends its responses');
            process.stdout.write('SELF_CHAT_DISPATCH_OK\\n');
            process.exit(0);
        })().catch(error => {
            console.error(error);
            process.exit(1);
        });
    `;

    const output = execFileSync(process.execPath, ['-e', smokeScript], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 30000
    });
    assert.match(output, /SELF_CHAT_DISPATCH_OK/);
});
