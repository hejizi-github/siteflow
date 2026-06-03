import type { Command } from 'commander';
import { readSiteSnapshot, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';
import { evaluateSiteExpression, readSiteNetworkPart, listSiteNetwork, openSitePage } from './capabilities.js';

interface AlibabaSeoOptions {
  keyword: string;
  title?: string;
  limit?: string;
}

interface AlibabaSearchOptions {
  keyword: string;
  limit?: string;
}

interface AlibabaHomeOptions {
  limit?: string;
}

interface AlibabaSuggestOptions {
  keyword: string;
}

interface AlibabaProductOptions {
  offer: string;
}

interface SearchItem {
  title: string;
  price?: string;
  sales?: string;
  supplier?: string;
  href?: string;
  tags: string[];
}

interface SearchPageData {
  url: string;
  title: string;
  query: string;
  suggestions: string[];
  filters: string[];
  items: SearchItem[];
}

interface HomePageData {
  url: string;
  title: string;
  categories: string[];
  filters: string[];
  sorts: string[];
  items: SearchItem[];
  textExcerpt: string;
}

interface SuggestPageData {
  url: string;
  title: string;
  query: string;
  suggestions: string[];
  relatedSuggestions: string[];
  filters: string[];
  source: 'autocomplete_api' | 'dom_related';
}

interface SeoSuggestion {
  title: string;
  length: number;
  reasons: string[];
}

interface ProductPageData {
  url: string;
  title: string;
  offerId?: string;
  productTitle?: string;
  company?: string;
  price?: string;
  sales?: string;
  serviceTags: string[];
  shopSignals: string[];
  skuLines: string[];
  attributes: Array<{ name: string; value: string }>;
  imageUrls: string[];
  textExcerpt: string;
}

const RISK_TERMS = [
  '最便宜',
  '第一',
  '全网最低',
  '保证',
  '绝对',
  '医用',
  '治疗',
  '消毒专用',
  '杀菌',
  '神器',
];

const STOP_WORDS = new Set([
  '厂家',
  '批发',
  '现货',
  '跨境',
  '外贸',
  '供应',
  '一件',
  '代发',
  '专用',
  '家用',
  '透明',
  '塑料',
  '找相似',
]);

function keywordUrl(keyword: string): string {
  return `https://s.1688.com/page/pccps.html?keywords=${encodeURIComponent(keyword)}&charset=utf8`;
}

function homeUrl(): string {
  return 'https://air.1688.com/kapp/channel-fe/cps-4c-pc/home';
}

function offerIdFrom(value: string): string | undefined {
  return value.match(/offerId=(\d+)/)?.[1] || value.match(/\/offer\/(\d+)\.html/)?.[1] || value.match(/^\d+$/)?.[0];
}

function productUrl(offer: string): string {
  const offerId = offerIdFrom(offer);
  if (!offerId) return offer;
  return `https://detail.1688.com/offer/${offerId}.html`;
}

function unique(values: string[], limit = 20): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function parseJsonp(body: string): unknown {
  const trimmed = body.trim();
  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  if (start < 0 || end <= start) return JSON.parse(trimmed);
  return JSON.parse(trimmed.slice(start + 1, end));
}

function normalizeSuggestWord(value: unknown): string {
  return String(value || '')
    .replace(/^_+/, '')
    .replace(/_/g, '')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const tokens = text
    .replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  const terms: string[] = [];
  for (const token of tokens) {
    if (/^[a-zA-Z0-9]+$/.test(token)) {
      terms.push(token.toLowerCase());
      continue;
    }
    if (token.length <= 2) {
      terms.push(token);
      continue;
    }
    for (let size = Math.min(6, token.length); size >= 2; size--) {
      for (let i = 0; i <= token.length - size; i++) terms.push(token.slice(i, i + size));
    }
  }
  return terms;
}

function topTerms(items: SearchItem[], keyword: string, limit = 18): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const term of tokenize(item.title)) {
      if (term === keyword || STOP_WORDS.has(term) || term.length < 2) continue;
      if (!/\p{Script=Han}/u.test(term)) continue;
      if (/^\d/.test(term) || /[¥.]/.test(term)) continue;
      counts.set(term, (counts.get(term) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, limit)
    .map(([term]) => term);
}

function titleScore(title: string, keyword: string, terms: string[]): { score: number; checks: Record<string, boolean>; risks: string[] } {
  const length = [...title].length;
  const containsKeyword = title.includes(keyword);
  const coveredTerms = terms.filter(term => title.includes(term));
  const risks = RISK_TERMS.filter(term => title.includes(term));
  const checks = {
    containsKeyword,
    lengthOk: length >= 24 && length <= 48,
    coversDemandWords: coveredTerms.length >= 3,
    notTooPunctuated: !/[【】!！]{2,}/.test(title),
    noObviousRiskTerms: risks.length === 0,
  };
  const score =
    (checks.containsKeyword ? 25 : 0) +
    (checks.lengthOk ? 25 : 0) +
    Math.min(25, coveredTerms.length * 5) +
    (checks.notTooPunctuated ? 10 : 0) +
    (checks.noObviousRiskTerms ? 15 : 0);
  return { score, checks, risks };
}

function buildSeoSuggestions(keyword: string, sourceTitle: string | undefined, terms: string[], suggestions: string[]): SeoSuggestion[] {
  const demandTerms = unique([...suggestions, ...terms], 10).filter(term => term !== keyword);
  const core = sourceTitle && sourceTitle.includes(keyword) ? sourceTitle : `${keyword}${sourceTitle ? ` ${sourceTitle}` : ''}`;
  const candidates = [
    unique([keyword, ...demandTerms.slice(0, 5)]).join(' '),
    unique([keyword, ...demandTerms.filter(term => /家用|浇花|清洁|细雾|喷雾|大容量|小瓶/.test(term)).slice(0, 6)]).join(' '),
    unique([keyword, ...demandTerms.filter(term => /透明|塑料|分装|喷雾瓶|化妆品|酒精/.test(term)).slice(0, 6)]).join(' '),
    core,
  ];
  return unique(candidates, 4).map(title => {
    const reasons = [];
    if (title.includes(keyword)) reasons.push('包含核心搜索词');
    const covered = demandTerms.filter(term => title.includes(term)).slice(0, 6);
    if (covered.length) reasons.push(`覆盖相关词：${covered.join('、')}`);
    const len = [...title].length;
    if (len < 24) reasons.push('偏短，可继续加入材质/规格/场景词');
    if (len > 48) reasons.push('偏长，建议去掉重复修饰词');
    return { title, length: len, reasons };
  });
}

async function collectSearchPage(ctx: SiteCommandContext, keyword: string, limit: number): Promise<SearchPageData> {
  await openSitePage(ctx.profile, keywordUrl(keyword));
  await sleep(3500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const isNoiseLine = line => (
      !line ||
      line === '找相似' ||
      line === '¥' ||
      /^\\d+(?:\\.\\d+)?$/.test(line) ||
      /^\\.\\d+$/.test(line) ||
      /^(全网)?\\d+(?:\\.\\d+)?万?\\+?件$/.test(line) ||
      /^(退货包运费|7×24H响应|48小时发货|7天无理由|先采后付|回头率\\d+%|验厂报告)$/.test(line)
    );
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const items = anchors
      .map(a => {
        const text = clean(a.innerText);
        const href = a.href;
        if (!/offerId=\\d+/.test(href) || text.length < 12 || !text.includes('¥')) return null;
        const lines = a.innerText.split('\\n').map(clean).filter(Boolean);
        const title = lines.find(line => line.length >= 8 && !isNoiseLine(line) && !/公司|工厂|商行|店$/.test(line)) || '';
        if (!title) return null;
        const priceMatch = text.match(/¥\\s*\\d+(?:\\s*\\.\\s*\\d+)?/);
        const price = priceMatch ? priceMatch[0].replace(/\\s+/g, '') : undefined;
        const sales = lines.find(line => /件|万\\+/.test(line) && !line.includes('退货') && !line.includes('发货'));
        const supplier = lines.slice().reverse().find(line => /公司|工厂|厂|商行|店/.test(line));
        const tags = lines.filter(line => /退货|发货|响应|无理由|先采后付|回头率|一件代发/.test(line));
        return { title, price, sales, supplier, href, tags };
      })
      .filter(Boolean);
    const bodyLines = document.body.innerText.split('\\n').map(clean).filter(Boolean);
    const filters = bodyLines.filter(line => /^(产地|材质|风格|应用场景|加工定制|综合|销量|价格|起订量|店铺商品数|所在地区|商家特色|经营模式|一件代发|48H发货|退货包运费|1688严选|跨境证书)$/.test(line));
    const suggestions = bodyLines.filter(line => line.includes(${JSON.stringify(keyword)}) && line.length <= 18 && line !== ${JSON.stringify(keyword)});
    const input = Array.from(document.querySelectorAll('input')).find(i => i.value);
    return {
      url: location.href,
      title: document.title,
      query: input ? input.value : ${JSON.stringify(keyword)},
      suggestions: Array.from(new Set(suggestions)).slice(0, 20),
      filters: Array.from(new Set(filters)).slice(0, 30),
      items: items.slice(0, ${JSON.stringify(limit)})
    };
  })()`);
  return result.value as SearchPageData;
}

async function collectHomePage(ctx: SiteCommandContext, limit: number): Promise<HomePageData> {
  await openSitePage(ctx.profile, homeUrl());
  await sleep(3500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\\n').map(clean).filter(Boolean);
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const items = anchors
      .map(a => {
        const text = clean(a.innerText);
        const href = a.href;
        if (!/(offerId=\\d+|\\/offer\\/\\d+\\.html|aliance\\.1688\\.com\\/activity\\.html)/.test(href)) return null;
        if (text.length < 10 || !text.includes('￥')) return null;
        const itemLines = a.innerText.split('\\n').map(clean).filter(Boolean);
        const title = itemLines.find(line => line.length >= 8 && !/^￥|^\\d|^月销|^回头率|^更多$/.test(line)) || '';
        if (!title) return null;
        const priceMatch = text.match(/￥\\s*\\d+(?:\\s*\\.\\s*\\d+)?/);
        const price = priceMatch ? priceMatch[0].replace(/\\s+/g, '') : undefined;
        const sales = itemLines.find(line => /月销|件|万\\+/.test(line));
        const supplier = itemLines.slice().reverse().find(line => /公司|工厂|厂|商行|店/.test(line));
        const tags = itemLines.filter(line => /退货|包邮|无理由|代发|深度认证|实力商家|月销|回头率/.test(line));
        return { title, price, sales, supplier, href, tags };
      })
      .filter(Boolean);
    const categoryStart = lines.indexOf('所属类目:');
    const sortStart = lines.indexOf('排序:');
    const categories = categoryStart >= 0
      ? lines.slice(categoryStart + 1, sortStart > categoryStart ? sortStart : categoryStart + 80)
          .filter(line => line.length <= 14 && !/筛选|排序|价格|确定|起批量/.test(line))
      : [];
    const filters = lines.filter(line => /^(实力商家|深度认证|进口货源|一件代发|托管货源|退货包运费|包邮)$/.test(line));
    const sorts = lines.filter(line => /^(综合排序|销量|月销量)$/.test(line));
    return {
      url: location.href,
      title: document.title,
      categories: Array.from(new Set(categories)).slice(0, 80),
      filters: Array.from(new Set(filters)).slice(0, 30),
      sorts: Array.from(new Set(sorts)).slice(0, 20),
      items: items.slice(0, ${JSON.stringify(limit)}),
      textExcerpt: bodyText.slice(0, 3000)
    };
  })()`);
  return result.value as HomePageData;
}

