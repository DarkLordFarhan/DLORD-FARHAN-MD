const assert = require('node:assert/strict');
const test = require('node:test');

const githubCommand = require('../commands/github');

const repositoryPayload = {
    full_name: 'DarkLordFarhan/DLORD-FARHAN-MD',
    description: 'WhatsApp automation bot',
    owner: { login: 'DarkLordFarhan' },
    stargazers_count: 12,
    forks_count: 4,
    subscribers_count: 6,
    watchers_count: 12,
    open_issues_count: 2,
    language: 'JavaScript',
    default_branch: 'main',
    size: 1536,
    updated_at: '2026-11-14T10:30:00Z',
    clone_url: 'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD.git',
    html_url: 'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD'
};

test('GitHub command fetches live DLORD-FARHAN-MD details and formats repository metadata', async () => {
    const sent = [];
    const sock = { sendMessage: async (...args) => sent.push(args) };
    let requestedUrl;
    let requestedHeaders;

    await githubCommand(sock, 'chat', { key: { id: 'github-test' } }, {
        imagePath: '/nonexistent/test-banner.jpg',
        fetch: async (url, options) => {
            requestedUrl = url;
            requestedHeaders = options.headers;
            return { ok: true, json: async () => repositoryPayload };
        }
    });

    assert.equal(requestedUrl, 'https://api.github.com/repos/DarkLordFarhan/DLORD-FARHAN-MD');
    assert.equal(requestedHeaders.Accept, 'application/vnd.github+json');
    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /DarkLordFarhan\/DLORD-FARHAN-MD/);
    assert.match(sent[0][1].text, /Stars:\*?\s*12/);
    assert.match(sent[0][1].text, /Forks:\*?\s*4/);
    assert.match(sent[0][1].text, /Default branch:\*?\s*main/);
    assert.match(sent[0][1].text, /https:\/\/github\.com\/DarkLordFarhan\/DLORD-FARHAN-MD/);
});

test('GitHub command reports repository API failures without crashing', async () => {
    const sent = [];
    await githubCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'github-error-test' } },
        {
            imagePath: '/nonexistent/test-banner.jpg',
            fetch: async () => ({ ok: false, status: 404 })
        }
    );

    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /repository could not be found/i);
});
