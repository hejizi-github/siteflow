import type { CookieImportResult, CookieRecord, RedactedCookie } from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';

export function cookieMatchesDomain(cookieDomain: string, requestedDomain?: string): boolean {
  if (!requestedDomain) return true;
  const normalized = cookieDomain.replace(/^\./, '');
  const requested = requestedDomain.replace(/^\./, '');
  return normalized === requested || normalized.endsWith(`.${requested}`);
}

export function redactCookies(cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }>, domain?: string): RedactedCookie[] {
  return cookies
    .filter(cookie => cookieMatchesDomain(cookie.domain, domain))
    .map(cookie => ({
      name: cookie.name,
      value: `[REDACTED:${cookie.value.length}]`,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
}

export function exportCookieRecords(cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }>, domain?: string): CookieRecord[] {
  return cookies
    .filter(cookie => cookieMatchesDomain(cookie.domain, domain))
    .map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as CookieRecord['sameSite'],
    }));
}

export function prepareCookieImport(cookies: CookieRecord[], domain: string | undefined, apply: boolean): {
  filtered: CookieRecord[];
  result: CookieImportResult;
} {
  if (!Array.isArray(cookies)) throw new SiteflowError('BAD_COOKIE_FILE', 'Cookie file must contain a cookie array');
  const filtered = cookies
    .filter(cookie => cookie?.name && cookie?.value && cookie?.domain && cookie?.path)
    .filter(cookie => cookieMatchesDomain(cookie.domain, domain));
  const domains = [...new Set(filtered.map(cookie => cookie.domain))].sort();
  return {
    filtered,
    result: apply
      ? {
          imported: true,
          count: filtered.length,
          domains,
          source: 'file',
          note: 'Cookies imported into the active browser context.',
        }
      : {
          imported: false,
          count: filtered.length,
          domains,
          source: 'file',
          note: 'Preview only. Re-run with --apply to import cookies into the active profile.',
        },
  };
}
