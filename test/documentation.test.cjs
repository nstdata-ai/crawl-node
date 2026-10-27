const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectDocument, installationCommand, sampleCommands } = require('../scripts/documentation.cjs');

test('documentation rendering catches the observed Chinese emphasis regression', () => {
    assert.throws(() => inspectDocument('**用途：**提交', 'guide.md'), /emphasis/);
    const result = inspectDocument('**用途**：提交', 'guide.md');
    assert.match(result.html, /<strong>用途<\/strong>：提交/);
    assert.doesNotThrow(() => inspectDocument('```text\n**literal**\n```', 'guide.md'));
});

test('documentation samples keep their user-visible runnable filenames', () => {
    const result = inspectDocument('# Setup\n\nSave as `client.mts`.\n\n```typescript\nexport const a = 1;\n```\n', 'guide.md');
    assert.deepEqual(result.samples, [{ filename: 'client.mts', code: 'export const a = 1;' }]);
    assert.throws(() => inspectDocument('```typescript\nconst a = 1;\n```', 'guide.md'), /filename/);
    assert.throws(() => inspectDocument('Save as `a.mts`.\n\n```typescript\nconst a = 1;\n```\n\n```typescript\nconst a = 2;\n```', 'guide.md'), /filename/);
});

test('documentation links and headings are read from rendered Markdown tokens', () => {
    const result = inspectDocument('# 完整用法\n\n[Guide](guide.md#完整用法)\n\n`[not a link](missing.md)`', 'README.md');
    assert.deepEqual(result.links, ['guide.md#完整用法']);
    assert.deepEqual(result.headings, ['完整用法']);
});

test('valid emphasis inside lists and duplicate heading anchors render correctly', () => {
    const result = inspectDocument('- Choose **Settings → Environments**.\n\n# Setup\n\n# Setup\n', 'guide.md');
    assert.match(result.html, /<strong>Settings → Environments<\/strong>/);
    assert.deepEqual(result.headings, ['setup', 'setup-1']);
    assert.match(result.html, /id="setup-1"/);
});

test('executable fences cannot bypass checks through another language or extra info', () => {
    for (const language of ['javascript', 'js', 'mjs', 'cjs', 'jsx', 'mts', 'cts', 'tsx', 'typescript title=demo']) {
        assert.throws(() => inspectDocument('```' + language + '\nconsole.log(1);\n```', 'guide.md'),
            /executable.*language/i);
    }
});

test('nested executable fences cannot be silently excluded from runnable samples', () => {
    assert.throws(() => inspectDocument('> Save as `nested.mts`.\n>\n> ```typescript\n> console.log(1);\n> ```',
        'guide.md'), /nested executable/i);
    assert.throws(() => inspectDocument('- Save as `nested.mts`.\n\n  ```ts\n  console.log(1);\n  ```',
        'guide.md'), /nested executable/i);
});

test('documented installation requires the public package command', () => {
    const document = inspectDocument('```sh\nnpm install @nstdata-ai/crawl\n```', 'README.md');
    assert.deepEqual(installationCommand(document, '@nstdata-ai/crawl'), ['npm', 'install', '@nstdata-ai/crawl']);
    for (const command of ['npm install ./candidate.tgz', 'npm install @nstdata-ai/crawl@1.0.1']) {
        assert.throws(() => installationCommand(inspectDocument('```sh\n' + command + '\n```', 'README.md'),
            '@nstdata-ai/crawl'), /public installation/);
    }
    assert.throws(() => installationCommand(inspectDocument('Use the local installation steps.', 'README.md'),
        '@nstdata-ai/crawl'), /public installation/);
});

test('runnable documentation uses its own command and environment text', () => {
    const source = '```dotenv\nNSTDATA_API_TOKEN=your-api-key\n```\n\n`demo.mts`\n\n'
        + '```typescript\nconsole.log(1);\n```\n\n```sh\nnode --env-file=.env demo.mts\n```';
    const document = inspectDocument(source, 'README.md');
    assert.deepEqual(document.environments, ['NSTDATA_API_TOKEN=your-api-key']);
    assert.deepEqual([...sampleCommands(document)], [['demo.mts', ['--env-file=.env', 'demo.mts']]]);
    for (const changed of [source.replace('--env-file=.env', '--env-file=.wrong'),
        source.replace('node --env-file=.env demo.mts', 'node --env-file=.env typo.mts')]) {
        assert.throws(() => sampleCommands(inspectDocument(changed, 'README.md')), /command/);
    }
});

test('unhandled or nested shell and environment fences cannot bypass verification', () => {
    for (const source of ['```bash\nnode demo.mts\n```', '```sh\ncurl https://example.com\n```',
        '> ```sh\n> npm pack\n> ```', '> ```dotenv\n> KEY=value\n> ```']) {
        assert.throws(() => inspectDocument(source, 'guide.md'), /command|fence|nested/i);
    }
});
