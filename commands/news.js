const NEWS_FEED_URL = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const MAX_FEED_CHARS = 1024 * 1024;

function decodeXml(text) {
    return String(text || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, value) => {
            try { return String.fromCodePoint(parseInt(value, 16)); } catch { return ''; }
        })
        .replace(/&#(\d+);/g, (_, value) => {
            try { return String.fromCodePoint(parseInt(value, 10)); } catch { return ''; }
        })
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function readTag(xml, tagName) {
    const expression = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i');
    const match = String(xml || '').match(expression);
    if (!match) return '';
    return decodeXml(match[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRss(xml) {
    return [...String(xml || '').matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)]
        .map((match) => ({
            title: readTag(match[1], 'title'),
            description: readTag(match[1], 'description'),
            link: readTag(match[1], 'link')
        }))
        .filter((item) => item.title && /^https:\/\//i.test(item.link));
}

async function newsCommand(sock, chatId, options = {}) {
    try {
        const fetchImpl = options.fetch || globalThis.fetch;
        if (typeof fetchImpl !== 'function') throw new Error('Fetch unavailable');
        const response = await fetchImpl(NEWS_FEED_URL, {
            headers: { accept: 'application/rss+xml, application/xml, text/xml' },
            redirect: 'error',
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                ? AbortSignal.timeout(10000)
                : undefined
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const feed = await response.text();
        if (feed.length > MAX_FEED_CHARS) throw new Error('FEED_TOO_LARGE');

        const articles = parseRss(feed).slice(0, 5);
        if (!articles.length) {
            await sock.sendMessage(chatId, { text: 'No headlines are available right now.' });
            return;
        }
        const message = '📰 *BBC World News*\n\n' + articles.map((article, index) => {
            const description = article.description
                ? `\n${article.description.slice(0, 260)}`
                : '';
            return `${index + 1}. *${article.title.slice(0, 240)}*${description}\n${article.link}`;
        }).join('\n\n');
        await sock.sendMessage(chatId, { text: message });
    } catch {
        await sock.sendMessage(chatId, {
            text: 'Sorry, I could not fetch headlines right now. Please try again later.'
        });
    }
}

module.exports = newsCommand;
module.exports.parseRss = parseRss;
