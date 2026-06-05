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
