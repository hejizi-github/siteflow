# Site Adapter 开发规范

Site adapter 是 Siteflow 面向具体站点的能力层。它把某个站点上可重复执行的动作封装成稳定 CLI 命令，并返回结构化 receipt。adapter 不应该直接管理浏览器生命周期，也不应该把大段页面 JavaScript 堆在命令函数里。

## 核心原则

- Adapter 负责业务编排，不负责浏览器内核细节。
- Browser Kernel / runtime 是唯一持有 Playwright `BrowserContext` / `Page` 生命周期的层。
- Adapter 必须通过 `src/sites/capabilities.ts` 使用浏览器、网络、文件下载等能力。
- 页面 DOM 提取和页面脚本应优先放在 `src/sites/probes/`，由 adapter 通过语义化 probe 调用。
- 多步骤站点命令应使用 `src/sites/flow/define-flow.ts` 记录步骤，而不是在一个函数里串联隐式副作用。
- Receipt 必须稳定、结构化、可测试；普通输出、日志、trace 和 step evidence 不能泄漏 cookie、token、caption URL、正文、请求体等敏感数据。
- 默认 read-only。发布、上传、下载、生成、写文件等 mutating 行为必须有显式参数或明确 `sideEffects`，必要时停在人审边界。

## 分层边界

主链路：

```text
CLI
  -> daemon client
    -> daemon server
      -> Browser Kernel / runtime
        -> Playwright / CDP / page context

site adapter
  -> flow runner
    -> semantic probes
      -> capabilities facade
        -> daemon client
```

文件职责：

```text
src/sites/<id>.ts                 adapter：命令注册、参数解析、flow 编排、receipt 组装
src/sites/probes/<id>.ts          semantic probes：页面内提取、DOM selector、payload normalization
src/sites/probes/selector-runtime.ts  通用 selector DSL 和列表提取工具
src/sites/probes/common.ts        通用页面 probe，例如滚动
src/sites/flow/define-flow.ts     flow runner、步骤记录、step evidence
src/sites/capabilities.ts         adapter/probe 访问 browser/daemon 能力的唯一门面
src/sites/registry.ts             adapter 注册表
src/sites/types.ts                SiteAdapter / SiteReceipt 类型
test/unit/adapter-proofs.test.mjs adapter 可注入依赖 proof tests
test/unit/site-probes.test.mjs    probe 单元测试
test/unit/site-import-governance.test.mjs 架构边界治理测试
```

硬规则：

- Adapter 不得直接 import `../daemon/client.js`、`../runtime/*`、`../shared/*`。
- Adapter 不得直接 import `./helpers.js`、`./http-utils.js`、`./runner.js` 或 `./types.js`；从 `./capabilities.js` 获取 site-facing API 和类型。
- 允许直接接触 daemon client 的站点基础设施仅限 `src/sites/capabilities.ts` 和 `src/sites/runner.ts`。
- Raw page evaluation 只能作为低层能力存在。新迁移或新增的复杂页面脚本应封装进 probe，不要留在 adapter command 函数里。

## Adapter 命令骨架

