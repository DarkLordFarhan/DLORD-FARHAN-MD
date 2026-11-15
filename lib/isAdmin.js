const normalizeJid = require('./normalize-jid');

function participantJids(participant) {
    return [participant?.id, participant?.lid, participant?.phoneNumber]
        .map(normalizeJid)
        .filter(Boolean);
}

async function isAdmin(sock, chatId, senderId) {
    try {
        if (typeof chatId !== 'string' || !chatId.endsWith('@g.us')) {
            return { isSenderAdmin: false, isBotAdmin: false };
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
        const botJids = new Set([sock.user?.id, sock.user?.lid].map(normalizeJid).filter(Boolean));
        const senderJids = new Set([senderId].map(normalizeJid).filter(Boolean));

        const hasMatchingAdmin = (candidateJids, participant) => {
            const participantIsAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            return participantIsAdmin && participantJids(participant).some(jid => candidateJids.has(jid));
        };

        return {
            isSenderAdmin: participants.some(participant => hasMatchingAdmin(senderJids, participant)),
            isBotAdmin: participants.some(participant => hasMatchingAdmin(botJids, participant))
        };
    } catch (err) {
        console.error('❌ Error in isAdmin:', err);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
