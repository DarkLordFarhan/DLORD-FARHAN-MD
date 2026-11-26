async function membersCommand(sock, chatId, message) {
    if (!String(chatId || '').endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in a group.' }, { quoted: message });
        return;
    }
    try {
        const metadata = await sock.groupMetadata(chatId);
        const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
        if (!participants.length) {
            await sock.sendMessage(chatId, { text: 'No group members were returned.' }, { quoted: message });
            return;
        }
        const shown = participants.slice(0, 70).map((participant, index) => {
            const jid = String(participant?.id || participant?.phoneNumber || 'unknown');
            const number = jid.split('@')[0].split(':')[0];
            const display = String(participant?.notify || participant?.name || number).replace(/[\r\n]/g, ' ').slice(0, 40);
            const role = participant?.admin ? ' (admin)' : '';
            return `${index + 1}. ${display}${role}`;
        });
        const omitted = participants.length - shown.length;
        const text = [
            `👥 *${metadata.subject || 'Group members'}*`,
            `Total members: ${participants.length}`,
            '',
            ...shown,
            ...(omitted > 0 ? ['', `…and ${omitted} more member(s).`] : [])
        ].join('\n');
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('[members] Could not list group members:', error?.message || error);
        await sock.sendMessage(chatId, { text: 'Could not load the group member list.' }, { quoted: message });
    }
}

module.exports = membersCommand;
