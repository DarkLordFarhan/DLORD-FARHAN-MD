/**
 * LordFarhan Bot - A WhatsApp Bot
 * Copyright (c) 2026 DarkLord
 *
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by DarkLord & Ghost
 */
const path = require('path');
// Load .env from the same folder as index.js — works on all panels
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('./settings');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const FileType = require('file-type');
const axios = require('axios');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');
const pino = require('pino');
const { parsePhoneNumber } = require('libphonenumber-js');
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');

const store = require('./lib/lightweight_store');
store.readFromFile();
const settings = require('./settings');
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

setInterval(() => { if (global.gc) global.gc(); }, 60_000);
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) { console.log('RAM too high — restarting...'); process.exit(1); }
}, 30_000);

// ─── STARTUP ──────────────────────────────────────────────────────────────────
console.log('='.repeat(55));
console.log('  LordFarhan Bot — Starting up...');
console.log('  SESSION_ID set: ' + (!!process.env.SESSION_ID));
console.log('='.repeat(55));
// ─────────────────────────────────────────────────────────────────────────────

// ─── SESSION LOADER ───────────────────────────────────────────────────────────
// Accepts the pairing site's long compressed session or a database-backed short ID.
const SESSION_PREFIX = 'LordBot~';
const DEFAULT_PAIRING_SERVER_URL =
    'https://lordfarhan-xmd-production-6ffc.up.railway.app';
const MAX_SESSION_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_SESSION_JSON_BYTES = 4 * 1024 * 1024;

function sessionImportError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

async function resolveSessionPayload(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length > MAX_SESSION_TEXT_LENGTH) {
        throw sessionImportError('SESSION_ID_INVALID');
    }
    if (!sessionId.startsWith(SESSION_PREFIX)) {
        throw sessionImportError('SESSION_PREFIX_INVALID');
    }

    let fullSession = sessionId.trim();
    let payload = fullSession.slice(SESSION_PREFIX.length).trim();

    // The site emits 12-character IDs only when its database-backed store is enabled.
    if (/^[A-Za-z0-9]{12}$/.test(payload)) {
        let server;
        try {
            server = new URL(
                process.env.PAIRING_SERVER_URL || DEFAULT_PAIRING_SERVER_URL
            );
        } catch {
            throw sessionImportError('PAIRING_SERVER_URL_INVALID');
        }
        if (server.protocol !== 'https:' || server.username || server.password) {
            throw sessionImportError('PAIRING_SERVER_URL_INVALID');
        }

        const endpoint = new URL(`/session/${encodeURIComponent(payload)}`, server);
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'GET',
                headers: { accept: 'text/plain' },
                redirect: 'error',
                signal: AbortSignal.timeout(12000)
            });
        } catch {
            throw sessionImportError('SHORT_SESSION_FETCH_FAILED');
        }
        if (response.status === 404) {
            throw sessionImportError('SHORT_SESSION_NOT_FOUND');
        }
        if (response.status === 503) {
            throw sessionImportError('SHORT_SESSION_STORE_UNAVAILABLE');
        }
        if (!response.ok) {
            throw sessionImportError('SHORT_SESSION_FETCH_FAILED');
        }

        try {
            fullSession = (await response.text()).trim();
        } catch {
            throw sessionImportError('SHORT_SESSION_FETCH_FAILED');
        }
        if (
            !fullSession ||
            fullSession.length > MAX_SESSION_TEXT_LENGTH ||
            !fullSession.startsWith(SESSION_PREFIX)
        ) {
            throw sessionImportError('SHORT_SESSION_RESPONSE_INVALID');
        }
        payload = fullSession.slice(SESSION_PREFIX.length).trim();
        if (/^[A-Za-z0-9]{12}$/.test(payload)) {
            throw sessionImportError('SHORT_SESSION_RESPONSE_INVALID');
        }
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    if (
        !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ||
        normalized.length % 4 === 1
    ) {
        throw sessionImportError('SESSION_BASE64_INVALID');
    }
    const unpadded = normalized.replace(/=+$/, '');
    const packed = Buffer.from(normalized, 'base64');
    if (
        !packed.length ||
        packed.toString('base64').replace(/=+$/, '') !== unpadded
    ) {
        throw sessionImportError('SESSION_BASE64_INVALID');
    }

    const zlib = require('zlib');
    let decodedBytes = packed;
    try {
        if (packed[0] === 0x1f && packed[1] === 0x8b) {
            decodedBytes = zlib.gunzipSync(packed, {
                maxOutputLength: MAX_SESSION_JSON_BYTES
            });
        } else if (
            packed[0] === 0x78 &&
            [0x01, 0x5e, 0x9c, 0xda].includes(packed[1])
        ) {
            decodedBytes = zlib.inflateSync(packed, {
                maxOutputLength: MAX_SESSION_JSON_BYTES
            });
        }
    } catch {
        throw sessionImportError('SESSION_COMPRESSION_INVALID');
    }
    if (decodedBytes.length > MAX_SESSION_JSON_BYTES) {
        throw sessionImportError('SESSION_TOO_LARGE');
    }

    const reviveSessionValue = (key, value) => {
        if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
            return Buffer.from(value.data);
        }
        if (value && value.type === 'Uint8Array' && Array.isArray(value.data)) {
            return new Uint8Array(value.data);
        }
        return value;
    };

    let parsed;
    try {
        parsed = JSON.parse(decodedBytes.toString('utf8'), reviveSessionValue);
        if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed, reviveSessionValue);
        }
    } catch {
        throw sessionImportError('SESSION_JSON_INVALID');
    }

    const bundle = parsed?.state || parsed?.authState || parsed?.session || parsed;
    const creds = bundle?.creds || parsed?.creds ||
        (bundle?.registrationId !== undefined ? bundle : null);
    const keys = bundle?.keys || parsed?.keys || {};
    if (
        !creds ||
        typeof creds !== 'object' ||
        creds.registrationId === undefined ||
        !creds.noiseKey ||
        !creds.signedIdentityKey ||
        !creds.signedPreKey
    ) {
        throw sessionImportError('SESSION_CREDS_INVALID');
    }
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
        throw sessionImportError('SESSION_KEYS_INVALID');
    }

    return { creds, keys };
}

