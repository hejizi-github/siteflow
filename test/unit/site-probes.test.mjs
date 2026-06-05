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
  youtubeChannelSummary,
  youtubeComments,
  youtubeScrollToComments,
  youtubeVideoDetails,
  youtubeSearchResults,
  youtubeTranscriptDiscovery,
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
    fakeNode('Root Video', { href: 'https://www.youtube.com/watch?v=abc123XYZ_1' }, 'a#video-title'),
  ]);

  const result = Function('document', `return ${expression}`)(document);

  assert.deepEqual(result.rows.map(row => ({ ...row })), [
    { title: 'Root Video', href: 'https://www.youtube.com/watch?v=abc123XYZ_1' },
  ]);
});

test('youtubeSearchResults maps rows to deduped videos with ids', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { title: 'First', href: 'https://www.youtube.com/watch?v=abc123XYZ_1&feature=share', channel: 'Chan A', metadata: '1K views', text: 'First video visible row text' },
        { title: 'Duplicate', href: '/watch?v=abc123XYZ_1', channel: 'Chan A', metadata: '1K views', text: 'Duplicate visible row text' },
        { title: 'Second', href: 'https://youtu.be/def456XYZ_2', channel: 'Chan B', metadata: '2K views', text: 'Second video visible row text' },
        { title: 'No id', href: 'https://www.youtube.com/results?search_query=x', channel: 'Chan C', metadata: '3K views', text: 'No id visible row text' },
      ],
      count: 4,
    } }),
  }, { limit: 5 });

  assert.deepEqual(result.videos, [
    { id: 'abc123XYZ_1', title: 'First', href: 'https://www.youtube.com/watch?v=abc123XYZ_1&feature=share', channel: 'Chan A', metadata: '1K views', text: 'First video visible row text' },
    { id: 'def456XYZ_2', title: 'Second', href: 'https://youtu.be/def456XYZ_2', channel: 'Chan B', metadata: '2K views', text: 'Second video visible row text' },
  ]);
  assert.deepEqual(result.evidence, {
    count: 4,
    limit: 15,
    requestedLimit: 5,
    root: 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title',
  });
  assert.equal(JSON.stringify(result.evidence).includes('First'), false);
});

test('youtubeSearchResults rejects non-youtube and unsafe video hrefs', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { title: 'Good watch', href: 'https://www.youtube.com/watch?v=abc123XYZ_1', channel: '', metadata: '' },
        { title: 'Good short', href: 'https://youtu.be/def456XYZ_2', channel: '', metadata: '' },
        { title: 'Bad host', href: 'https://evil.example/watch?v=bad123XYZ_3', channel: '', metadata: '' },
        { title: 'Bad scheme', href: 'javascript:alert(1)?v=scriptXYZ_4', channel: '', metadata: '' },
      ],
      count: 4,
    } }),
  }, { limit: 5 });

  assert.deepEqual(result.videos.map(video => video.id), ['abc123XYZ_1', 'def456XYZ_2']);
});

test('youtubeSearchResults rejects short and long video ids', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async () => ({ value: {
      rows: [
        { title: 'Short', href: 'https://www.youtube.com/watch?v=short1', channel: '', metadata: '' },
        { title: 'Long', href: 'https://youtu.be/tooLongVideoId', channel: '', metadata: '' },
        { title: 'Good', href: 'https://www.youtube.com/watch?v=abc123XYZ_1', channel: '', metadata: '' },
      ],
      count: 3,
    } }),
  }, { limit: 5 });

  assert.deepEqual(result.videos.map(video => video.id), ['abc123XYZ_1']);
});

test('youtubeSearchResults preserves requested unique limit after dedupe', async () => {
  const expressions = [];
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async (_profile, expression) => {
      expressions.push(expression);
      return { value: {
        rows: [
          { title: 'One container', href: 'https://www.youtube.com/watch?v=abc123XYZ_1', channel: '', metadata: '' },
          { title: 'One anchor', href: 'https://www.youtube.com/watch?v=abc123XYZ_1', channel: '', metadata: '' },
          { title: 'Two container', href: 'https://www.youtube.com/watch?v=def456XYZ_2', channel: '', metadata: '' },
          { title: 'Two anchor', href: 'https://www.youtube.com/watch?v=def456XYZ_2', channel: '', metadata: '' },
          { title: 'Three', href: 'https://www.youtube.com/watch?v=ghi789XYZ_3', channel: '', metadata: '' },
        ],
        count: 5,
      } };
    },
  }, { limit: 3 });

  assert.deepEqual(result.videos.map(video => video.id), ['abc123XYZ_1', 'def456XYZ_2', 'ghi789XYZ_3']);
  assert.equal(result.videos.length, 3);
  assert.equal(expressions[0].includes('Math.min(9,'), true);
  assert.equal(result.evidence.requestedLimit, 3);
  assert.equal(JSON.stringify(result.evidence).includes('One container'), false);
});

