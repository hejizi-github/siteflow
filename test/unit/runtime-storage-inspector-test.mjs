import test from 'node:test';
import assert from 'node:assert/strict';

import { createSavedState, getRestorablePageUrls } from '../../dist/runtime/storage-inspector.js';

function makePage(overrides = {}) {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    selected: false,
    ...overrides,
  };
}

function makeCookie(overrides = {}) {
  return {
    name: 'sid',
    value: 'abc123',
    domain: '.example.com',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createSavedState
// ---------------------------------------------------------------------------

test('createSavedState with includeCookies=false returns state without cookies field', () => {
  const pages = [makePage()];
  const state = createSavedState(pages, false, []);

  assert.equal(state.version, 1);
  assert.ok(typeof state.savedAt === 'string');
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].url, 'https://example.com');
  assert.equal(state.pages[0].selected, false);
  assert.equal(state.includeCookies, false);
  assert.equal(Object.hasOwn(state, 'cookies'), false);
});

test('createSavedState with includeCookies=true includes cookies', () => {
  const pages = [makePage()];
  const cookies = [makeCookie()];
  const state = createSavedState(pages, true, cookies);

  assert.equal(state.includeCookies, true);
  assert.equal(state.cookies.length, 1);
  assert.equal(state.cookies[0].name, 'sid');
  assert.equal(state.cookies[0].value, 'abc123');
});

test('createSavedState filters about:blank pages', () => {
  const pages = [
    makePage({ id: 1, url: 'about:blank' }),
    makePage({ id: 2, url: 'https://example.com' }),
    makePage({ id: 3, url: 'about:blank' }),
  ];
  const state = createSavedState(pages, false, []);

  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].url, 'https://example.com');
});

test('createSavedState also filters pages without url', () => {
  const pages = [
    makePage({ id: 1, url: '' }),
    makePage({ id: 2, url: 'https://example.com' }),
  ];
  const state = createSavedState(pages, false, []);

  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].url, 'https://example.com');
});

test('createSavedState preserves selected flag', () => {
  const pages = [
    makePage({ url: 'https://a.com', selected: true }),
    makePage({ url: 'https://b.com', selected: false }),
  ];
  const state = createSavedState(pages, false, []);

  assert.equal(state.pages.length, 2);
  assert.equal(state.pages[0].selected, true);
  assert.equal(state.pages[1].selected, false);
});

test('createSavedState includes cookies even when array is empty', () => {
  const state = createSavedState([makePage()], true, []);

  assert.equal(state.includeCookies, true);
  assert.ok(Array.isArray(state.cookies));
  assert.equal(state.cookies.length, 0);
});

// ---------------------------------------------------------------------------
// getRestorablePageUrls
// ---------------------------------------------------------------------------

test('getRestorablePageUrls returns URLs for all pages', () => {
  const state = createSavedState(
    [
      makePage({ url: 'https://a.com' }),
      makePage({ url: 'https://b.com' }),
    ],
    false,
    [],
  );
  const urls = getRestorablePageUrls(state);

  assert.deepEqual(urls, ['https://a.com', 'https://b.com']);
});

test('getRestorablePageUrls throws on version !== 1', () => {
  assert.throws(
    () => getRestorablePageUrls({ version: 2, savedAt: '', pages: [], includeCookies: false }),
    { name: 'SiteflowError', code: 'BAD_STATE' },
  );
});

test('getRestorablePageUrls throws when pages is not an array', () => {
  assert.throws(
    () => getRestorablePageUrls({ version: 1, savedAt: '', pages: null, includeCookies: false }),
    { name: 'SiteflowError', code: 'BAD_STATE' },
  );
  assert.throws(
    () => getRestorablePageUrls({ version: 1, savedAt: '', pages: { 0: 'https://x.com' }, includeCookies: false }),
    { name: 'SiteflowError', code: 'BAD_STATE' },
  );
});

test('getRestorablePageUrls skips pages without url field', () => {
  const urls = getRestorablePageUrls({
    version: 1,
    savedAt: '',
    pages: [
      { url: 'https://a.com', selected: true },
      { selected: false },
      { url: 'https://b.com', selected: false },
      { url: '', selected: false },
    ],
    includeCookies: false,
  });

  assert.deepEqual(urls, ['https://a.com', 'https://b.com']);
});

test('getRestorablePageUrls returns empty array when no pages have urls', () => {
  const urls = getRestorablePageUrls({
    version: 1,
    savedAt: '',
    pages: [
      { selected: true },
      { url: '', selected: false },
    ],
    includeCookies: false,
  });

  assert.deepEqual(urls, []);
});
