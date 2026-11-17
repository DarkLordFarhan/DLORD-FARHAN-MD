const crypto = require('crypto');
const settings = require('../settings');

function createStickerMetadata(emojis = ['🤖']) {
    const packName = settings.stickerPackName || settings.packname || 'DLORD-FARHAN';
    const publisher = settings.stickerPackPublisher || settings.author || settings.botOwner || 'DLORD-FARHAN';
    return {
        'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
        'sticker-pack-name': packName,
        'sticker-pack-publisher': publisher,
        emojis: [...emojis]
    };
}

module.exports = createStickerMetadata;
