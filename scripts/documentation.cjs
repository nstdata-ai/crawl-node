const assert = require('node:assert/strict');
const { marked } = require('marked');

function inlineText(tokens) {
    return tokens.map(token => token.tokens ? inlineText(token.tokens) : token.text ?? '').join('');
}

function inspectDocument(source, filename) {
    const tokens = marked.lexer(source);
    const links = [];
    const headings = [];
    const headingIds = new WeakMap();
    const occurrences = new Map();
    let executableBlocks = 0;
    let setupBlocks = 0;
    marked.walkTokens(tokens, token => {
        if (token.type === 'code') {
            const language = (token.lang ?? '').toLowerCase();
            const executable = /^(?:javascript|js|mjs|cjs|jsx|typescript|ts|mts|cts|tsx)(?:\s|$)/.test(language);
            if (executable) {
                assert.ok(['typescript', 'ts'].includes(language), `Unsupported executable fence language in ${filename}`);
                executableBlocks++;
            }
            if (/^(?:sh|bash|shell|dotenv)(?:\s|$)/.test(language)) {
                assert.ok(['sh', 'dotenv'].includes(language), `Unsupported setup fence in ${filename}`);
                setupBlocks++;
            }
        }
        if (token.type === 'link' || token.type === 'image') links.push(token.href);
        if (token.type === 'text' && !token.tokens
            && /(?<!\\)(\*\*|__)(?=\S)[^\n]*?(?<!\\)\1/.test(token.raw)) {
            assert.fail(`Unrendered emphasis in ${filename}`);
        }
        if (token.type === 'heading') {
            const slug = inlineText(token.tokens).toLowerCase()
                .replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
            const count = occurrences.get(slug) ?? 0;
            occurrences.set(slug, count + 1);
            const id = count ? `${slug}-${count}` : slug;
            headings.push(id);
            headingIds.set(token, id);
        }
    });
    const samples = [];
    const commands = [];
    const environments = [];
    let collectedSetupBlocks = 0;
    let previous;
    for (const token of tokens) {
        if (token.type === 'space') continue;
        if (token.type === 'code' && /^(typescript|ts)$/i.test(token.lang ?? '')) {
            const names = previous?.type === 'paragraph'
                ? [...previous.raw.matchAll(/`([a-z][a-z0-9-]*\.mts)`/gi)] : [];
            assert.equal(names.length, 1, `Runnable filename required before code in ${filename}`);
            const name = names[0][1];
            assert.ok(!samples.some(sample => sample.filename === name), `Duplicate filename in ${filename}: ${name}`);
            samples.push({ filename: name, code: token.text });
        }
        if (token.type === 'code' && token.lang?.toLowerCase() === 'sh') {
            for (const line of token.text.split('\n').filter(line => line.trim())) {
                const args = line.trim().split(/\s+/);
                assert.ok(['node', 'npm'].includes(args[0])
                    && args.every(arg => /^[a-zA-Z0-9_@./:=+-]+$/.test(arg)),
                `Unsupported documentation command in ${filename}`);
                commands.push(args);
            }
            collectedSetupBlocks++;
        }
        if (token.type === 'code' && token.lang?.toLowerCase() === 'dotenv') {
            environments.push(token.text);
            collectedSetupBlocks++;
        }
        previous = token;
    }
    assert.equal(samples.length, executableBlocks, `Nested executable fences are not supported in ${filename}`);
    assert.equal(collectedSetupBlocks, setupBlocks, `Nested setup fences are not supported in ${filename}`);
    const renderer = new marked.Renderer();
    renderer.heading = token => `<h${token.depth} id="${headingIds.get(token)}">${marked.Parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    return { html: marked.parser(tokens, { renderer }), samples, commands, environments, links, headings };
}

function installationCommand(document, name) {
    const install = document.commands.filter(args => args[0] === 'npm' && args[1] === 'install');
    assert.deepEqual(install, [['npm', 'install', name]], 'README must provide one public installation command');
    return install[0];
}

function sampleCommands(document) {
    const commands = new Map();
    for (const args of document.commands.filter(args => args[0] === 'node')) {
        assert.ok(args.length === 3 && args[1] === '--env-file=.env'
            && document.samples.some(sample => sample.filename === args[2]), 'Invalid documentation sample command');
        assert.ok(!commands.has(args[2]), 'Duplicate documentation sample command');
        commands.set(args[2], args.slice(1));
    }
    for (const sample of document.samples) {
        assert.ok(sample.filename === 'client.mts' || commands.has(sample.filename),
            `Missing documentation command for ${sample.filename}`);
    }
    return commands;
}

module.exports = { inspectDocument, installationCommand, sampleCommands };
