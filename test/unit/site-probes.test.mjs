import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attr,
  createExtractListExpression,
  extractList,
  href,
  text,
} from '../../dist/sites/probes/selector-runtime.js';

test('createExtractListExpression includes selectors, attributes, and bounded limit', async () => {
  const expression = createExtractListExpression({
    root: '.result',
    limit: 3,
    fields: {
      title: text('.title', { max: 80 }),
      link: href('a.title'),
      source: attr('.meta', 'data-source'),
    },
  });

  assert.equal(expression.includes(JSON.stringify('.result')), true);
  assert.equal(expression.includes(JSON.stringify('.title')), true);
  assert.equal(expression.includes(JSON.stringify('a.title')), true);
  assert.equal(expression.includes(JSON.stringify('data-source')), true);
  assert.equal(expression.includes('Math.min(3,'), true);
});

test('extractList unwraps evaluated rows and returns small evidence', async () => {
  const calls = [];
  const rows = [
    { title: 'First', link: 'https://example.com/1' },
    { title: 'Second', link: 'https://example.com/2' },
  ];
  const result = await extractList({
    profile: 'default',
    pageId: 7,
    evaluate: async (profile, expression, pageId) => {
      calls.push({ profile, expression, pageId });
      return { value: { rows, count: rows.length } };
    },
  }, {
    root: '.result',
    limit: 5,
    fields: {
      title: text('.title'),
      link: href('a'),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, 'default');
  assert.equal(calls[0].pageId, 7);
  assert.deepEqual(result, {
    rows,
    evidence: {
      count: 2,
      limit: 5,
      root: '.result',
    },
  });
  assert.equal(JSON.stringify(result.evidence).includes('First'), false);
});

test('createExtractListExpression applies limit after required filtering', () => {
  const expression = createExtractListExpression({
    root: '.result',
    limit: 2,
    required: ['title'],
    fields: {
      title: text('.title'),
    },
  });
  const document = fakeDocument([
    {},
    { '.title': fakeNode('First') },
    { '.title': fakeNode('Second') },
  ]);

  const result = Function('document', `return ${expression}`)(document);

  assert.deepEqual(result.rows.map(row => ({ ...row })), [{ title: 'First' }, { title: 'Second' }]);
  assert.equal(result.count, 2);
  assert.equal(expression.includes('.slice(0, limit)'), false);
});

test('createExtractListExpression returns no rows for zero limit', () => {
  const expression = createExtractListExpression({
    root: '.result',
    limit: 0,
    fields: {
      title: text('.title'),
    },
  });
  const document = fakeDocument([
    { '.title': fakeNode('First') },
  ]);

  const result = Function('document', `return ${expression}`)(document);

  assert.deepEqual(result, { rows: [], count: 0 });
});

test('createExtractListExpression requires own fields only', () => {
  const expression = createExtractListExpression({
    root: '.result',
    limit: 2,
    required: ['toString'],
    fields: {
      title: text('.title'),
    },
  });
  const document = fakeDocument([
    { '.title': fakeNode('First') },
  ]);

  const result = Function('document', `return ${expression}`)(document);

  assert.deepEqual(result, { rows: [], count: 0 });
});

function fakeDocument(roots) {
  return {
    querySelectorAll(selector) {
      return selector === '.result' ? roots.map(fakeRoot) : [];
    },
  };
}

function fakeRoot(fields) {
  return {
    querySelector(selector) {
      return fields[selector] ?? null;
    },
  };
}

function fakeNode(textContent, attributes = {}) {
  return {
    textContent,
    href: attributes.href,
    getAttribute(attribute) {
      return attributes[attribute] ?? '';
    },
  };
}
