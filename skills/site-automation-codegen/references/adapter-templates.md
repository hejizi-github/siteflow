# Adapter Templates

只选最接近现有模式的模板改，不要从空白开始发明结构。

## 1. DOM 只读模板

适合 search/list/detail 页面。

```ts
import type { Command } from 'commander';
import {
  runSiteCommand,
  addSitePageIdOption,
  clampInt,
  evaluateSiteExpression,
  openOrNavigateSitePage,
  siteReceipt,
  sleep,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'example';

interface SearchOptions {
  keyword: string;
  limit?: string;
  pageId?: string;
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 50);
  const page = await openOrNavigateSitePage(ctx.profile, `https://example.com/search?q=${encodeURIComponent(options.keyword)}`, options.pageId);
  await sleep(1200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      items: Array.from(document.querySelectorAll('[data-item]')).slice(0, ${JSON.stringify(limit)}).map(node => ({
        title: clean(node.querySelector('h2')?.textContent),
        href: node.querySelector('a')?.href,
      })),
    };
  })()`, page.pageId);
  return siteReceipt(SITE, 'search', {
    pageId: page.pageId,
    query: options.keyword,
    limit,
    ...(result.value as Record<string, unknown>),
    sideEffects: [],
  });
}

export const exampleAdapter: SiteAdapter = {
  id: SITE,
  title: 'Example',
  description: 'Read-only Example search adapter.',
  commands: [
    {
      name: 'search',
      description: 'Collect Example search results',
      configure(command: Command): void {
        addSitePageIdOption(command.argument('<keyword>').option('--limit <n>', 'number of items', '20')).action(async function (keyword: string) {
          await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
        });
      },
    },
  ],
};
```

参考：`src/sites/github.ts`、`src/sites/youtube.ts`、`src/sites/bilibili.ts`。

## 2. 纯 HTTP / API 模板

适合已有公开接口或浏览器不是必须的场景。

```ts
import type { Command } from 'commander';
import {
  runSiteCommand,
  clampInt,
  fetchJson,
  siteReceipt,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'example';
const API = 'https://api.example.com';

interface ListOptions {
  limit?: string;
}

async function runList(_ctx: SiteCommandContext, options: ListOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 100);
  const result = await fetchJson<Record<string, unknown>>(`${API}/items?limit=${limit}`);
  return siteReceipt(SITE, 'list', {
    limit,
    httpStatus: result.status,
    items: result.data.items,
    raw: result.data,
    sideEffects: [],
  });
}

export const exampleAdapter: SiteAdapter = {
  id: SITE,
  title: 'Example',
  description: 'Read-only Example API adapter.',
  commands: [
    {
      name: 'list',
      description: 'Collect Example items',
      configure(command: Command): void {
        command.option('--limit <n>', 'number of items', '20').action(async function () {
          await runSiteCommand(this, ctx => runList(ctx, this.opts<ListOptions>()));
        });
      },
    },
  ],
};
```

参考：`src/sites/github.ts`、`src/sites/sec.ts`。

## 3. 人审边界自动化模板

适合登录后填表、上传、生成、草稿，不适合默认最终提交。

```ts
import type { Command } from 'commander';
import {
  runSiteCommand,
  ensureSitePage,
  typeIntoSiteTarget,
  clickSiteTarget,
  uploadSiteFiles,
  captureSiteScreenshot,
  readSiteSnapshot,
  readRecentSiteErrors,
  waitForText,
  sleep,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

interface DraftOptions {
  title: string;
  body?: string;
  file?: string[];
  screenshot?: string;
  submit?: boolean;
}

async function runDraft(ctx: SiteCommandContext, options: DraftOptions): Promise<SiteReceipt> {
  const screenshots: string[] = [];
  await ensureSitePage(ctx.profile, 'https://example.com/publish', 'example.com');
  await typeIntoSiteTarget(ctx.profile, { selector: 'input[name="title"]', nth: 0, value: options.title });
  if (options.body) await typeIntoSiteTarget(ctx.profile, { selector: 'textarea', nth: 0, value: options.body });
  if (options.file?.length) await uploadSiteFiles(ctx.profile, 'input[type="file"]', options.file);

  const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);

  if (!options.submit) {
    const page = await readSiteSnapshot(ctx.profile);
    return {
      site: 'example',
      command: 'draft',
      ok: true,
      state: 'filled_not_submitted',
      page: { url: page.url, title: page.title },
      screenshots,
      observations: { titleLength: options.title.length },
      next: ['Review the visible form, then rerun with --submit.'],
    };
  }

  await clickSiteTarget(ctx.profile, { text: '提交', timeoutMs: 10_000 });
  await sleep(5000);
  const page = await readSiteSnapshot(ctx.profile);
  const completed = await waitForText(ctx.profile, '成功', 2000);
  const errors = await readRecentSiteErrors(ctx.profile, 20);
  return {
    site: 'example',
    command: 'draft',
    ok: completed,
    state: completed ? 'submitted' : 'submitted_unconfirmed',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      completed,
      errors: errors.slice(-8),
      textExcerpt: page.text.slice(0, 1200),
    },
    next: completed ? [] : ['Inspect the visible page and confirm the result manually.'],
  };
}
```

参考：`src/sites/jimeng.ts`、`src/sites/xhs.ts`、`src/sites/douyin.ts`。

## 4. Network replay 模板

适合 timeline、cursor、分页类接口。

```ts
const entries = await listSiteNetwork(ctx.profile, 500);
const target = entries.find(entry => /graphql|timeline|search/i.test(entry.url) && entry.responseBody?.available);
if (!target) {
  return {
    site: SITE,
    command: 'home',
    ok: false,
    state: 'missing_network_evidence',
    errors: [{ code: 'NETWORK_NOT_FOUND', message: 'No matching network entry was captured.' }],
    next: ['Open the target page, trigger the request in the browser, and rerun the command.'],
  };
}
const requestBody = await readSiteNetworkPart(ctx.profile, target.id, 'request');
const replay = await replaySiteRequestWithBody(ctx.profile, target.id, buildNextBody(requestBody.body));
```

参考：`src/sites/twitter.ts`、`src/sites/1688.ts`。

## 共同要求

- 文件名：`src/sites/<id>.ts`
- 注册：`src/sites/registry.ts`
- 统一从 `./capabilities.js` import
- receipt 至少包含：`site`、`command`、`ok`、`state`
- 失败分支返回结构化 `errors` / `next`
- 有副作用的命令显式记录 `sideEffects` 或 `next`
