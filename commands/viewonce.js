const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { startLimitedOperation, withTimeout } = require('../lib/with-timeout');
const {
    downloadMediaMessage,
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const isLinkedOwner = require('../lib/isLinkedOwner');

const MAX_VIEW_ONCE_MEDIA_BYTES = 100 * 1024 * 1024;
const VIEW_ONCE_DOWNLOAD_TIMEOUT_MS = 60_000;
const VIEW_ONCE_STREAM_START_TIMEOUT_MS = 10_000;
const pendingViewOnceDownloads = new WeakMap();
const pendingViewOnceStreamStarts = new WeakMap();

function normalizeBotInboxJid(jid) {
    return jidNormalizedUser(String(jid || ''));
}

function isLinkedJid(sock, jid) {
    const normalized = normalizeBotInboxJid(jid);
    if (!normalized) return false;
    return [sock.user?.id, sock.user?.lid]
        .map(normalizeBotInboxJid)
        .filter(Boolean)
        .includes(normalized);
}

function unwrapViewOnce(message) {
    let content = message;
    let viewOnce = false;
    let depth = 0;
    while (content && depth++ < 15) {
        const viewOnceWrapper =
            content.viewOnceMessage ||
            content.viewOnceMessageV2 ||
            content.viewOnceMessageV2Extension;
        const wrapper =
            viewOnceWrapper ||
            content.ephemeralMessage ||
            content.documentWithCaptionMessage;
        if (!wrapper || !wrapper.message) break;
        if (viewOnceWrapper) viewOnce = true;
        content = wrapper.message;
    }
    return { content, viewOnce };
}

function getQuotedContext(message) {
    const content = message?.message;
    const direct =
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo ||
        content?.audioMessage?.contextInfo;
    if (direct?.quotedMessage) return direct;

    function search(object, depth = 0) {
        if (!object || typeof object !== 'object' || depth > 15) return null;
        if (object.contextInfo?.quotedMessage) return object.contextInfo;
        for (const value of Object.values(object)) {
            if (value && typeof value === 'object') {
                const found = search(value, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    return search(content);
}

function extractMedia(message, depth = 0, requireViewOnce = true) {
    if (!message || typeof message !== 'object' || depth > 15) return null;
    const { content, viewOnce } = unwrapViewOnce(message);
    if (content?.imageMessage && (!requireViewOnce || viewOnce || content.imageMessage.viewOnce)) {
        return { type: 'image', media: content.imageMessage };
    }
    if (content?.videoMessage && (!requireViewOnce || viewOnce || content.videoMessage.viewOnce)) {
        return { type: 'video', media: content.videoMessage };
    }
    if (content?.audioMessage && (!requireViewOnce || viewOnce || content.audioMessage.viewOnce)) {
        return { type: 'audio', media: content.audioMessage };
    }

    for (const value of Object.values(content || {})) {
        if (value && typeof value === 'object') {
            const found = extractMedia(value, depth + 1, requireViewOnce);
            if (found) return found;
        }
    }
    return null;
}

async function downloadMedia(sock, media, type, targetMessage, options = {}) {
    return startLimitedOperation(
        pendingViewOnceDownloads,
        sock,
        1,
        async () => {
            const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'lordfarhan-vv-'));
            const extension = type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'm4a';
            const filePath = path.join(tempDir, `recovered.${extension}`);
            let downloadedBytes = 0;
            const sizeLimit = options.maxMediaBytes ?? MAX_VIEW_ONCE_MEDIA_BYTES;
            const sizeGuard = new Transform({
                transform(chunk, encoding, callback) {
                    downloadedBytes += chunk.length;
                    if (downloadedBytes > sizeLimit) {
                        callback(new Error(`View-once media exceeds the ${Math.floor(sizeLimit / (1024 * 1024))} MB safety limit.`));
                        return;
                    }
                    callback(null, chunk);
                }
            });
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                options.downloadTimeoutMs ?? VIEW_ONCE_DOWNLOAD_TIMEOUT_MS
            );

            try {
                const highLevelDownload = options.downloadMediaMessage || downloadMediaMessage;
                const lowLevelDownload = options.downloadContentFromMessage || downloadContentFromMessage;
                const logger = sock.logger && typeof sock.logger.info === 'function'
                    ? sock.logger
                    : { info() {} };
                const reuploadRequest = typeof sock.updateMediaMessage === 'function'
                    ? sock.updateMediaMessage
                    : undefined;
                const streamTask = startLimitedOperation(
                    pendingViewOnceStreamStarts,
                    sock,
                    1,
                    async () => {
                        if (typeof highLevelDownload === 'function') {
                            try {
                                return await highLevelDownload(
                                    targetMessage,
                                    'stream',
                                    {},
                                    { logger, reuploadRequest }
                                );
                            } catch (error) {
                                if (typeof lowLevelDownload !== 'function') throw error;
                                console.warn('[VV] Baileys message download failed; trying content-stream fallback:', error?.message || error);
                            }
                        }
                        if (typeof lowLevelDownload !== 'function') {
                            throw new Error('This Baileys build has no supported media download helper.');
                        }
                        return lowLevelDownload(media, type);
                    },
                    'A previous view-once stream is still starting.'
                );
                let stream;
                try {
                    stream = await withTimeout(
                        streamTask,
                        options.streamStartTimeoutMs ?? VIEW_ONCE_STREAM_START_TIMEOUT_MS,
                        'WhatsApp did not start the view-once media download in time.'
                    );
                } catch (error) {
                    streamTask.then(lateStream => lateStream?.destroy?.()).catch(() => {});
                    throw error;
                }
                await pipeline(
                    stream,
                    sizeGuard,
                    fs.createWriteStream(filePath, { flags: 'wx' }),
                    { signal: controller.signal }
                );
                if (downloadedBytes === 0) throw new Error('Downloaded media is empty.');
                return { filePath, tempDir, downloadedBytes };
            } catch (error) {
                await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
                if (controller.signal.aborted) {
                    throw new Error('View-once media download timed out after 60 seconds.');
                }
                throw error;
            } finally {
                clearTimeout(timeout);
            }
        },
        'A view-once media download is already in progress.'
    );
}

async function viewOnceCommand(sock, chatId, message, options = {}) {
    let tempDir;
    try {
        const senderId = message.key?.participant ||
            (message.key?.fromMe ? sock.user?.id : message.key?.remoteJid);
        if (!isLinkedOwner(sock, message, senderId)) {
            await sock.sendMessage(chatId, {
                text: 'For privacy, .vv is limited to the linked bot account owner.'
            }, { quoted: message });
            return;
        }

        console.log('[VV] August recovery handler started');
        const context = getQuotedContext(message);
        const quotedMessage = context?.quotedMessage;
        if (!quotedMessage) {
            await sock.sendMessage(chatId, {
            text: '❌ Reply directly to a view-once photo, video, or audio message with .vv'
            }, { quoted: message });
            return;
        }

        let found = extractMedia(quotedMessage);
        if (!found) {
            await sock.sendMessage(chatId, {
                text: '❌ No view-once photo, video, or audio detected. Reply to the original media.'
            }, { quoted: message });
            return;
        }

        // Quoted context often omits the encrypted media URL/directPath. Use the
        // original upsert cached by lightweight_store, which retains the complete
        // Baileys WAMessage and its original key for updateMediaMessage retries.
        let quotedWAMessage = null;
        if (context.stanzaId && typeof sock.loadMessage === 'function') {
            const storedMessage = await Promise.resolve()
                .then(() => sock.loadMessage(chatId, context.stanzaId))
                .catch(() => null);
            if (storedMessage?.key?.id === context.stanzaId && storedMessage.message) {
                const storedMedia = extractMedia(storedMessage.message, 0, false);
                if (storedMedia) {
                    found = storedMedia;
                    quotedWAMessage = storedMessage;
                }
            }
        }

        // Verify ownership using the complete original WhatsApp message.
        // In direct chats, quoted context may not contain a participant ID.
        const quotedAuthor = context.participant;
        const cachedOriginalFromLinkedAccount =
            quotedWAMessage?.key?.fromMe === true;
        const quotedAuthorIsLinked =
            Boolean(quotedAuthor && isLinkedJid(sock, quotedAuthor));

        const quotedFromLinkedAccount =
            cachedOriginalFromLinkedAccount ||
            quotedAuthorIsLinked ||
            (!quotedWAMessage && !quotedAuthor &&
             isLinkedJid(sock, chatId) && message.key?.fromMe === true);

        if (!quotedFromLinkedAccount) {
            await sock.sendMessage(chatId, {
                text: 'For privacy, .vv only copies view-once media sent by the linked account. Ask the sender to resend it as normal media if they want you to keep a copy.'
            }, { quoted: message });
            return;
        }

        const botId = sock.user?.id;
        if (!botId) throw new Error('Bot WhatsApp ID is unavailable');
        const ownerInbox = jidNormalizedUser(botId);
        console.log('[VV] Downloading:', found.type);
        quotedWAMessage ||= {
            key: {
                remoteJid: chatId,
                id: context.stanzaId,
                ...(context.participant ? { participant: context.participant } : {}),
                fromMe: context.participant
                    ? isLinkedJid(sock, context.participant)
                    : isLinkedJid(sock, chatId)
            },
            message: quotedMessage
        };
        let downloaded;
        try {
            downloaded = await downloadMedia(sock, found.media, found.type, quotedWAMessage, options);
        } catch (error) {
            if (!found.media?.url && !found.media?.directPath && /No valid media URL or directPath/i.test(error?.message || '')) {
                throw new Error('Baileys could not find a media source in the quoted message or bot cache. Keep the bot online when the view-once media arrives, then reply to that original message with .vv.');
            }
            throw error;
        }
        tempDir = downloaded.tempDir;
        const originalCaption = found.media.caption;

        if (found.type === 'image') {
            await sock.sendMessage(ownerInbox, {
                image: { url: downloaded.filePath },
                caption: originalCaption || '👑 LORD FARHAN | Recovered view-once photo'
            });
        } else if (found.type === 'video') {
            await sock.sendMessage(ownerInbox, {
                video: { url: downloaded.filePath },
                mimetype: found.media.mimetype || 'video/mp4',
                caption: originalCaption || '👑 LORD FARHAN | Recovered view-once video'
            });
        } else {
            await sock.sendMessage(ownerInbox, {
                audio: { url: downloaded.filePath },
                mimetype: found.media.mimetype || 'audio/mp4',
                ptt: false
            });
        }
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        await sock.sendMessage(chatId, {
            text: '✅ Media processing completed. Check your bot inbox.'
        }, { quoted: message });
        console.log('[VV] SUCCESS: Media delivered to bot inbox');
    } catch (error) {
        console.error('[VV ERROR]', error?.stack || error);
        await sock.sendMessage(chatId, {
            text: '❌ VV failed: ' + String(error.message || error).slice(0, 250)
        }, { quoted: message }).catch(() => {});
    } finally {
        if (tempDir) await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = viewOnceCommand;
module.exports.normalizeBotInboxJid = normalizeBotInboxJid;
