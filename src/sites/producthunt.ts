import type { Command } from 'commander';
import { runSiteCommand, evaluateSiteExpression, listSiteNetwork, openSitePage, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'producthunt';
const ORIGIN = 'https://www.producthunt.com';

interface OpenOptions {
  route?: string;
}

function routeUrl(route?: string): string {
  const value = (route || '/').trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `${ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

async function collectPage(ctx: SiteCommandContext, route?: string): Promise<{
  url: string;
  title: string;
  text: string;
  blocked: boolean;
  blockSignals: string[];
  links: Array<{ text: string; url: string }>;
  products: Array<{ text: string; url: string }>;
}> {
  await openSitePage(ctx.profile, routeUrl(route));
  await sleep(2500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const text = document.body.innerText || '';
    const title = document.title;
    const blockSignals = [];
    if (/just a moment|请稍候|請稍候/i.test(title)) blockSignals.push('challenge_title');
    if (/Cloudflare|Turnstile|正在进行安全验证|Verifying you are human/i.test(text)) blockSignals.push('challenge_text');
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map(a => ({
      text: clean(a.textContent).slice(0, 120),
      url: abs(a.getAttribute('href') || '')
    })).filter(link => link.text || link.url);
    const products = links.filter(link => /\\/products?\\//.test(link.url) || /\\/posts?\\//.test(link.url)).slice(0, 30);
    return {
      url: location.href,
      title,
      text: text.slice(0, 1800),
      blocked: blockSignals.length > 0,
      blockSignals,
      links,
      products
    };
  })()`);
  const value = result.value as {
    url: string;
    title: string;
    text: string;
    blocked: boolean;
    blockSignals: string[];
    links: Array<{ text: string; url: string }>;
    products: Array<{ text: string; url: string }>;
  };
  const network = await listSiteNetwork(ctx.profile, 120).catch(() => []);
  const challengeNetwork = network
    .filter(entry => {
      const headers = entry.responseHeaders || {};
      return headers['cf-mitigated'] === 'challenge' || /\/cdn-cgi\/challenge-platform|turnstile/i.test(entry.url);
    })
    .map(entry => ({ id: entry.id, status: entry.status, resourceType: entry.resourceType, url: entry.url.replace(/\?.*$/, '?<redacted>') }))
    .slice(0, 20);
  if (challengeNetwork.length) {
    value.blocked = true;
    value.blockSignals = Array.from(new Set([...value.blockSignals, 'challenge_network']));
  }
  return {
    ...value,
    links: value.links.slice(0, 40),
    products: value.products,
    blockSignals: value.blockSignals,
  };
}

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  const data = await collectPage(ctx, '/');
  const state = data.blocked ? 'blocked_by_challenge' : 'status_collected';
  return {
    site: SITE,
    command: 'status',
    ok: !data.blocked,
    state,
    page: { url: data.url, title: data.title },
    observations: {
      blocked: data.blocked,
      blockSignals: data.blockSignals,
      productLinkCount: data.products.length,
      products: data.products,
      links: data.links,
      textExcerpt: data.blocked ? data.text : data.text.slice(0, 800),
      sideEffects: [],
    },
    errors: data.blocked ? [{ code: 'CHALLENGE_DETECTED', message: 'Product Hunt returned a Cloudflare/Turnstile challenge. Do not bypass it from automation.' }] : [],
    next: data.blocked
      ? ['Use a manually validated browser profile for read-only DOM exploration, or prefer a public feed/API with proper authorization.']
      : ['Use siteflow producthunt open <route-or-url> to inspect a public route.'],
  };
}

async function runOpen(ctx: SiteCommandContext, options: OpenOptions): Promise<SiteReceipt> {
  const data = await collectPage(ctx, options.route || '/');
  return {
    site: SITE,
    command: 'open',
    ok: !data.blocked,
    state: data.blocked ? 'blocked_by_challenge' : 'page_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requestedRoute: options.route || '/',
      blocked: data.blocked,
      blockSignals: data.blockSignals,
      productLinkCount: data.products.length,
      products: data.products,
      links: data.links,
      textExcerpt: data.blocked ? data.text : data.text.slice(0, 1200),
      sideEffects: [],
    },
    errors: data.blocked ? [{ code: 'CHALLENGE_DETECTED', message: 'Product Hunt returned a Cloudflare/Turnstile challenge. No bypass was attempted.' }] : [],
    next: data.blocked ? ['Stop automated retries and use manual browser validation if this page is required.'] : [],
  };
}

export const producthuntAdapter: SiteAdapter = {
  id: SITE,
  title: 'Product Hunt',
  description: 'Read-only Product Hunt public page probe with Cloudflare/Turnstile challenge detection.',
  commands: [
    {
      name: 'status',
      description: 'Open Product Hunt and report whether public automation is blocked',
      configure(command: Command): void {
        command.action(async function () {
          await runSiteCommand(this, ctx => runStatus(ctx));
        });
      },
    },
    {
      name: 'open',
      description: 'Open a Product Hunt route or URL and collect visible public links when not challenged',
      configure(command: Command): void {
        command
          .argument('[route-or-url]', 'Product Hunt route or URL', '/')
          .action(async function (route: string) {
            await runSiteCommand(this, ctx => runOpen(ctx, { route }));
          });
      },
    },
  ],
};