async function collectSuggestPage(ctx: SiteCommandContext, keyword: string): Promise<SuggestPageData> {
  await openSitePage(ctx.profile, keywordUrl(keyword));
  await sleep(3500);

  const pageResult = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const bodyLines = document.body.innerText.split('\\n').map(clean).filter(Boolean);
    const input = Array.from(document.querySelectorAll('input')).find(i => i.value);
    return {
      url: location.href,
      title: document.title,
      query: input ? input.value : ${JSON.stringify(keyword)},
      relatedSuggestions: Array.from(new Set(bodyLines.filter(line => line.includes(${JSON.stringify(keyword)}) && line.length <= 18 && line !== ${JSON.stringify(keyword)}))).slice(0, 20),
      filters: Array.from(new Set(bodyLines.filter(line => /^(产地|材质|风格|应用场景|加工定制|综合|销量|价格|起订量|店铺商品数|所在地区|商家特色|经营模式|一件代发|48H发货|退货包运费|1688严选|跨境证书)$/.test(line)))).slice(0, 30)
    };
  })()`);
  const pageData = pageResult.value as Omit<SuggestPageData, 'suggestions' | 'source'>;

  const entries = await listSiteNetwork(ctx.profile, 600);
  const candidates = entries
    .filter(entry => /mtop\.1688\.suggestion\.common\.getsuggestwords/i.test(entry.url))
    .map(entry => {
      const dataParam = new URL(entry.url).searchParams.get('data');
      let requestKeyword = '';
      try {
        const data = JSON.parse(dataParam || '{}') as { keywords?: unknown };
        requestKeyword = typeof data.keywords === 'string' ? data.keywords : '';
      } catch {
        requestKeyword = '';
      }
      return { entry, requestKeyword };
    })
    .filter(item => item.requestKeyword === keyword);

  const latest = candidates.at(-1);
  if (!latest) {
    return {
      ...pageData,
      suggestions: pageData.relatedSuggestions,
      source: 'dom_related',
    };
  }

  const body = await readSiteNetworkPart(ctx.profile, latest.entry.id, 'response');
  const payload = parseJsonp(typeof body.body === 'string' ? body.body : '') as {
    data?: { data?: Array<{ words?: unknown; queryWords?: unknown }> };
  };
  const suggestions = unique((payload.data?.data || [])
    .map(item => normalizeSuggestWord(item.words || item.queryWords))
    .filter(Boolean), 30);

  return {
    ...pageData,
    suggestions: suggestions.length ? suggestions : pageData.relatedSuggestions,
    source: suggestions.length ? 'autocomplete_api' : 'dom_related',
  };
}

async function collectProductPage(ctx: SiteCommandContext, offer: string): Promise<ProductPageData> {
  await openSitePage(ctx.profile, productUrl(offer));
  await sleep(4500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\\n').map(clean).filter(Boolean);
    const url = location.href;
    const offerId = (url.match(/offer\\/(\\d+)\\.html/) || url.match(/offerId=(\\d+)/) || [])[1];
    const titleFromDocument = clean(document.title).replace(/\\s*-\\s*阿里巴巴\\s*$/, '');
    const h1 = clean(document.querySelector('h1')?.innerText);
    const productTitle = (titleFromDocument && titleFromDocument !== '阿里巴巴' ? titleFromDocument : '')
      || (h1 && !/公司$|工厂$|厂$|商行$|店$/.test(h1) ? h1 : '')
      || lines.find(line => line.length >= 12 && !/^(¥|搜索|登录|注册|阿里巴巴|首页)$/.test(line) && !/公司$|工厂$|厂$|商行$|店$/.test(line));
    const company = lines.find(line => /公司$|工厂$|厂$|商行$|店$/.test(line));
    const priceLineIndex = lines.findIndex(line => line === '¥' || /^¥/.test(line));
    const price = priceLineIndex >= 0 ? lines.slice(priceLineIndex, priceLineIndex + 4).join('') : (bodyText.match(/¥\\s*\\d+(?:\\.\\d+)?(?:\\s*起)?/) || [])[0];
    const sales = lines.find(line => /已累计采购|月销|成交|件/.test(line) && /\\d/.test(line));
    const serviceTags = Array.from(new Set(lines.filter(line => /退货|发货|包邮|晚发|先采后付|无理由|响应|代发|铺货/.test(line)))).slice(0, 30);
    const shopSignals = Array.from(new Set(lines.filter(line => /入驻|主营|回头率|服务分|好评率|准时发货|揽收率|下游铺货|分销商/.test(line)))).slice(0, 40);
    const skuLines = Array.from(new Set(lines.filter(line => /库存\\d+|sku|规格|cm|ml|毫升|颜色|款|条|个|件/.test(line) && line.length <= 80))).slice(0, 80);
    const attributes = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^(材质|品牌|货号|型号|规格|风格|包装重量|工作温度|公称压力|安装型式|加工定制|是否跨境出口专供货源|主要下游平台|主要销售地区)$/.test(lines[i])) {
        attributes.push({ name: lines[i], value: lines[i + 1] });
      }
    }
    const imageUrls = Array.from(new Set(Array.from(document.images)
      .map(img => img.currentSrc || img.src)
      .filter(src => /alicdn\\.com/.test(src))
      .map(src => src.replace(/_(?:\\d+x\\d+|sum)\\.[a-z]+$/i, '')))).slice(0, 30);
    return {
      url,
      title: document.title,
      offerId,
      productTitle,
      company,
      price: clean(price),
      sales,
      serviceTags,
      shopSignals,
      skuLines,
      attributes,
      imageUrls,
      textExcerpt: bodyText.slice(0, 3000)
    };
  })()`);
  return result.value as ProductPageData;
}

