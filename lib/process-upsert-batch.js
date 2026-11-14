async function processUpsertBatch(sock, chatUpdate, handlers) {
    const messages = Array.isArray(chatUpdate?.messages) ? chatUpdate.messages : [];
    const { handleMessages, handleStatus, channelInfo = {} } = handlers;

    for (const message of messages) {
        if (!message?.message) continue;

        if (Object.keys(message.message)[0] === 'ephemeralMessage') {
            message.message = message.message.ephemeralMessage?.message;
            if (!message.message) continue;
        }

        const singleUpdate = { ...chatUpdate, messages: [message] };
        const remoteJid = message.key?.remoteJid;

        if (remoteJid === 'status@broadcast') {
            try {
                await handleStatus(sock, singleUpdate);
            } catch (error) {
                console.error('Error in handleStatus:', error);
            }
            continue;
        }

        if (chatUpdate.type === 'append') {
            const text = (
                message.message?.conversation ||
                message.message?.extendedTextMessage?.text ||
                message.message?.imageMessage?.caption ||
                message.message?.videoMessage?.caption ||
                ''
            ).trim();
            if (!message.key?.fromMe || !text.startsWith('.')) continue;

            const timestampValue = message.messageTimestamp?.toNumber?.() ?? message.messageTimestamp;
            const timestampSeconds = Number(timestampValue);
            if (Number.isFinite(timestampSeconds) && timestampSeconds < Date.now() / 1000 - 5 * 60) continue;
        } else if (chatUpdate.type !== 'notify') {
            continue;
        }

        if (!sock.public && !message.key?.fromMe && chatUpdate.type === 'notify' &&
            !remoteJid?.endsWith('@g.us')) {
            continue;
        }
        if (message.key?.id?.startsWith('BAE5') && message.key.id.length === 16) continue;
        if (sock?.msgRetryCounterCache) sock.msgRetryCounterCache.clear();

        try {
            await handleMessages(sock, singleUpdate, true);
        } catch (error) {
            console.error('Error in handleMessages:', error);
            if (remoteJid) {
                await sock.sendMessage(remoteJid, {
                    text: 'An error occurred while processing your message.',
                    ...channelInfo
                }).catch(console.error);
            }
        }
    }
}

module.exports = processUpsertBatch;
