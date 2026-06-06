import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cookieMatchesDomain,
  exportCookieRecords,
  prepareCookieImport,
  redactCookies,
} from '../../dist/runtime/auth-store.js';

test('cookieMatchesDomain handles exact and subdomain matches', () => {
  assert.equal(cookieMatchesDomain('.x.com', 'x.com'), true);
  assert.equal(cookieMatchesDomain('api.x.com', 'x.com'), true);
  assert.equal(cookieMatchesDomain('x.com', 'api.x.com'), false);
  assert.equal(cookieMatchesDomain('example.com', undefined), true);
});

test('redactCookies preserves shape while hiding values', () => {
  const redacted = redactCookies([
    {
      name: 'auth_token',
      value: 'secret-value',
      domain: '.x.com',
      path: '/',
      expires: 123,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ], 'x.com');

  assert.deepEqual(redacted, [
    {
      name: 'auth_token',
      value: '[REDACTED:12]',
      domain: '.x.com',
      path: '/',
      expires: 123,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
});

test('exportCookieRecords keeps raw cookie values for matching domains', () => {
  const exported = exportCookieRecords([
    {
      name: 'session',
      value: 'abc',
      domain: '.x.com',
      path: '/',
      expires: 1,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
    {
      name: 'other',
      value: 'def',
      domain: '.example.com',
      path: '/',
    },
  ], 'x.com');

  assert.deepEqual(exported, [
    {
      name: 'session',
      value: 'abc',
      domain: '.x.com',
      path: '/',
      expires: 1,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
});

test('prepareCookieImport previews and filters invalid cookies', () => {
  const preview = prepareCookieImport([
    { name: 'session', value: 'abc', domain: '.x.com', path: '/' },
    { name: '', value: 'bad', domain: '.x.com', path: '/' },
  ], 'x.com', false);

  assert.equal(preview.filtered.length, 1);
  assert.deepEqual(preview.result, {
    imported: false,
    count: 1,
    domains: ['.x.com'],
    source: 'file',
    note: 'Preview only. Re-run with --apply to import cookies into the active profile.',
  });
});

test('prepareCookieImport filters out cookies missing required fields', () => {
  const result = prepareCookieImport([
    { name: 'ok', value: 'v', domain: '.x.com', path: '/' },
    { name: '', value: 'v', domain: '.x.com', path: '/' },
    { name: 'n', value: '', domain: '.x.com', path: '/' },
    { name: 'n', value: 'v', domain: '', path: '/' },
    { name: 'n', value: 'v', domain: '.x.com', path: '' },
  ], 'x.com', false);

  assert.equal(result.filtered.length, 1);
  assert.deepEqual(result.filtered[0], { name: 'ok', value: 'v', domain: '.x.com', path: '/' });
});

test('prepareCookieImport handles empty cookie arrays', () => {
  const result = prepareCookieImport([], 'x.com', false);

  assert.equal(result.filtered.length, 0);
  assert.deepEqual(result.result, {
    imported: false,
    count: 0,
    domains: [],
    source: 'file',
    note: 'Preview only. Re-run with --apply to import cookies into the active profile.',
  });
});

test('prepareCookieImport with apply=true creates imported receipt', () => {
  const result = prepareCookieImport([
    { name: 'session', value: 'abc', domain: '.x.com', path: '/' },
  ], 'x.com', true);

  assert.equal(result.filtered.length, 1);
  assert.deepEqual(result.result, {
    imported: true,
    count: 1,
    domains: ['.x.com'],
    source: 'file',
    note: 'Cookies imported into the active browser context.',
  });
});

test('prepareCookieImport throws on non-array input', () => {
  assert.throws(
    () => prepareCookieImport('not-an-array', 'x.com', false),
    (err) => {
      assert.equal(err.code, 'BAD_COOKIE_FILE');
      assert.equal(err.message, 'Cookie file must contain a cookie array');
      return true;
    },
  );

  assert.throws(
    () => prepareCookieImport(null, 'x.com', false),
    (err) => {
      assert.equal(err.code, 'BAD_COOKIE_FILE');
      return true;
    },
  );

  assert.throws(
    () => prepareCookieImport(undefined, 'x.com', false),
    (err) => {
      assert.equal(err.code, 'BAD_COOKIE_FILE');
      return true;
    },
  );
});
