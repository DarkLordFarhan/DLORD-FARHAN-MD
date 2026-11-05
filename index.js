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
console.log('  .env location : ' + path.join(__dirname, '.env'));
console.log('  SESSION_ID set: ' + (!!process.env.SESSION_ID));
console.log('='.repeat(55));
// ─────────────────────────────────────────────────────────────────────────────

// ─── SESSION LOADER ───────────────────────────────────────────────────────────
// Reads SESSION_ID from .env (format: LordBot<base64_creds_json>),
// decodes it, and writes session/creds.json so the bot connects without QR.
function loadSessionFromEnv() {
    const SESSION_ID = process.env.SESSION_ID || '';
    if (!SESSION_ID) {
        console.log(chalk.yellow('⚠️  No SESSION_ID found in .env — falling back to QR/pairing code'));
        return false;
    }
    if (!SESSION_ID.startsWith('LordBot')) {
        console.log(chalk.red('❌ SESSION_ID must start with "LordBot" — check your .env file'));
        return false;
    }
    try {
        const encoded = SESSION_ID.replace(/^LordBot/, '');
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        JSON.parse(decoded); // validate JSON
        if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true });
        fs.writeFileSync('./session/creds.json', decoded, 'utf-8');
        console.log(chalk.green('✅ SESSION_ID loaded — connecting without QR code!'));
        return true;
    } catch (err) {
        console.log(chalk.red('❌ Failed to decode SESSION_ID: ' + err.message));
        console.log(chalk.yellow('⚠️  Make sure you copied the full LordBot... string from WhatsApp'));
        return false;
    }
}

const sessionLoaded = loadSessionFromEnv();
// ─────────────────────────────────────────────────────────────────────────────

let owner = ['0108817832'];
try { owner = JSON.parse(fs.readFileSync('./data/owner.json')); } catch (e) { console.log('⚠️  owner.json missing, using default owner'); }

global.botname = 'LordFarhan Bot';
global.themeemoji = '•';

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true
    }
};

async function startXeonBotInc() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('./session');
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
            try {
                const mek = chatUpdate.messages[0];
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
                console.log(chalk.green('Connected! => ' + JSON.stringify(XeonBotInc.user, null, 2)));
                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, {
                        text: '*LordFarhan Bot Connected!*\n\nStatus: Online\n_Powered by DarkLordFarhanXMDTech_',
                        ...channelInfo
                    });
                } catch (e) { console.error('Error sending connect message:', e.message); }
                await delay(1999);
                console.log(chalk.bold.blue('[ LordFarhan Bot ]'));
                console.log(chalk.green('Bot Connected Successfully! Version: ' + settings.version));
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(chalk.red('Connection closed — statusCode: ' + statusCode));
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try { rmSync('./session', { recursive: true, force: true }); } catch {}
                    console.log(chalk.red('Session expired! Update SESSION_ID in your .env and restart.'));
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