async function runSearch(ctx: SiteCommandContext, options: AlibabaSearchOptions): Promise<SiteReceipt> {
  const keyword = options.keyword?.trim();
  if (!keyword) {
    return {
      site: '1688',
      command: 'search',
      ok: false,
      state: 'missing_keyword',
      errors: [{ code: 'MISSING_KEYWORD', message: 'Please provide --keyword.' }],
    };
  }
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 50));
  const data = await collectSearchPage(ctx, keyword, limit);
  return {
    site: '1688',
    command: 'search',
    ok: true,
    state: 'search_collected',
    page: { url: data.url, title: data.title },
    observations: {
      keyword,
      query: data.query,
      resultCountSampled: data.items.length,
      suggestions: data.suggestions,
      filters: data.filters,
      items: data.items,
    },
    next: [
      'Use siteflow 1688 product --offer <offerId|url> to inspect a candidate item.',
      'Use siteflow 1688 seo --keyword <keyword> --title <title> to analyze title coverage.',
    ],
  };
}

async function runHome(ctx: SiteCommandContext, options: AlibabaHomeOptions): Promise<SiteReceipt> {
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 50));
  const data = await collectHomePage(ctx, limit);
  const challengeDetected = /验证码|滑块|安全验证|拦截|punish|captcha/i.test(`${data.title}\n${data.textExcerpt}`);
  if (challengeDetected) {
    return {
      site: '1688',
      command: 'home',
      ok: false,
      state: 'challenge_detected',
      page: { url: data.url, title: data.title },
      observations: { textExcerpt: data.textExcerpt.slice(0, 1000) },
      errors: [{ code: 'CHALLENGE_DETECTED', message: '1688 displayed a verification/challenge page instead of the home sourcing page.' }],
      next: [
        'Stop automated retries for now.',
        'Complete the visible verification manually, then rerun at a lower frequency.',
      ],
    };
  }
  return {
    site: '1688',
    command: 'home',
    ok: true,
    state: 'home_collected',
    page: { url: data.url, title: data.title },
    observations: {
      resultCountSampled: data.items.length,
      categories: data.categories,
      filters: data.filters,
      sorts: data.sorts,
      items: data.items,
      textExcerpt: data.textExcerpt,
    },
    next: [
      'Use siteflow 1688 product --offer <offerId|url> to inspect an item from the home sourcing page.',
      'Use siteflow 1688 search --keyword <keyword> for intent-specific competitor results.',
    ],
  };
}

