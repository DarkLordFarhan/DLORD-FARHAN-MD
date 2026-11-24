const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const Module = require('node:module');
const { Readable } = require('node:stream');

const mediaDownloader = require('../lib/media-downloader');

const originalLoad = Module._load;
let viewonceDownloadAttempts = 0;
let viewonceDownloadType;
let viewonceDownloadFactory;
Module._load = function (request, parent, isMain) {
    if (request === '@whiskeysockets/baileys') {
        return {
            downloadContentFromMessage: async (_media, type) => {
                viewonceDownloadAttempts++;
                viewonceDownloadType = type;
                if (viewonceDownloadFactory) return viewonceDownloadFactory(_media, type);
                return (async function* () {
                    yield Buffer.from(`view-once-${type}`);
                })();
            },
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
    assert.match(videoFlags.format, /acodec!=none.*vcodec!=none/);
    assert.equal(videoFlags.mergeOutputFormat, undefined, 'single-file formats should not need ffmpeg merging');
    assert.match(videoFlags.output, /media-job/);

    const audioFlags = mediaDownloader.buildYtDlpFlags('/tmp/audio-job', { kind: 'audio' });
    assert.match(audioFlags.format, /bestaudio\[ext=m4a\]/);
    assert.equal(audioFlags.extractAudio, undefined, 'audio should not require ffmpeg conversion');
    assert.equal(audioFlags.audioFormat, undefined);

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

test('audio downloads preserve the source extension and use the matching MIME type without ffmpeg', async () => {
    const originalLoad = Module._load;
    let audioFlags;
    Module._load = function (request, parent, isMain) {
        if (request === 'youtube-dl-exec') {
            return {
                exec: async (_url, flags) => {
                    audioFlags = flags;
                    const outputPath = flags.output.replace('%(id)s.%(ext)s', 'test-audio.m4a');
                    await fs.writeFile(outputPath, Buffer.from('test-audio'));
                    return { stdout: `${outputPath}\n` };
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const files = await mediaDownloader.downloadMedia('https://youtu.be/abcdefghijk', {
            platform: 'youtube',
            kind: 'audio'
        });
        assert.equal(audioFlags.extractAudio, undefined);
        assert.equal(files[0].extension, 'm4a');
        assert.equal(files[0].mimetype, 'audio/mp4');
        assert.equal(files[0].fileName, 'test-audio.m4a');
    } finally {
        Module._load = originalLoad;
    }
});

test('downloader errors explain missing tools, login walls, rate limits, and format failures', () => {
    assert.match(mediaDownloader.formatDownloaderError({ stderr: '/usr/bin/env: python3: No such file or directory' }), /missing Python 3/i);
    assert.match(mediaDownloader.formatDownloaderError({ stderr: 'ERROR: ffmpeg not found' }), /missing ffmpeg/i);
    assert.match(mediaDownloader.formatDownloaderError({ stderr: 'Sign in to confirm you’re not a bot' }), /account session/i);
    assert.match(mediaDownloader.formatDownloaderError({ stderr: 'HTTP Error 429: Too Many Requests' }), /rate-limiting/i);
    assert.match(mediaDownloader.formatDownloaderError({ stderr: 'ERROR: Requested format is not available' }), /No compatible audio\/video format/i);
    assert.match(mediaDownloader.formatDownloaderError({ stderr: 'ERROR: unknown extractor failure for https://example.com/secret?token=abc' }), /\[media link\]/);
});

test('`.vv` copies view-once media authored by the linked account to its inbox', async () => {
    assert.equal(
        viewonceCommand.normalizeBotInboxJid('15551234567:42@s.whatsapp.net'),
        '15551234567@s.whatsapp.net'
    );

    viewonceDownloadAttempts = 0;
    const sent = [];
    const recoveredFiles = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => {
            sent.push(args);
            const payload = args[1];
            for (const type of ['image', 'video', 'audio']) {
                if (payload[type]?.url) {
                    recoveredFiles.push({
                        recipient: args[0],
                        type,
                        filePath: payload[type].url,
                        bytes: await fs.readFile(payload[type].url),
                        caption: payload.caption
                    });
                }
            }
        }
    };
    const message = {
        key: { id: 'command-message', fromMe: true, remoteJid: 'group@g.us' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    participant: '15551234567:7@s.whatsapp.net',
                    quotedMessage: {
                        viewOnceMessageV2: {
                            message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Original view-once caption' } }
                        }
                    }
                }
            }
        }
    };

    await viewonceCommand(sock, 'group@g.us', message);
    assert.equal(viewonceDownloadAttempts, 1);
    assert.equal(viewonceDownloadType, 'image');
    const inboxDelivery = recoveredFiles.find(delivery => delivery.recipient === '15551234567@s.whatsapp.net');
    assert.ok(inboxDelivery, 'expected recovered media to reach the normalized bot inbox');
    assert.equal(inboxDelivery.type, 'image');
    assert.equal(inboxDelivery.bytes.toString(), 'view-once-image');
    assert.equal(inboxDelivery.caption, 'Original view-once caption');
    await assert.rejects(fs.access(inboxDelivery.filePath), 'temporary media should be removed after delivery');
    assert.ok(sent.some(([recipient, payload]) => recipient === 'group@g.us' && payload.react?.text === '✅'));
    assert.ok(sent.some(([recipient, payload]) => recipient === 'group@g.us' && /Check your bot inbox/.test(payload.text || '')));
});

test('`.vv` returns a clear error when WhatsApp stalls before starting the media stream', async () => {
    const sent = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    const message = {
        key: { id: 'vv-timeout', fromMe: true, remoteJid: 'group@g.us' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    participant: '15551234567:7@s.whatsapp.net',
                    quotedMessage: {
                        viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } }
                    }
                }
            }
        }
    };
    viewonceDownloadFactory = () => new Promise(() => {});
    try {
        await viewonceCommand(sock, 'group@g.us', message, { streamStartTimeoutMs: 10 });
    } finally {
        viewonceDownloadFactory = undefined;
    }
    assert.ok(sent.some(([, payload]) => /did not start the view-once media download in time/i.test(payload.text || '')));
});

