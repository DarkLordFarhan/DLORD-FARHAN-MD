const moment = require('moment-timezone');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const REPOSITORY_OWNER = 'DarkLordFarhan';
const REPOSITORY_NAME = 'DLORD-FARHAN-MD';
const REPOSITORY_API_URL = `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}`;
const REQUEST_TIMEOUT_MS = 10000;

function formatRepositorySize(sizeInKb) {
  const size = Number(sizeInKb);
  if (!Number.isFinite(size) || size < 0) return 'Unknown';
  if (size < 1024) return `${size} KB`;
  return `${(size / 1024).toFixed(2)} MB`;
}

function formatRepositoryDate(value) {
  const date = moment(value);
  return date.isValid() ? date.tz('Africa/Nairobi').format('DD MMM YYYY, HH:mm [EAT]') : 'Unknown';
}

function truncateDescription(value, maxLength = 180) {
  const description = String(value || 'No description set').replace(/\s+/g, ' ').trim();
  if (description.length <= maxLength) return description;
  return `${description.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatRepositoryInfo(repository) {
  const fullName = repository.full_name || `${REPOSITORY_OWNER}/${REPOSITORY_NAME}`;
  const owner = repository.owner?.login || REPOSITORY_OWNER;
  const visibility = repository.private ? 'Private' : 'Public';
  const repositoryUrl = repository.html_url || `https://github.com/${fullName}`;
  const cloneUrl = repository.clone_url || `${repositoryUrl}.git`;

  return [
    '*📦 BOT REPOSITORY DETAILS*',
    '',
    `✦ *Repository:* ${fullName}`,
    `✦ *Description:* ${truncateDescription(repository.description)}`,
    `✦ *Owner:* ${owner}`,
    `✦ *Visibility:* ${visibility}`,
    `✦ *Default branch:* ${repository.default_branch || 'Unknown'}`,
    `✦ *Language:* ${repository.language || 'Not specified'}`,
    `✦ *Stars:* ${repository.stargazers_count ?? 0}`,
    `✦ *Forks:* ${repository.forks_count ?? 0}`,
    `✦ *Watchers:* ${repository.watchers_count ?? 0}`,
    `✦ *Open issues:* ${repository.open_issues_count ?? 0}`,
    `✦ *Size:* ${formatRepositorySize(repository.size)}`,
    `✦ *Created:* ${formatRepositoryDate(repository.created_at)}`,
    `✦ *Last updated:* ${formatRepositoryDate(repository.updated_at)}`,
    '',
    `🔗 *Repository:* ${repositoryUrl}`,
    `📥 *Clone:* ${cloneUrl}`
  ].join('\n');
}

async function fetchRepositoryData(fetchImpl = fetch) {
  const response = await fetchImpl(REPOSITORY_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DLORD-FARHAN-MD'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const error = new Error(`GitHub API returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const repository = await response.json();
  if (!repository || typeof repository !== 'object' || Array.isArray(repository)) {
    throw new Error('GitHub returned invalid repository data');
  }
  return repository;
}

async function githubCommand(sock, chatId, message, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const imagePath = options.imagePath || path.join(__dirname, '../assets/bot_image.jpg');

  try {
    const repository = await fetchRepositoryData(fetchImpl);
    const details = formatRepositoryInfo(repository);

    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      await sock.sendMessage(chatId, { image: imageBuffer, caption: details }, { quoted: message });
    } else {
      await sock.sendMessage(chatId, { text: details }, { quoted: message });
    }
  } catch (error) {
    console.error('[GITHUB] Failed to fetch bot repository details:', error?.message || error);
    await sock.sendMessage(chatId, {
      text: '❌ Could not fetch the bot repository details from GitHub. Please try again shortly.'
    }, { quoted: message });
  }
}

githubCommand.fetchRepositoryData = fetchRepositoryData;
githubCommand.formatRepositoryInfo = formatRepositoryInfo;
githubCommand.constants = { REPOSITORY_OWNER, REPOSITORY_NAME, REPOSITORY_API_URL };

module.exports = githubCommand;
