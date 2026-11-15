const moment = require('moment-timezone');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const REPOSITORY = 'DarkLordFarhan/DLORD-FARHAN-MD';
const REPOSITORY_API_URL = `https://api.github.com/repos/${REPOSITORY}`;

function buildRepositoryText(repository) {
  const updatedAt = repository.updated_at
    ? moment(repository.updated_at).tz('Africa/Nairobi').format('DD/MM/YY HH:mm:ss [EAT]')
    : 'Unknown';
  const sizeMb = Number.isFinite(Number(repository.size))
    ? (Number(repository.size) / 1024).toFixed(2)
    : '0.00';
  const description = String(repository.description || 'No description provided.')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  return [
    '*DLORD-FARHAN-MD — GitHub Repository*',
    '',
    `✩ *Repository:* ${repository.full_name || REPOSITORY}`,
    `✩ *Description:* ${description}`,
    `✩ *Owner:* ${repository.owner?.login || 'DarkLordFarhan'}`,
    `✩ *Stars:* ${repository.stargazers_count ?? 0}`,
    `✩ *Forks:* ${repository.forks_count ?? 0}`,
    `✩ *Watchers:* ${repository.subscribers_count ?? repository.watchers_count ?? 0}`,
    `✩ *Open issues:* ${repository.open_issues_count ?? 0}`,
    `✩ *Language:* ${repository.language || 'Not specified'}`,
    `✩ *Default branch:* ${repository.default_branch || 'main'}`,
    `✩ *Size:* ${sizeMb} MB`,
    `✩ *Last updated:* ${updatedAt}`,
    `✩ *Clone:* ${repository.clone_url || `https://github.com/${REPOSITORY}.git`}`,
    `✩ *Repository URL:* ${repository.html_url || `https://github.com/${REPOSITORY}`}`
  ].join('\n');
}

async function githubCommand(sock, chatId, message, options = {}) {
  const fetchRepository = options.fetch || fetch;
  try {
    const response = await fetchRepository(REPOSITORY_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DLORD-FARHAN-MD-WhatsApp-Bot'
      }
    });

    if (!response.ok) {
      const reason = response.status === 404
        ? 'The configured GitHub repository could not be found.'
        : `GitHub returned HTTP ${response.status || 'error'}.`;
      await sock.sendMessage(chatId, { text: `❌ ${reason} Please try again later.` }, { quoted: message });
      return;
    }

    const repository = await response.json();
    const text = buildRepositoryText(repository);
    const imagePath = options.imagePath || path.join(__dirname, '../assets/bot_image.jpg');

    if (fs.existsSync(imagePath)) {
      await sock.sendMessage(chatId, {
        image: fs.readFileSync(imagePath),
        caption: text
      }, { quoted: message });
    } else {
      await sock.sendMessage(chatId, { text }, { quoted: message });
    }
  } catch (error) {
    console.error('Error fetching GitHub repository information:', error);
    await sock.sendMessage(chatId, {
      text: '❌ Could not fetch GitHub repository details right now. Please try again later.'
    }, { quoted: message });
  }
}

module.exports = githubCommand;
module.exports.REPOSITORY_API_URL = REPOSITORY_API_URL;
module.exports.buildRepositoryText = buildRepositoryText;
