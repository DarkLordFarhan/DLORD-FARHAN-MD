const assert = require('node:assert/strict');
const test = require('node:test');
const settings = require('../settings');
const ownerCommand = require('../commands/owner');
const createStickerMetadata = require('../lib/sticker-metadata');
const fancyFontCommand = require('../commands/fancyfont');
const { ALL_STYLES, styleText } = fancyFontCommand;

const OWNER_NAME = '☠︎ᴰᴸᴼᴿᴰ_ᶠᴬᴿᴴᴬᴺ〆';

test('`.owner` shares the requested owner name and +254795463911 contact', async () => {
    assert.equal(settings.botOwner, OWNER_NAME);
    assert.equal(settings.ownerNumber, '254795463911');

    const sent = [];
    await ownerCommand({ sendMessage: async (...args) => sent.push(args) }, 'chat');
    assert.equal(sent.length, 1);
    const contact = sent[0][1].contacts.contacts[0];
    assert.equal(sent[0][1].contacts.displayName, OWNER_NAME);
    assert.match(contact.vcard, new RegExp(`FN:${OWNER_NAME}`));
    assert.match(contact.vcard, /TEL;waid=254795463911:\+254795463911/);
});

test('`.take` and `.sticker` share the requested pack name and publisher', () => {
    const takeMetadata = createStickerMetadata(['🤖']);
    const stickerMetadata = createStickerMetadata(['✨']);
    assert.equal(takeMetadata['sticker-pack-name'], OWNER_NAME);
    assert.equal(takeMetadata['sticker-pack-publisher'], OWNER_NAME);
    assert.equal(stickerMetadata['sticker-pack-name'], OWNER_NAME);
    assert.equal(stickerMetadata['sticker-pack-publisher'], OWNER_NAME);
    assert.notEqual(takeMetadata['sticker-pack-id'], stickerMetadata['sticker-pack-id']);
    assert.deepEqual(takeMetadata.emojis, ['🤖']);
    assert.deepEqual(stickerMetadata.emojis, ['✨']);
});

test('font converter has unique numbered styles and transforms Latin names', () => {
    const ids = ALL_STYLES.map(style => style.id);
    assert.equal(ids.length, 12);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(styleText('Farhan 2026', ALL_STYLES[0]), '𝐅𝐚𝐫𝐡𝐚𝐧 𝟐𝟎𝟐𝟔');
    assert.equal(styleText('Farhan', ALL_STYLES.find(style => style.name === 'Fullwidth')), 'Ｆａｒｈａｎ');
    assert.equal(styleText('Farhan', ALL_STYLES.find(style => style.name === 'Circled')), 'Ⓕⓐⓡⓗⓐⓝ');
});

test('`.font <name>` previews styles and `.font <number> <name>` returns a chosen style', async () => {
    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };

    await fancyFontCommand(sock, 'chat', { message: { conversation: '.font Farhan' } });
    assert.match(sent[0][1].text, /FANCY NAME FONTS/);
    assert.match(sent[0][1].text, /1\. Bold: 𝐅𝐚𝐫𝐡𝐚𝐧/);
    assert.match(sent[0][1].text, /12\. Fullwidth: Ｆａｒｈａｎ/);
    assert.match(sent[0][1].text, /\.font <number> <name>/);

    await fancyFontCommand(sock, 'chat', { message: { conversation: '.font 3 Farhan' } });
    assert.match(sent[1][1].text, /Bold Italic/);
    assert.ok(sent[1][1].text.includes(styleText('Farhan', ALL_STYLES[2])));
});
