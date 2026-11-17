const normalizeJid = require('./normalize-jid');
const { startLimitedOperation, withTimeout } = require('./with-timeout');
const ADMIN_LOOKUP_TIMEOUT_MS = 8000;
const MAX_PENDING_ADMIN_LOOKUPS = 4;
const pendingAdminLookups = new WeakMap();

function participantJids(participant) {
    return [participant?.id, participant?.lid, participant?.phoneNumber]
        .map(normalizeJid)
        .filter(Boolean);
}

async function isAdmin(sock, chatId, senderId, options = {}) {
    try {
        if (typeof chatId !== 'string' || !chatId.endsWith('@g.us')) {
            return { isSenderAdmin: false, isBotAdmin: false };
        }

        const metadataLookup = startLimitedOperation(
            pendingAdminLookups,
            sock,
            MAX_PENDING_ADMIN_LOOKUPS,
            () => sock.groupMetadata(chatId),
            'Too many group-admin lookups are pending.'
        );
        const metadata = await withTimeout(
            metadataLookup,
            options.timeoutMs ?? ADMIN_LOOKUP_TIMEOUT_MS,
            'Group-admin lookup timed out.'
        );
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
        if (err?.code !== 'COMMAND_TIMEOUT' && err?.code !== 'COMMAND_BUSY') console.error('❌ Error in isAdmin:', err);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
