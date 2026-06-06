# Capability Map

这个仓库分两层：

```text
site adapter
  -> src/sites/capabilities.ts
    -> src/daemon/client.ts
      -> src/runtime/browser-runtime.ts
```

生成 adapter 时，永远先看 `src/sites/capabilities.ts`，因为它定义了 adapter 的真实能力边界。

## Adapter 层可直接用的能力

### 页面与导航

- `ensureSitePage(profile, url, expectedUrlPart?)`
  - 复用当前 leased/selected page；不匹配时打开目标页。
  - 适合 status、creator center、需要保持单页上下文的工作流。
- `openSitePage(profile, url)`
  - 总是打开新页。
  - 适合一次性只读命令。
- `navigateSitePage(profile, url, pageId?)`
  - 在指定页内导航。
- `openOrNavigateSitePage(profile, url, pageIdValue?)`
  - 只读 search/detail 命令最常用。
- `listSitePages(profile)`
  - 需要复用已有 tab 时使用。
- `addSitePageIdOption(command)`
  - 给命令加 `--page-id`，允许绑定到已有 tab。

### 页面动作

- `clickSiteTarget(profile, { selector | text | aria | x/y, nth, exact, clickableParent, force, expect* })`
- `typeIntoSiteTarget(profile, { selector | text | aria, value, nth, clear, pressEnter })`
- `uploadSiteFiles(profile, selector, files, timeoutMs?)`
- `uploadSiteTarget(profile, { selector, files, timeoutMs?, nth? })`

注意：adapter facade 目前没有暴露 `browser select`，需要下拉框时优先用 click + DOM 选择实现，不要跨边界直接调 daemon。

### 观察与证据

- `readSiteText(profile, max?)`
- `readSiteSnapshot(profile)`
- `captureSiteScreenshot(profile, out?)`
- `readRecentSiteErrors(profile, limit?)`
- `detectSiteCaptcha(profile)`
- `evaluateInSitePage<T>(profile, expression, pageId?)`
- `evaluateSiteExpression(profile, expression, pageId?)`
- `waitForText(profile, needle, timeoutMs)`
- `sleep(ms)`

### 网络与请求重放

- `listSiteNetwork(profile, limit)`
- `readSiteNetworkBody(profile, id)`
- `readSiteNetworkPart(profile, id, 'request' | 'response')`
- `replaySiteRequestWithBody(profile, id, body)`
- `replaySiteRequestWithUrl(profile, id, url)`
- `reloadSitePage(profile)`

### 直接 HTTP helper

这些也从 `./capabilities.js` 导出，可用于纯 HTTP adapter：

- `fetchJson`
- `fetchText`
- `parseJsonp`
- `downloadFile`
- `clampInt`
- `cleanText`
- `siteReceipt`

## Browser Kernel 勘探命令

这些命令不直接写进 adapter，但用于生成 adapter 之前摸清站点：

### 观察页面

```bash
siteflow --json browser open 'https://example.com'
siteflow --json browser pages
siteflow --json browser inspect-target --text '登录'
siteflow --json browser screenshot --out /tmp/page.png
```

### 观察脚本与调试器

```bash
siteflow --json scripts list
siteflow --json scripts search 'signature'
siteflow --json scripts get <script-id> --out /tmp/app.js
siteflow --json break text 'fetch("/api/'
siteflow --json break xhr '/graphql'
siteflow --json paused
siteflow --json eval 'location.href'
siteflow --json resume
```

### 观察网络

```bash
siteflow --json network list --limit 200
siteflow --json network body <id> --part request
siteflow --json network body <id> --part response
siteflow --json request curl <id>
siteflow --json request replay <id>
```

### 观察运行时副作用

```bash
siteflow --json hook fetch
siteflow --json hook xhr
siteflow --json hook crypto
siteflow --json console list --limit 100
siteflow --json runtime storage
siteflow --json auth cookies --domain example.com
```

## 选择路线的原则

### 优先 DOM 抓取

满足这些条件就优先 DOM：

- 目标数据已经稳定出现在页面；
- 不需要复杂翻页/cursor；
- 数据量有限；
- 站点接口签名复杂，但页面本身可读。

参考：`src/sites/github.ts`、`src/sites/youtube.ts`。

### 优先 HTTP / network replay

满足这些条件就优先接口：

- 页面只是壳，数据主要靠 XHR/fetch/GraphQL；
- 需要翻页、cursor、增量拉取；
- DOM 太重、太脆弱或需要滚动很多次；
- 已经能从 network entry 还原稳定请求。

参考：`src/sites/twitter.ts`、`src/sites/1688.ts`。

### 优先人审边界自动化

满足这些条件就只做半自动：

- 流程涉及登录、上传、生成、草稿、发布；
- 页面随时可能弹 challenge；
- 最终动作不可逆；
- 需要截图或 `next` 指引给用户收尾。

参考：`src/sites/jimeng.ts`、`src/sites/xhs.ts`、`src/sites/douyin.ts`。
