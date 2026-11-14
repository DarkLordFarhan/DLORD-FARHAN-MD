const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const githubCommand = require('../commands/github');

test('GitHub repo command fetches and formats live details for the bot repository', async () => {
    const requests = [];
    const sent = [];
    const repository = {
        full_name: 'DarkLordFarhan/DLORD-FARHAN-MD',
        description: 'WhatsApp bot repository',
        private: false,
        default_branch: 'main',
        stargazers_count: 7,
        forks_count: 3,
        watchers_count: 5,
        open_issues_count: 2,
        language: 'JavaScript',
        size: 1463,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-06-01T10:00:00Z',
        html_url: 'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD',
        clone_url: 'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD.git',
        owner: { login: 'DarkLordFarhan' }
    };

    await githubCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'github-test' } },
        {
            fetchImpl: async (url, options) => {
                requests.push({ url, options });
                return { ok: true, json: async () => repository };
            },
            imagePath: path.join(__dirname, '../assets/bot_image.jpg')
        }
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.github.com/repos/DarkLordFarhan/DLORD-FARHAN-MD');
    assert.equal(requests[0].options.headers.Accept, 'application/vnd.github+json');
    assert.equal(requests[0].options.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(requests[0].options.headers['User-Agent'], 'DLORD-FARHAN-MD');
    assert.ok(requests[0].options.signal);

    assert.equal(sent.length, 1);
    const payload = sent[0][1];
    assert.ok(Buffer.isBuffer(payload.image));
    assert.ok(payload.caption.length < 1024);
    for (const detail of [
        'DarkLordFarhan/DLORD-FARHAN-MD',
        'WhatsApp bot repository',
        '*Owner:* DarkLordFarhan',
        '*Visibility:* Public',
        '*Default branch:* main',
        '*Language:* JavaScript',
        '*Stars:* 7',
        '*Forks:* 3',
        '*Watchers:* 5',
        '*Open issues:* 2',
        '*Size:* 1.43 MB',
        '*Created:* 01 Jan 2024, 03:00 EAT',
        '*Last updated:* 01 Jun 2024, 13:00 EAT',
        'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD',
        'https://github.com/DarkLordFarhan/DLORD-FARHAN-MD.git'
    ]) {
        assert.ok(payload.caption.includes(detail), `expected repository details to include ${detail}`);
    }
});

test('GitHub repo command reports an API error without leaking internals', async () => {
    const sent = [];
    await githubCommand(
        { sendMessage: async (...args) => sent.push(args) },
        'chat',
        { key: { id: 'github-error-test' } },
        {
            fetchImpl: async () => ({ ok: false, status: 404 }),
            imagePath: path.join(__dirname, '../assets/missing-test-image.jpg')
        }
    );

    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /Could not fetch the bot repository details/);
    assert.doesNotMatch(sent[0][1].text, /HTTP 404|stack|token/i);
});