async function loadSessionFromEnv() {
    const sessionId = String(process.env.SESSION_ID || '').trim();

    if (!sessionId) {
        console.log('No SESSION_ID found; using normal pairing fallback.');
        return false;
    }
    if (sessionId.length > MAX_SESSION_TEXT_LENGTH) {
        console.log('SESSION_ID is too large; using normal pairing fallback.');
        return false;
    }

    try {
        const crypto = require('crypto');
        const sessionDir = './session';
        const credsPath = sessionDir + '/creds.json';
        const pendingPath = sessionDir + '/.lordbot-pending-keys.json';
        const markerPath = sessionDir + '/.lordbot-session-hash';
        const rejectedPath = sessionDir + '/.lordbot-session-rejected';

        const hash = crypto.createHash('sha256')
            .update(sessionId).digest('hex');

        if (
            fs.existsSync(rejectedPath) &&
            fs.readFileSync(rejectedPath, 'utf8').trim() === hash
        ) {
            console.log('This SESSION_ID was logged out; use a new session or QR pairing.');
            return false;
        }

        if (fs.existsSync(markerPath) && fs.existsSync(credsPath)) {
            if (fs.readFileSync(markerPath, 'utf8').trim() === hash) {
                console.log('Existing LordBot session already imported.');
                return true;
            }
        }

        const { creds, keys } = await resolveSessionPayload(sessionId);

        // Preserve the previous authentication directory before replacement.
        if (fs.existsSync(sessionDir)) {
            const backupDir = './session.backup-' + Date.now();
            fs.renameSync(sessionDir, backupDir);
            console.log('Previous authentication state backed up.');
        }

        fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
        fs.writeFileSync(
            pendingPath,
            JSON.stringify({ keys, hash }),
            { mode: 0o600 }
        );

        console.log('LordBot credentials decoded and validated.');
        console.log('Signal key import will run after Baileys initializes.');

        if (!Object.keys(keys).length)
            console.log('WARNING: Session contains no Signal keys.');

        return true;

    } catch (err) {
        const code = typeof err?.code === 'string' ? err.code : 'SESSION_IMPORT_FAILED';
        console.log('LordBot session import failed (' + code + ').');
        return false;
    }
}