test('`.vv` allows the linked account own self-chat media without a quoted participant JID', async () => {
    viewonceDownloadAttempts = 0;
    const sent = [];
    const selfJid = '15551234567@s.whatsapp.net';
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    const message = {
        key: { id: 'self-chat-command', fromMe: true, remoteJid: selfJid },
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

    await viewonceCommand(sock, selfJid, message);
    assert.equal(viewonceDownloadAttempts, 1);
    assert.ok(sent.some(([recipient, payload]) => recipient === selfJid && Boolean(payload.image?.url)));
});

test('`.vv` privately sends linked-account view-once audio and reacts in the original chat', async () => {
    viewonceDownloadAttempts = 0;
    const sent = [];
    let recoveredAudio;
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => {
            sent.push(args);
            const audio = args[1].audio;
            if (audio?.url) {
                recoveredAudio = {
                    recipient: args[0],
                    ...args[1],
                    bytes: await fs.readFile(audio.url),
                    filePath: audio.url
                };
            }
        }
    };
    const message = {
        key: { id: 'audio-command', fromMe: true, remoteJid: 'group@g.us' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    participant: '15551234567:7@s.whatsapp.net',
                    quotedMessage: {
                        viewOnceMessageV2Extension: {
                            message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }
                        }
                    }
                }
            }
        }
    };

    await viewonceCommand(sock, 'group@g.us', message);
    assert.equal(viewonceDownloadType, 'audio');
    assert.equal(viewonceDownloadAttempts, 1);
    assert.ok(recoveredAudio);
    assert.equal(recoveredAudio.recipient, '15551234567@s.whatsapp.net');
    assert.equal(recoveredAudio.mimetype, 'audio/ogg; codecs=opus');
    assert.equal(recoveredAudio.ptt, false);
    assert.equal(recoveredAudio.bytes.toString(), 'view-once-audio');
    await assert.rejects(fs.access(recoveredAudio.filePath));
    assert.ok(sent.some(([recipient, payload]) => recipient === 'group@g.us' && payload.react?.text === '✅'));
    assert.ok(sent.some(([recipient, payload]) => recipient === 'group@g.us' && /Check your bot inbox/.test(payload.text || '')));
});