test('youtubeSearchResults preserves requested limit of one hundred unique videos', async () => {
  const expressions = [];
  const rows = Array.from({ length: 100 }, (_, index) => {
    const id = videoId(index);
    return [
      { title: `Container ${index}`, href: `https://www.youtube.com/watch?v=${id}`, channel: '', metadata: '' },
      { title: `Anchor ${index}`, href: `https://www.youtube.com/watch?v=${id}`, channel: '', metadata: '' },
    ];
  }).flat();
  const result = await youtubeSearchResults({
    profile: 'default',
    evaluate: async (_profile, expression) => {
      expressions.push(expression);
      return { value: { rows, count: rows.length } };
    },
  }, { limit: 100 });

  assert.equal(result.videos.length, 100);
  assert.equal(result.videos[0].id, videoId(0));
  assert.equal(result.videos[99].id, videoId(99));
  assert.equal(new Set(result.videos.map(video => video.id)).size, 100);
  assert.equal(expressions[0].includes('Math.min(300,'), true);
  assert.equal(result.evidence.requestedLimit, 100);
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

test('youtubeVideoDetails evaluates watch page metadata with small evidence', async () => {
  const calls = [];
  const details = {
    url: 'https://www.youtube.com/watch?v=abc123XYZ_1',
    title: 'Watch title',
    video: {
      id: 'abc123XYZ_1',
      title: 'Proof video',
      channel: 'Proof channel',
      description: 'Proof description',
      lengthSeconds: '120',
      viewCount: '42',
      publishDate: '2026-06-01',
      category: 'Education',
    },
    text: 'Visible watch page text',
  };
  const result = await youtubeVideoDetails({
    profile: 'default',
    pageId: 8,
    evaluate: async (profile, expression, pageId) => {
      calls.push({ profile, expression, pageId });
      return { value: details };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, 'default');
  assert.equal(calls[0].pageId, 8);
  assert.equal(calls[0].expression.includes('ytInitialPlayerResponse'), true);
  assert.deepEqual(result.details, details);
  assert.deepEqual(result.evidence, {
    pageId: 8,
    hasVideoId: true,
  });
  assert.equal(JSON.stringify(result.evidence).includes('Proof video'), false);
  assert.equal(JSON.stringify(result.evidence).includes('Visible watch page text'), false);
});

test('youtubeVideoDetails normalizes malformed page payloads', async () => {
  const result = await youtubeVideoDetails({
    profile: 'default',
    evaluate: async () => ({ value: { title: 42, video: undefined } }),
  });

  assert.deepEqual(result.details, {
    url: '',
    title: '',
    video: {
      id: undefined,
      title: undefined,
      channel: undefined,
      description: undefined,
      lengthSeconds: undefined,
      viewCount: undefined,
      publishDate: undefined,
      category: undefined,
    },
    text: '',
  });
  assert.deepEqual(result.evidence, {
    pageId: undefined,
    hasVideoId: false,
  });
});

test('youtubeChannelSummary evaluates channel page summary with small evidence', async () => {
  const summary = {
    url: 'https://www.youtube.com/@proof',
    title: 'Proof channel',
    heading: 'Proof',
    text: 'Visible channel page text',
  };
  const result = await youtubeChannelSummary({
    profile: 'default',
    pageId: 10,
    evaluate: async (profile, expression, pageId) => {
      assert.equal(profile, 'default');
      assert.equal(pageId, 10);
      assert.equal(expression.includes('yt-page-header-renderer'), true);
      return { value: summary };
    },
  });

  assert.deepEqual(result.summary, summary);
  assert.deepEqual(result.evidence, {
    pageId: 10,
    hasHeading: true,
  });
  assert.equal(JSON.stringify(result.evidence).includes('Proof'), false);
  assert.equal(JSON.stringify(result.evidence).includes('Visible channel page text'), false);
});

test('youtubeChannelSummary normalizes malformed page payloads', async () => {
  const result = await youtubeChannelSummary({
    profile: 'default',
    evaluate: async () => ({ value: { heading: 42 } }),
  });

  assert.deepEqual(result.summary, {
    url: '',
    title: '',
    heading: '',
    text: '',
  });
  assert.deepEqual(result.evidence, {
    pageId: undefined,
    hasHeading: false,
  });
});

test('youtubeTranscriptDiscovery evaluates caption tracks with small evidence', async () => {
  const discovery = {
    url: 'https://www.youtube.com/watch?v=abc123XYZ_1',
    title: 'Watch',
    tracks: [
      { name: 'English', languageCode: 'en', baseUrl: 'https://caption.example/en' },
      { name: '中文', languageCode: 'zh', baseUrl: 'https://caption.example/zh' },
    ],
    transcriptUnavailableHint: false,
  };
  const result = await youtubeTranscriptDiscovery({
    profile: 'default',
    pageId: 11,
    evaluate: async (profile, expression, pageId) => {
      assert.equal(profile, 'default');
      assert.equal(pageId, 11);
      assert.equal(expression.includes('captionTracks'), true);
      return { value: discovery };
    },
  });

  assert.deepEqual(result.discovery, discovery);
  assert.deepEqual(result.evidence, {
    pageId: 11,
    trackCount: 2,
    transcriptUnavailableHint: false,
  });
  assert.equal(JSON.stringify(result.evidence).includes('caption.example'), false);
  assert.equal(JSON.stringify(result.evidence).includes('English'), false);
});

test('youtubeTranscriptDiscovery normalizes malformed page payloads', async () => {
  const result = await youtubeTranscriptDiscovery({
    profile: 'default',
    evaluate: async () => ({ value: { tracks: [{ name: 12 }, null], transcriptUnavailableHint: 'yes' } }),
  });

  assert.deepEqual(result.discovery, {
    url: '',
    title: '',
    tracks: [{ name: undefined, languageCode: undefined, baseUrl: undefined }],
    transcriptUnavailableHint: false,
  });
  assert.deepEqual(result.evidence, {
    pageId: undefined,
    trackCount: 1,
    transcriptUnavailableHint: false,
  });
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

function videoId(index) {
  return `vid${String(index).padStart(8, '0')}`;
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
