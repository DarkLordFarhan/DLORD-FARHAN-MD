const fs = require('fs/promises');
const path = require('path');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const PLATFORM_HOSTS = {
    youtube: ['youtube.com', 'youtu.be'],
    tiktok: ['tiktok.com'],
    instagram: ['instagram.com', 'instagr.am'],
    facebook: ['facebook.com', 'fb.com', 'fb.watch']
};

function getMessageText(message) {
    return String(
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ''
    ).trim();
}

function getCommandArgument(message) {
    return getMessageText(message).replace(/^\S+\s*/, '').trim();
}

function cleanUrlCandidate(value) {
    return String(value || '').match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;!?]+$/, '') || '';
}

function validateMediaUrl(rawUrl, platform) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch {
        throw new Error('Please provide a valid media URL.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Only public HTTP or HTTPS media links are supported.');
    }

    const allowedHosts = PLATFORM_HOSTS[platform];
    if (!allowedHosts) throw new Error('Unsupported downloader platform.');

    const hostname = parsed.hostname.toLowerCase();
    const allowed = allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
    if (!allowed) throw new Error(`Please provide a valid ${platform} link.`);

    return parsed.toString();
}

function getExtension(filePath) {
    return path.extname(filePath).slice(1).toLowerCase();
}

function getYtDlpStdout(result) {
    if (result && typeof result.stdout === 'string') return result.stdout;
    return String(result || '');
}

function getMimeType(extension, kind) {
    if (kind === 'audio') return 'audio/mpeg';
    if (extension === 'webm') return 'video/webm';
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'mkv') return 'video/x-matroska';
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'gif') return 'image/gif';
    return 'video/mp4';
}

function buildYtDlpFlags(workDir, { kind = 'video', playlist = false, maxFiles = 10 } = {}) {
    const flags = {
        noWarnings: true,
        noProgress: true,
        noColor: true,
        jsRuntimes: 'node',
        output: path.join(workDir, '%(id)s.%(ext)s'),
        print: 'after_move:filepath',
        maxFilesize: '64M'
    };

    if (playlist) {
        flags.playlistEnd = Math.max(1, Math.min(10, Number(maxFiles) || 1));
    } else {
        flags.noPlaylist = true;
    }

    if (kind === 'audio') {
        flags.format = 'bestaudio/best';
        flags.extractAudio = true;
        flags.audioFormat = 'mp3';
        flags.audioQuality = '5';
    } else {
        flags.format = 'best[ext=mp4][acodec!=none]/best[ext=mp4]/best';
        flags.mergeOutputFormat = 'mp4';
    }

    return flags;
}

async function downloadMedia(rawUrl, {
    platform,
    kind = 'video',
    playlist = false,
    maxFiles = 10,
    maxBytes = MAX_FILE_BYTES
} = {}) {
    const url = validateMediaUrl(rawUrl, platform);
    const ytdlp = require('youtube-dl-exec');
    const tempRoot = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tempRoot, { recursive: true });
    const workDir = await fs.mkdtemp(path.join(tempRoot, 'media-'));

    try {
        const timeout = playlist ? 300000 : 180000;
        const flags = buildYtDlpFlags(workDir, { kind, playlist, maxFiles });
        if (process.env.YTDLP_COOKIES_FILE) {
            flags.cookies = path.resolve(process.env.YTDLP_COOKIES_FILE);
        }
        const subprocess = ytdlp.exec(url, flags, {
            timeout,
            killSignal: 'SIGKILL',
            windowsHide: true
        });
        const result = await subprocess;
        const stdout = getYtDlpStdout(result);
        const printedPaths = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const root = path.resolve(workDir) + path.sep;
        const paths = [...new Set(printedPaths.map(file => path.resolve(file)).filter(file => file.startsWith(root)))];

        if (!paths.length) throw new Error('The media extractor did not produce a file.');

        const files = [];
        let totalBytes = 0;
        for (const filePath of paths.slice(0, playlist ? Math.min(10, maxFiles) : 1)) {
            const stat = await fs.stat(filePath);
            if (!stat.isFile() || stat.size <= 0) continue;
            totalBytes += stat.size;
            if (stat.size > MAX_FILE_BYTES || totalBytes > maxBytes) {
                throw new Error('Downloaded media exceeds the WhatsApp size limit.');
            }
            const extension = kind === 'audio' ? 'mp3' : getExtension(filePath);
            files.push({
                buffer: await fs.readFile(filePath),
                fileName: `${path.basename(filePath, path.extname(filePath))}.${extension}`,
                extension,
                mimetype: getMimeType(extension, kind)
            });
        }

        if (!files.length) throw new Error('The media extractor returned an empty file.');
        return files;
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

function formatDownloaderError(error) {
    const message = String(error?.message || error || 'Unknown downloader error');
    if (/Cannot find module ['"]youtube-dl-exec/.test(message)) {
        return 'The media downloader is not installed. Reinstall the bot dependencies and restart it.';
    }
    if (/timed? ?out|ETIMEDOUT|SIGKILL/i.test(message)) {
        return 'The media provider timed out. Try again later or use another public link.';
    }
    if (/exceeds the WhatsApp size limit/i.test(message)) return message;
    return 'The media could not be downloaded. It may be private, unavailable, restricted, or temporarily blocked.';
}

module.exports = {
    MAX_FILE_BYTES,
    PLATFORM_HOSTS,
    buildYtDlpFlags,
    cleanUrlCandidate,
    downloadMedia,
    formatDownloaderError,
    getCommandArgument,
    getMessageText,
    getYtDlpStdout,
    validateMediaUrl
};
