const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const Module = require('node:module');

const mediaDownloader = require('../lib/media-downloader');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === '@whiskeysockets/baileys') {
        return {
            downloadContentFromMessage: async () => (async function* () {
                yield Buffer.from('view-once-image');
            })(),
            jidNormalizedUser: jid => String(jid || '').replace(/:\d+(@)/, '$1')
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const viewonceCommand = require('../commands/viewonce');
Module._load = originalLoad;

test('media URL validation accepts supported public platform links', () => {
    assert.equal(
        mediaDownloader.validateMediaUrl('https://youtu.be/abcdefghijk', 'youtube'),
        'https://youtu.be/abcdefghijk'
    );
    assert.equal(
        mediaDownloader.validateMediaUrl('https://vm.tiktok.com/ZM123/', 'tiktok'),
        'https://vm.tiktok.com/ZM123/'
    );
    assert.equal(
        mediaDownloader.validateMediaUrl('https://www.instagram.com/reel/abc/', 'instagram'),
        'https://www.instagram.com/reel/abc/'
    );
    assert.equal(
        mediaDownloader.validateMediaUrl('https://fb.watch/abc/', 'facebook'),
        'https://fb.watch/abc/'
    );
});

test('media URL validation rejects lookalike and non-web hosts', () => {
    assert.throws(() => mediaDownloader.validateMediaUrl('https://instagram.com.evil.example/reel/abc', 'instagram'));
    assert.throws(() => mediaDownloader.validateMediaUrl('file:///etc/passwd', 'facebook'));
    assert.throws(() => mediaDownloader.validateMediaUrl('https://user:pass@youtube.com/watch?v=abcdefghijk', 'youtube'));
});

test('yt-dlp arguments avoid playlists by default and cap Instagram carousel items', () => {
    const videoFlags = mediaDownloader.buildYtDlpFlags('/tmp/media-job', { kind: 'video' });
    assert.equal(videoFlags.noPlaylist, true);
    assert.equal(videoFlags.print, 'after_move:filepath');
    assert.equal(videoFlags.maxFilesize, '64M');
    assert.equal(videoFlags.jsRuntimes, 'node');
    assert.match(videoFlags.output, /media-job/);

    const audioFlags = mediaDownloader.buildYtDlpFlags('/tmp/audio-job', { kind: 'audio' });
    assert.equal(audioFlags.extractAudio, true);
    assert.equal(audioFlags.audioFormat, 'mp3');

    const carouselFlags = mediaDownloader.buildYtDlpFlags('/tmp/instagram-job', {
        kind: 'video', playlist: true, maxFiles: 99
    });
    assert.equal(carouselFlags.noPlaylist, undefined);
    assert.equal(carouselFlags.playlistEnd, 10);
});

test('yt-dlp output is read from the child process stdout property', () => {
    assert.equal(mediaDownloader.getYtDlpStdout({ stdout: '/tmp/media/video.mp4\n' }), '/tmp/media/video.mp4\n');
});

test('media download consumes the printed file path and returns its validated buffer', async () => {
    const originalLoad = Module._load;
    let execOptions;
    Module._load = function (request, parent, isMain) {
        if (request === 'youtube-dl-exec') {
            return {
                exec: async (_url, flags, options) => {
                    execOptions = options;
                    const outputPath = flags.output.replace('%(id)s.%(ext)s', 'test-id.mp4');
                    await fs.writeFile(outputPath, Buffer.from('test-video'));
                    return { stdout: `${outputPath}\n` };
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const files = await mediaDownloader.downloadMedia('https://youtu.be/abcdefghijk', {
            platform: 'youtube',
            kind: 'video',
            timeoutMs: 45000
        });
        assert.equal(files.length, 1);
        assert.equal(files[0].buffer.toString(), 'test-video');
        assert.equal(files[0].mimetype, 'video/mp4');
        assert.equal(files[0].fileName, 'test-id.mp4');
        assert.equal(execOptions.timeout, 45000);
    } finally {
        Module._load = originalLoad;
    }
});

test('`.vv` normalizes the bot JID and delivers view-once media to its inbox', async () => {
    assert.equal(
        viewonceCommand.normalizeBotInboxJid('15551234567:42@s.whatsapp.net'),
        '15551234567@s.whatsapp.net'
    );

    const sent = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    const message = {
        key: { id: 'command-message' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    quotedMessage: {
                        viewOnceMessageV2: {
                            message: { imageMessage: { mimetype: 'image/jpeg' } }
                        }
                    }
                }
            }
        }
    };

    await viewonceCommand(sock, 'group@g.us', message);
    const inboxDelivery = sent.find(([recipient, payload]) =>
        recipient === '15551234567@s.whatsapp.net' && Buffer.isBuffer(payload.image)
    );
    assert.ok(inboxDelivery, 'expected recovered media to reach the normalized bot inbox');
    assert.equal(inboxDelivery[1].caption.includes('view-once photo'), true);
    assert.ok(sent.some(([recipient, payload]) => recipient === 'group@g.us' && /Check your bot inbox/.test(payload.text || '')));
});


test('`.vv` explains that it must directly reply to view-once media', async () => {
    const sent = [];
    await viewonceCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'vv-no-quote' }, message: { conversation: '.vv' } }
    );
    assert.match(sent[0][1].text, /Reply directly to a view-once photo or video with \.vv/);
});