let sessionLoaded = false;
// ─────────────────────────────────────────────────────────────────────────────

let owner = ['0108817832'];
try { owner = JSON.parse(fs.readFileSync('./data/owner.json')); } catch (e) { console.log('⚠️  owner.json missing, using default owner'); }

global.botname = settings.botName || 'LORD FARHAN BOT';
global.themeemoji = '•';

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true
    }
};

async function startXeonBotInc() {
    try {
        sessionLoaded = await loadSessionFromEnv();
        let { version, isLatest } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        const pendingKeysPath = './session/.lordbot-pending-keys.json';
        if (fs.existsSync(pendingKeysPath)) {
            const pending = JSON.parse(fs.readFileSync(pendingKeysPath, 'utf8'),
                (key, value) => {
                    if (value && value.type === 'Buffer' && Array.isArray(value.data))
                        return Buffer.from(value.data);
                    if (value && value.type === 'Uint8Array' && Array.isArray(value.data))
                        return new Uint8Array(value.data);
                    return value;
                });

            const importedKeys = pending.keys || {};
            for (const [type, entries] of Object.entries(importedKeys)) {
                if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
                    await state.keys.set(type, entries);
                }
            }

            fs.writeFileSync('./session/.lordbot-session-hash', pending.hash);
            fs.unlinkSync(pendingKeysPath);
            console.log('LordBot session keys imported into Baileys.');
        }

        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            // Only print QR if no session was loaded — on panels this stays false
            printQRInTerminal: !sessionLoaded,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' }).child({ level: 'fatal' })
                ),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid);
                let msg = await store.loadMessage(jid, key.id);
                return msg?.message || '';
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        XeonBotInc.ev.on('creds.update', saveCreds);
        store.bind(XeonBotInc.ev);

        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            console.log('[INCOMING EVENT]', JSON.stringify({
                type: chatUpdate?.type,
                count: chatUpdate?.messages?.length,
                time: new Date().toISOString()
            }));
            try {
                const mek = chatUpdate.messages?.[0];
                if (!mek) {
                    console.log('[INCOMING EVENT] No message object received');
                    return;
                }
                if (!mek.message) return;
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message : mek.message;
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate); return;
                }
                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    if (!mek.key?.remoteJid?.endsWith('@g.us')) return;
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
                if (XeonBotInc?.msgRetryCounterCache) XeonBotInc.msgRetryCounterCache.clear();
                try {
                    await handleMessages(XeonBotInc, chatUpdate, true);
                } catch (err) {
                    console.error('Error in handleMessages:', err);
                    if (mek.key?.remoteJid) {
                        await XeonBotInc.sendMessage(mek.key.remoteJid, {
                            text: 'An error occurred while processing your message.', ...channelInfo
                        }).catch(console.error);
                    }
                }
            } catch (err) { console.error('Error in messages.upsert:', err); }
        });

        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server ? decode.user + '@' + decode.server : jid;
            }
            return jid;
        };

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id);
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        XeonBotInc.getName = (jid, withoutContact = false) => {
            let id = XeonBotInc.decodeJid(jid);
            withoutContact = XeonBotInc.withoutContact || withoutContact;
            let v;
            if (id.endsWith('@g.us')) return new Promise(async (resolve) => {
                v = store.contacts[id] || {};
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
            v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } :
                id === XeonBotInc.decodeJid(XeonBotInc.user.id) ? XeonBotInc.user :
                (store.contacts[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName ||
                PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
        };

        XeonBotInc.public = true;
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s;
            if (qr && !sessionLoaded) console.log(chalk.yellow('QR generated — set SESSION_ID in .env to avoid this'));
            if (connection === 'connecting') console.log(chalk.yellow('Connecting to WhatsApp...'));

            if (connection === 'open') {
                console.log(chalk.green('Connected to WhatsApp.'));
                try {
    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
    const caption = `👑 *${settings.botName || 'LORD FARHAN MD'}* 👑

🔥 *BOT CONNECTED SUCCESSFULLY*

✅ Status: ONLINE
👑 Owner: *${settings.botOwner || 'LORD FARHAN'}*
🕒 Time: Nairobi, Kenya (EAT)
⚡ Powered by DARKTECH CLAN NET`;

    const imagePath = path.join(__dirname, 'assets', 'bot_image.jpg');
    await XeonBotInc.sendMessage(botNumber, {
      image: fs.readFileSync(imagePath),
      caption,
      ...channelInfo
    });
  } catch (e) {
    console.error('Connection notification error:', e.message);
  }

  await delay(1999);
                console.log(chalk.bold.blue('[ LordFarhan Bot ]'));
                console.log(chalk.green('Bot Connected Successfully! Version: ' + settings.version));
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(chalk.red('Connection closed — statusCode: ' + statusCode));
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        const sessionDir = './session';
                        const markerPath = path.join(sessionDir, '.lordbot-session-hash');
                        if (sessionLoaded && fs.existsSync(markerPath)) {
                            const hash = fs.readFileSync(markerPath, 'utf8').trim();
                            fs.writeFileSync(
                                path.join(sessionDir, '.lordbot-session-rejected'),
                                hash,
                                { mode: 0o600 }
                            );
                            for (const entry of fs.readdirSync(sessionDir)) {
                                if (
                                    entry === '.lordbot-session-hash' ||
                                    entry === '.lordbot-session-rejected'
                                ) continue;
                                rmSync(path.join(sessionDir, entry), { recursive: true, force: true });
                            }
                        } else {
                            rmSync(sessionDir, { recursive: true, force: true });
                        }
                    } catch {
                        try { rmSync('./session', { recursive: true, force: true }); } catch {}
                    }
                    console.log(chalk.red('Session expired. Replace SESSION_ID in the hosting environment or use QR pairing.'));
                    process.exit(1);
                }
                if (shouldReconnect) { console.log('Reconnecting in 5s...'); await delay(5000); startXeonBotInc(); }
            }
        });

        const antiCallNotified = new Set();
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                const { readState } = require('./commands/anticall');
                const state = readState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try {
                        if (typeof XeonBotInc.rejectCall === 'function' && call.id)
                            await XeonBotInc.rejectCall(call.id, callerJid);
                    } catch {}
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { text: 'Anticall enabled. Call rejected.' });
                    }
                    setTimeout(async () => { try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {} }, 800);
                }
            } catch {}
        });

        XeonBotInc.ev.on('group-participants.update', async (update) => { await handleGroupParticipantUpdate(XeonBotInc, update); });
        XeonBotInc.ev.on('messages.upsert', async (m) => {
            if (m.messages[0].key?.remoteJid === 'status@broadcast') await handleStatus(XeonBotInc, m);
        });
        XeonBotInc.ev.on('status.update', async (status) => { await handleStatus(XeonBotInc, status); });
        XeonBotInc.ev.on('messages.reaction', async (status) => { await handleStatus(XeonBotInc, status); });

        return XeonBotInc;
    } catch (error) {
        console.error('Error starting bot:', error);
        await delay(5000);
        startXeonBotInc();
    }
}

startXeonBotInc().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    delete require.cache[file];
    require(file);
});