test('`.vv` uses Baileys downloadMediaMessage with the quoted key and media reupload callback', async () => {
    let downloadArgs;
    const delivered = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        updateMediaMessage: async quoted => quoted,
        sendMessage: async (...args) => {
            const image = args[1].image;
            if (image?.url) delivered.push({ recipient: args[0], bytes: await fs.readFile(image.url) });
        }
    };
    const message = {
        key: { id: 'vv-command', fromMe: true, remoteJid: 'group@g.us' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    stanzaId: 'quoted-view-once-id',
                    participant: '15551234567:7@s.whatsapp.net',
                    quotedMessage: {
                        viewOnceMessageV2: {
                            message: { imageMessage: { mimetype: 'image/jpeg' } }
                        }
                    }
                }
            }
        }
    };

    await viewonceCommand(sock, 'group@g.us', message, {
        downloadMediaMessage: async (...args) => {
            downloadArgs = args;
            return Readable.from([Buffer.from('reuploaded-view-once-image')]);
        }
    });

    assert.ok(downloadArgs, 'expected Baileys high-level downloader to be used');
    assert.equal(downloadArgs[0].key.remoteJid, 'group@g.us');
    assert.equal(downloadArgs[0].key.id, 'quoted-view-once-id');
    assert.equal(downloadArgs[0].key.participant, '15551234567:7@s.whatsapp.net');
    assert.equal(downloadArgs[0].key.fromMe, true);
    assert.equal(downloadArgs[1], 'stream');
    assert.equal(typeof downloadArgs[3].logger.info, 'function');
    assert.equal(downloadArgs[3].reuploadRequest, sock.updateMediaMessage);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].recipient, '15551234567@s.whatsapp.net');
    assert.equal(delivered[0].bytes.toString(), 'reuploaded-view-once-image');
});

test('`.vv` refuses to copy view-once media authored by another sender', async () => {
    viewonceDownloadAttempts = 0;
    const sent = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    const message = {
        key: { id: 'command-message', fromMe: true, remoteJid: 'group@g.us' },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    participant: '15557654321:4@s.whatsapp.net',
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
    assert.equal(viewonceDownloadAttempts, 0);
    assert.ok(sent.some(([, payload]) => /only copies view-once media sent by the linked account/i.test(payload.text || '')));
});

test('`.vv` rejects commands from a non-linked account', async () => {
    viewonceDownloadAttempts = 0;
    const sent = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    const message = {
        key: { id: 'command-message', fromMe: false, participant: '15557654321:4@s.whatsapp.net', remoteJid: 'group@g.us' },
        message: { conversation: '.vv' }
    };

    await viewonceCommand(sock, 'group@g.us', message);
    assert.equal(viewonceDownloadAttempts, 0);
    assert.ok(sent.some(([, payload]) => /limited to the linked bot account owner/i.test(payload.text || '')));
});

test('`.vv` explains that it must directly reply to view-once media', async () => {
    const sent = [];
    const sock = {
        user: { id: '15551234567:42@s.whatsapp.net' },
        sendMessage: async (...args) => sent.push(args)
    };
    await viewonceCommand(
        sock,
        '15551234567@s.whatsapp.net',
        { key: { id: 'vv-no-quote', fromMe: true, remoteJid: '15551234567@s.whatsapp.net' }, message: { conversation: '.vv' } }
    );
    assert.match(sent[0][1].text, /Reply directly to a view-once photo, video, or audio message with \.vv/);
});
