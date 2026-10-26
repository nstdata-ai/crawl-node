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
    marked.walkTokens(tokens, token => {
        if (token.type === 'code') {
            const language = (token.lang ?? '').toLowerCase();
            const executable = /^(?:javascript|js|mjs|cjs|jsx|typescript|ts|mts|cts|tsx)(?:\s|$)/.test(language);
            if (executable) {
                assert.ok(['typescript', 'ts'].includes(language), `Unsupported executable fence language in ${filename}`);
                executableBlocks++;
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
        previous = token;
    }
    assert.equal(samples.length, executableBlocks, `Nested executable fences are not supported in ${filename}`);
    const renderer = new marked.Renderer();
    renderer.heading = token => `<h${token.depth} id="${headingIds.get(token)}">${marked.Parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    return { html: marked.parser(tokens, { renderer }), samples, links, headings };
}

module.exports = { inspectDocument };
