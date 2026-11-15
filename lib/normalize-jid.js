function normalizeJid(jid) {
    if (typeof jid !== 'string' || !jid.trim()) return '';
    const value = jid.trim().toLowerCase();
    const at = value.indexOf('@');
    const local = (at === -1 ? value : value.slice(0, at)).split(':')[0];
    const server = at === -1 ? 's.whatsapp.net' : value.slice(at + 1);
    return local && server ? `${local}@${server}` : '';
}

module.exports = normalizeJid;
