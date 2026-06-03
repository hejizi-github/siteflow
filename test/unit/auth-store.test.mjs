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