async function runSuggest(ctx: SiteCommandContext, options: AlibabaSuggestOptions): Promise<SiteReceipt> {
  const keyword = options.keyword?.trim();
  if (!keyword) {
    return {
      site: '1688',
      command: 'suggest',
      ok: false,
      state: 'missing_keyword',
      errors: [{ code: 'MISSING_KEYWORD', message: 'Please provide --keyword.' }],
    };
  }
  const data = await collectSuggestPage(ctx, keyword);
  return {
    site: '1688',
    command: 'suggest',
    ok: true,
    state: 'suggestions_collected',
    page: { url: data.url, title: data.title },
    observations: {
      keyword,
      query: data.query,
      suggestions: data.suggestions,
      relatedSuggestions: data.relatedSuggestions,
      filters: data.filters,
      source: data.source,
    },
    next: [
      'Use suggestions as candidate SEO terms only when they match the actual product.',
      'Use siteflow 1688 search --keyword <suggestion> to compare competitor results for a suggested term.',
    ],
  };
}

async function runProduct(ctx: SiteCommandContext, options: AlibabaProductOptions): Promise<SiteReceipt> {
  const offer = options.offer?.trim();
  if (!offer) {
    return {
      site: '1688',
      command: 'product',
      ok: false,
      state: 'missing_offer',
      errors: [{ code: 'MISSING_OFFER', message: 'Please provide --offer with an offerId or product URL.' }],
    };
  }
  const data = await collectProductPage(ctx, offer);
  const challengeDetected = /验证码|滑块|安全验证|拦截|punish|captcha/i.test(`${data.title}\n${data.textExcerpt}`);
  if (challengeDetected) {
    return {
      site: '1688',
      command: 'product',
      ok: false,
      state: 'challenge_detected',
      page: { url: data.url, title: data.title },
      observations: {
        requestedOffer: offer,
        offerId: data.offerId || offerIdFrom(offer),
        textExcerpt: data.textExcerpt.slice(0, 1000),
      },
      errors: [{ code: 'CHALLENGE_DETECTED', message: '1688 displayed a verification/challenge page instead of the product detail.' }],
      next: [
        'Stop automated retries for now.',
        'Complete the visible verification manually in the browser, then rerun the command at a lower frequency.',
      ],
    };
  }
  return {
    site: '1688',
    command: 'product',
    ok: true,
    state: 'product_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requestedOffer: offer,
      offerId: data.offerId || offerIdFrom(offer),
      productTitle: data.productTitle,
      company: data.company,
      price: data.price,
      sales: data.sales,
      serviceTags: data.serviceTags,
      shopSignals: data.shopSignals,
      skuLines: data.skuLines,
      attributes: data.attributes,
      imageUrls: data.imageUrls,
      textExcerpt: data.textExcerpt,
    },
    next: [
      'Use these fields as the factual source for SEO title and selling-point generation.',
      'Manually verify regulated terms, certificates, and product claims before publishing.',
    ],
  };
}

