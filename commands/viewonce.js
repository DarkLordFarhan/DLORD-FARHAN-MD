const {
  downloadContentFromMessage,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');

function unwrap(msg) {
  let once = false;
  while (msg) {
    if (msg.viewOnceMessage?.message) {
      once = true;
      msg = msg.viewOnceMessage.message;
    } else if (msg.viewOnceMessageV2?.message) {
      once = true;
      msg = msg.viewOnceMessageV2.message;
    } else if (msg.viewOnceMessageV2Extension?.message) {
      once = true;
      msg = msg.viewOnceMessageV2Extension.message;
    } else if (msg.ephemeralMessage?.message) {
      msg = msg.ephemeralMessage.message;
    } else {
      break;
    }
  }
  return { msg, once };
}

async function viewonceCommand(sock, chatId, message) {
  try {
    const context =
      message.message?.extendedTextMessage?.contextInfo;

    if (!context?.quotedMessage) {
      console.error('[VV] Reply to view-once media.');
      return;
    }

    const { msg, once } = unwrap(context.quotedMessage);
    const image = msg?.imageMessage;
    const video = msg?.videoMessage;
    const media = image || video;

    if (!media || !(once || media.viewOnce === true)) {
      console.error('[VV] No view-once media found.');
      return;
    }

    const type = image ? 'image' : 'video';
    const stream = await downloadContentFromMessage(media, type);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('Empty media');

    const inbox = jidNormalizedUser(sock.user?.id || '');
    if (!inbox.endsWith('@s.whatsapp.net')) {
      throw new Error('Bot inbox unavailable');
    }

    await sock.sendMessage(inbox, image
      ? { image: buffer, caption: 'Recovered view-once photo' }
      : {
          video: buffer,
          mimetype: media.mimetype || 'video/mp4',
          caption: 'Recovered view-once video'
        }
    );

    console.log('[VV] Delivered privately to bot inbox.');
  } catch (error) {
    console.error('[VV ERROR]', error);
  }
}

module.exports = viewonceCommand;
