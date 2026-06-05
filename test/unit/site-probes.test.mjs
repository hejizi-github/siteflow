import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attr,
  createExtractListExpression,
  extractList,
  href,
  text,
} from '../../dist/sites/probes/selector-runtime.js';
import {
  youtubeComments,
  youtubeScrollToComments,
  youtubeSearchResults,
} from '../../dist/sites/probes/youtube.js';

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

test('extractList unwraps nested evaluation envelopes', async () => {
  const rows = [
    { title: 'Nested' },
  ];
  const result = await extractList({
    profile: 'default',
    evaluate: async () => ({
      ok: true,
      data: {
        value: {
          rows,
          count: rows.length,
        },
      },
    }),
  }, {
    root: '.result',
    limit: 3,
    fields: {
      title: text('.title'),
    },
  });

  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.evidence, {
    count: 1,
    limit: 3,
    root: '.result',
  });
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

test('createExtractListExpression can read fields from the root itself', () => {
  const expression = createExtractListExpression({
    root: 'a#video-title',
    limit: 1,
    required: ['href'],
    fields: {
      title: text('a#video-title'),
      href: href('a#video-title'),
    },
  });
  const document = fakeDocument([
    fakeNode('Root Video', { href: 'https://www.youtube.com/watch?v=abc123' }, 'a#video-title'),
  ]);

  const result = Function('document', `return ${expression}`)(document);

  assert.deepEqual(result.rows.map(row => ({ ...row })), [
    { title: 'Root Video', href: 'https://www.youtube.com/watch?v=abc123' },
  ]);
});

test('youtubeSearchResults maps rows to deduped videos with ids', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { title: 'First', href: 'https://www.youtube.com/watch?v=abc123&feature=share', channel: 'Chan A', metadata: '1K views' },
        { title: 'Duplicate', href: '/watch?v=abc123', channel: 'Chan A', metadata: '1K views' },
        { title: 'Second', href: 'https://youtu.be/def456', channel: 'Chan B', metadata: '2K views' },
        { title: 'No id', href: 'https://www.youtube.com/results?search_query=x', channel: 'Chan C', metadata: '3K views' },
      ],
      count: 4,
    } }),
  }, { limit: 5 });

  assert.deepEqual(result.videos, [
    { id: 'abc123', title: 'First', href: 'https://www.youtube.com/watch?v=abc123&feature=share', channel: 'Chan A', metadata: '1K views' },
    { id: 'def456', title: 'Second', href: 'https://youtu.be/def456', channel: 'Chan B', metadata: '2K views' },
  ]);
  assert.deepEqual(result.evidence, {
    count: 4,
    limit: 5,
    root: 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title',
  });
  assert.equal(JSON.stringify(result.evidence).includes('First'), false);
});

test('youtubeSearchResults rejects non-youtube and unsafe video hrefs', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { title: 'Good watch', href: 'https://www.youtube.com/watch?v=abc123', channel: '', metadata: '' },
        { title: 'Good short', href: 'https://youtu.be/def456', channel: '', metadata: '' },
        { title: 'Bad host', href: 'https://evil.example/watch?v=bad123', channel: '', metadata: '' },
        { title: 'Bad scheme', href: 'javascript:alert(1)?v=script123', channel: '', metadata: '' },
      ],
      count: 4,
    } }),
  }, { limit: 5 });

  assert.deepEqual(result.videos.map(video => video.id), ['abc123', 'def456']);
});

test('youtubeComments returns visible comments and small evidence', async () => {
  const result = await youtubeComments({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { author: 'A', text: 'Useful comment', likes: '12', time: '1 day ago' },
        { author: 'B', text: 'Another comment', likes: '', time: '2 days ago' },
      ],
      count: 2,
    } }),
  }, { limit: 2 });

  assert.deepEqual(result.comments, [
    { author: 'A', text: 'Useful comment', likes: '12', time: '1 day ago' },
    { author: 'B', text: 'Another comment', likes: '', time: '2 days ago' },
  ]);
  assert.deepEqual(result.evidence, {
    count: 2,
    limit: 2,
    root: 'ytd-comment-thread-renderer',
  });
  assert.equal(JSON.stringify(result.evidence).includes('Useful comment'), false);
});

test('youtubeScrollToComments runs page scroll probe with small evidence', async () => {
  const calls = [];
  const result = await youtubeScrollToComments({
    profile: 'default',
    pageId: 9,
    evaluate: async (profile, expression, pageId) => {
      calls.push({ profile, expression, pageId });
      return { value: { y: 1200, height: 2400 } };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, 'default');
  assert.equal(calls[0].pageId, 9);
  assert.equal(calls[0].expression.includes('scrollTo'), true);
  assert.deepEqual(result, {
    y: 1200,
    height: 2400,
    pageId: 9,
    scrolled: true,
  });
});

function fakeDocument(roots) {
  return {
    querySelectorAll(selector) {
      return selector === '.result' || selector === 'a#video-title' ? roots.map(fakeRoot) : [];
    },
  };
}

function fakeRoot(fields) {
  if (typeof fields.matches === 'function') return fields;
  return {
    querySelector(selector) {
      return fields[selector] ?? null;
    },
  };
}

function fakeNode(textContent, attributes = {}, selector) {
  return {
    textContent,
    href: attributes.href,
    matches(candidate) {
      return selector === candidate;
    },
    querySelector(candidate) {
      return selector === candidate ? this : null;
    },
    getAttribute(attribute) {
      return attributes[attribute] ?? '';
    },
  };
}