async function runSeo(ctx: SiteCommandContext, options: AlibabaSeoOptions): Promise<SiteReceipt> {
  const keyword = options.keyword?.trim();
  if (!keyword) {
    return {
      site: '1688',
      command: 'seo',
      ok: false,
      state: 'missing_keyword',
      errors: [{ code: 'MISSING_KEYWORD', message: 'Please provide --keyword.' }],
    };
  }
  const limit = Math.max(5, Math.min(Number(options.limit || 20) || 20, 50));
  const data = await collectSearchPage(ctx, keyword, limit);
  const page = await readSiteSnapshot(ctx.profile);
  const terms = topTerms(data.items, keyword, 18);
  const audit = options.title ? titleScore(options.title, keyword, terms) : undefined;
  const suggestedTitles = buildSeoSuggestions(keyword, options.title, terms, data.suggestions);
  const topCompetitors = data.items.slice(0, Math.min(10, data.items.length));

  return {
    site: '1688',
    command: 'seo',
    ok: true,
    state: 'seo_diagnosed',
    page: { url: page.url, title: page.title },
    observations: {
      keyword,
      resultTitle: data.title,
      resultCountSampled: data.items.length,
      suggestions: data.suggestions,
      filters: data.filters,
      competitorTerms: terms,
      titleAudit: options.title ? { title: options.title, length: [...options.title].length, ...audit } : null,
      suggestedTitles,
      topCompetitors,
    },
    next: [
      'Use high-frequency competitor terms only when they accurately describe your product.',
      'Avoid exaggerated claims such as 全网最低, 第一, 医用, 治疗, 杀菌 unless you have required qualifications.',
      'Run siteflow 1688 seo again with --title after drafting a product title.',
    ],
  };
}