```ts
import type { Command } from 'commander';
import {
  addSitePageIdOption,
  openOrNavigateSitePage,
  runSiteCommand,
  siteReceipt,
  sleep,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { defineSiteFlow, flowEvidence } from './flow/define-flow.js';
import { exampleSearchResults } from './probes/example.js';
import type { ProbePage } from './probes/selector-runtime.js';

const SITE = 'example';

interface SearchOptions {
  keyword: string;
  limit?: string;
  pageId?: string;
}

interface ExamplePageInfo {
  pageId?: number;
  url: string;
  title: string;
}

interface ExampleDeps {
  openOrNavigateSitePage(profile: string, url: string, pageId?: string): Promise<ExamplePageInfo>;
  sleep(ms: number): Promise<void>;
  exampleSearchResults(page: ProbePage, options: { limit: number }): Promise<{
    results: unknown[];
    evidence: Record<string, unknown>;
  }>;
}

const deps: ExampleDeps = {
  openOrNavigateSitePage,
  sleep,
  exampleSearchResults,
};

async function runSearch(ctx: SiteCommandContext, options: SearchOptions, injected = deps): Promise<SiteReceipt> {
  const limit = Number.parseInt(options.limit || '20', 10);
  return defineSiteFlow(ctx, SITE, 'search')
    .step('open_search_page', async () => {
      const page = await injected.openOrNavigateSitePage(ctx.profile, `https://example.com/search?q=${encodeURIComponent(options.keyword)}`, options.pageId);
      return flowEvidence(page, { pageId: page.pageId });
    })
    .step('wait_for_results', async flow => {
      const page = flow.get<ExamplePageInfo>('open_search_page');
      const waitedMs = 1000;
      await injected.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('extract_results', async flow => {
      const page = flow.get<ExamplePageInfo>('open_search_page');
      const result = await injected.exampleSearchResults({ profile: ctx.profile, pageId: page.pageId }, { limit });
      return flowEvidence({ results: result.results }, result.evidence);
    })
    .receipt(flow => {
      const page = flow.get<ExamplePageInfo>('open_search_page');
      const result = flow.get<{ results: unknown[] }>('extract_results');
      return siteReceipt(SITE, 'search', {
        keyword: options.keyword,
        pageId: page.pageId,
        url: page.url,
        title: page.title,
        results: result.results,
        sideEffects: [],
      });
    });
}

export const exampleAdapter: SiteAdapter = {
  id: SITE,
  title: 'Example',
  description: 'Read-only Example adapter.',
  commands: [
    {
      name: 'search',
      description: 'Search Example.',
      configure(command: Command): void {
        addSitePageIdOption(command.argument('<keyword>').option('--limit <n>', 'result limit', '20'))
          .action(async function (keyword: string) {
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
          });
      },
    },
  ],
};
```

注册到 `src/sites/registry.ts` 后，`siteflow sites list --json` 应能看到它。

## Probe 规范

Probe 是页面内结构化提取层。它可以使用 selector runtime 或少量页面表达式，但必须把页面返回值 normalize 成稳定类型。

适合放进 probe 的内容：

- DOM selector、页面脚本、滚动探测、caption track discovery。
- URL、href、video id、时间、计数等站点语义解析。
- 页面 payload unwrap 和 malformed payload normalization。
- 小 evidence，如 `{ count, limit, root }`、`{ pageId, hasVideoId }`。

不适合放进 probe 的内容：

- CLI 参数解析。
- `siteReceipt` 组装。
- 是否写文件、是否发布、是否点击最终提交按钮的产品决策。
- 依赖真实账号、cookie、trace、下载路径的逻辑。

Selector probe 示例：

```ts
import { extractList, href, text, type ExtractListResult, type ProbePage } from './selector-runtime.js';

export interface ExampleResult {
  title: string;
  href: string;
}

export async function exampleSearchResults(page: ProbePage, options: { limit: number }): Promise<{
  results: ExampleResult[];
  evidence: ExtractListResult['evidence'];
}> {
  const result = await extractList(page, {
    root: '.result',
    limit: options.limit,
    required: ['href'],
    fields: {
      title: text('.title', { max: 200 }),
      href: href('a.title'),
    },
  });

  return {
    results: result.rows.map(row => ({
      title: typeof row.title === 'string' ? row.title : '',
      href: typeof row.href === 'string' ? row.href : '',
    })),
    evidence: result.evidence,
  };
}
```

Probe evidence 要小、稳定、无敏感内容。不要把标题列表、评论正文、字幕 URL、请求体、cookie、token 放进 evidence。完整业务数据可以进入 receipt `observations`，但仍要遵守隐私和 redaction 规则。

## Flow 规范

多步骤命令应使用 `defineSiteFlow`：

- Step 名称使用稳定 snake_case，如 `open_video_page`、`extract_comments`、`write_transcript_file`。
- Step 只通过 `flowEvidence(value, evidence)` 暴露小证据。
- 不使用 `flowEvidence` 时，step value 不会进入 `steps[].evidence`。
- Step 失败会记录通用 `SITE_FLOW_STEP_FAILED`，避免把原始异常和敏感信息写入 receipt。
- Receipt builder 从 `flow.get<T>(stepName)` 读取步骤结果，组装最终 receipt。

推荐步骤顺序：

```text
open_*_page
wait_for_*_page
scroll_or_prepare
extract_* / discover_*
fetch_* / write_*     仅在命令确实需要副作用时
receipt
```

`steps` 是可观测编排轨迹，不是数据 dump。用户需要的数据放在 `observations`，调试用的最小证据放在 `steps[].evidence`。

## Receipt 规范

每个 receipt 必须有：

- `site`
- `command`
- `ok`
- `state`

建议字段：

- `page` 或 `observations.url/title/pageId`
- `observations`：业务结果和可复现状态。
- `errors`：结构化错误数组。
- `next`：用户下一步。
- `steps`：flow runner 自动附加。

常见 `state`：

- `observed`
- `collected` / `*_collected`
- `auth_required`
- `blocked_by_challenge`
- `age_gate_present`
- `empty_result`
- `invalid_response`
- `file_written`
- `publish_ready_for_review`

失败 receipt 示例：

```ts
return siteReceipt(SITE, 'comments', {
  target: options.target,
  pageId: page.pageId,
  sideEffects: [],
}, false, [{
  code: 'AUTH_REQUIRED',
  message: 'Login is required before comments can be collected.',
}]);
```

遇到验证码、Turnstile、Cloudflare、年龄门槛、登录页、风控挑战时，只报告状态和下一步，不要绕过。

## Page Targeting 规范

需要打开或操作浏览器页面的命令应支持 `--page-id`：

- 使用 `addSitePageIdOption(command)` 注册选项。
- 使用 `openOrNavigateSitePage(ctx.profile, url, options.pageId)` 绑定目标页面。
- 后续 probe 或 evaluation 必须传同一个 `pageId`。
- 不要在 adapter 里手写 `.option('--page-id ...')`。
- `parseSitePageId` 由 capabilities facade 负责严格解析。

治理测试会检查：

- adapter 不直接声明 `--page-id`；
- page-targeted evaluation 使用 facade 返回的 page id；
- capabilities facade 拥有 page id option wiring。

## Capabilities 使用规范

Adapter 优先使用：

- `runSiteCommand`
- `siteReceipt`
- `addSitePageIdOption`
- `openOrNavigateSitePage`
- `ensureSitePage`
- `openSitePage`
- `navigateSitePage`
- `reloadSitePage`
- `listSitePages`
- `clickSiteTarget`
- `typeIntoSiteTarget`
- `uploadSiteFiles` / `uploadSiteTarget`
- `readSiteSnapshot`
- `readSiteText`
- `captureSiteScreenshot`
- `readRecentSiteErrors`
- `detectSiteCaptcha`
- `listSiteNetwork`
- `readSiteNetworkBody`
- `readSiteNetworkPart`
- `replaySiteRequestWithBody`
- `replaySiteRequestWithUrl`
- `sleep`
- `waitForText`
- `clampInt`、`cleanText`、`fetchJson`、`fetchText`、`downloadFile`、`parseJsonp`

`evaluateSiteExpression` 和 `evaluateInSitePage` 是低层能力。新增复杂 DOM 提取时应封装到 probe；adapter 只调用语义化 probe。

## 副作用规范

命令默认 read-only。以下行为必须显式表达：

- 写文件、下载文件、导出 cookie、导出 trace、截图。
- 上传文件、点击提交、发布内容、发送消息。
- replay request 或修改远端状态。

Receipt 中必须写明：

```ts
sideEffects: ['file_download']
```

发布类命令默认停在人审边界，例如 `draft_filled_publish_not_clicked`。不要自动点击最终发布按钮，除非命令参数明确要求且文档、测试和 receipt 都说明了影响。

## 隐私和安全规范

不得进入普通输出、日志、trace、receipt、测试 fixture 或示例：

- Cookie 值。
- Authorization / Proxy-Authorization。
- token、secret、session。
- 真实用户输入。
- 敏感请求体。
- caption URL、私有下载 URL。
- browser profile、network dump、receipt artifact、截图。

允许输出时必须先 redaction，或只写入用户显式指定的私有文件并设置合适权限。

不要实现绕过验证码、DRM、付费墙、平台风控或未授权访问的能力。

公开文档、测试数据和示例使用 `example.com`、`example.test`、`YOUR_API_KEY` 等中性占位符。

## 测试规范

新增或修改 adapter 后至少运行：

```bash
npm run typecheck
npm run test:unit
```

新增站点后至少验证：

```bash
npm run build
npm start -- sites list --json
```

测试分层：

- Probe 逻辑放在 `test/unit/site-probes.test.mjs`。
- Adapter 编排 proof 放在 `test/unit/adapter-proofs.test.mjs`，通过依赖注入模拟页面、probe、文件写入和网络 fetch。
- 架构边界放在 `test/unit/site-import-governance.test.mjs`。
- Registry 可见性放在 `test/unit/site-registry.test.mjs`。

Proof test 应覆盖：

- 正常 receipt shape。
- 失败 receipt shape。
- `steps.map(step => step.name)` 顺序。
- `JSON.stringify(receipt.steps)` 不包含正文、标题列表、caption URL、文件路径、cookie、token。
- page id 传递到 probe/evaluation。

不要为了测试方便 mock 掉真正需要验证的边界。可以对纯 adapter dependency injection 做局部测试，但涉及浏览器行为的主链路仍应保留 fixture 或 CLI 级验证证据。

## 开发检查清单

新增站点：

- [ ] 创建 `src/sites/<id>.ts`，文件名使用小写站点 ID。
- [ ] 通过 `src/sites/capabilities.ts` import 所有 site-facing API 和类型。
- [ ] 注册到 `src/sites/registry.ts`。
- [ ] 需要页面的命令使用 `addSitePageIdOption` 和 `openOrNavigateSitePage`。
- [ ] 复杂 DOM 提取放到 `src/sites/probes/<id>.ts`。
- [ ] 多步骤命令使用 `defineSiteFlow`。
- [ ] Receipt 包含 `site`、`command`、`ok`、`state`、`observations`、`errors` 或 `next`。
- [ ] Step evidence 不包含敏感值或大 payload。
- [ ] Mutating 行为有显式参数和 `sideEffects`。
- [ ] 遇到登录、验证码、挑战页时返回结构化状态，不绕过。
- [ ] 添加 probe test、adapter proof test、registry/governance 相关测试。
- [ ] 运行 `npm run typecheck` 和 `npm run test:unit`。

修改现有站点：

- [ ] 不扩大无关行为面。
- [ ] 不把 raw evaluation 重新塞回已迁移 adapter path。
- [ ] 保持 CLI 参数和 receipt shape 兼容，除非任务明确要求 breaking change。
- [ ] 修改 page targeting 后确认使用 facade 返回的 page id。
- [ ] 修改发布边界后运行 `npm pack --dry-run` 并检查包内容。