export const alibaba1688Adapter: SiteAdapter = {
  id: '1688',
  title: '1688',
  description: '1688 search and product SEO analysis for store operations.',
  commands: [
    {
      name: 'home',
      description: 'Collect atomic 1688 selected-sourcing home page data',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'number of home page items to sample', '20')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runHome(ctx, this.opts<AlibabaHomeOptions>()));
          });
      },
    },
    {
      name: 'search',
      description: 'Collect atomic 1688 keyword search result data',
      configure(command: Command): void {
        command
          .requiredOption('--keyword <text>', '1688 search keyword')
          .option('--limit <n>', 'number of search result items to sample', '20')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runSearch(ctx, this.opts<AlibabaSearchOptions>()));
          });
      },
    },
    {
      name: 'suggest',
      description: 'Collect 1688 keyword autocomplete and related suggestions',
      configure(command: Command): void {
        command
          .requiredOption('--keyword <text>', '1688 search keyword prefix or seed keyword')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runSuggest(ctx, this.opts<AlibabaSuggestOptions>()));
          });
      },
    },
    {
      name: 'product',
      description: 'Collect atomic 1688 product detail data',
      configure(command: Command): void {
        command
          .requiredOption('--offer <id-or-url>', '1688 offerId or product URL')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runProduct(ctx, this.opts<AlibabaProductOptions>()));
          });
      },
    },
    {
      name: 'seo',
      description: 'Analyze 1688 keyword search results and suggest SEO title improvements',
      configure(command: Command): void {
        command
          .requiredOption('--keyword <text>', '1688 search keyword')
          .option('--title <text>', 'current product title to audit')
          .option('--limit <n>', 'number of search result items to sample', '20')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runSeo(ctx, this.opts<AlibabaSeoOptions>()));
          });
      },
    },
  ],
};
