---
name: site-automation-codegen
description: >
  为 Siteflow 生成新的站点自动化代码。
  这不是通用脚手架，而是把资深站点自动化/逆向工程师的方法，落到 Siteflow 现有 Browser Kernel、daemon、capabilities facade、receipt 契约和 adapter 边界里的工作流。
  适用于新增站点、扩展已有 adapter、把临时浏览器调试流程收敛成正式 CLI 命令。
triggers:
  - 站点自动化
  - site adapter
  - 生成 adapter
  - 新增站点命令
  - 浏览器工作流沉淀
  - 生成站点自动化代码
  - 自动化代码生成
---

# Site Automation Codegen

目标：在这个仓库里生成或扩展 `src/sites/<id>.ts`，并通过 `src/sites/registry.ts` 暴露成正式命令。

## 这项 skill 的立场

它不是“帮你写个 Playwright 脚本”。

它要求你：

- 先识别站点类型，再选最稳的采集/自动化路线；
- 先拿到证据，再写 adapter；
- 把一次性调试流程变成可复用 CLI；
- 把风险动作停在人审边界；
- 把失败态、登录态、challenge、空结果都做成结构化 receipt；
- 严格复用现有 capability facade，不准越层。

## 先读这些文件

1. `src/sites/capabilities.ts`：adapter 允许使用的底层能力边界。
2. `src/sites/types.ts`：`SiteAdapter` / `SiteReceipt` 契约。
3. `src/sites/registry.ts`：注册方式。
4. `docs/adapter-authoring.md`：最小骨架和 receipt 约束。
5. 一个最相似的现有 adapter：
   - 只读 DOM 抓取：`src/sites/github.ts` / `src/sites/youtube.ts`
   - 网络/API 混合：`src/sites/twitter.ts` / `src/sites/1688.ts`
   - 人审边界自动化：`src/sites/jimeng.ts` / `src/sites/xhs.ts` / `src/sites/douyin.ts`
6. 深入参考：
   - `references/capability-map.md`
   - `references/adapter-templates.md`
   - `references/reverse-playbook.md`
   - `references/stability-rules.md`
   - `references/signature-playbook.md`

## 站点类型决策树

先判断你面对的是哪一类站点，再决定路线。

### A. 公共内容站 / 结果页 / 详情页

特征：
- 页面直接有可读 DOM；
- 不需要登录；
- 数据量有限；
- 主要动作是 search/list/detail。

优先路线：
- `openOrNavigateSitePage`
- `evaluateSiteExpression`
- `siteReceipt`

参考：`github.ts`、`youtube.ts`、`bilibili.ts`

### B. SPA 壳页面 + 真数据走 XHR/fetch/GraphQL

特征：
- DOM 很薄；
- 页面滚动才触发请求；
- 接口里有 cursor、variables、operationName；
- 数据解析从 network 比从 DOM 稳。

优先路线：
- 先 `openSitePage` / `ensureSitePage`
- 再 `listSiteNetwork`
- 读 `readSiteNetworkPart`
- 需要翻页时用 `replaySiteRequestWithBody` / `replaySiteRequestWithUrl`

参考：`twitter.ts`、`1688.ts`

### C. 登录后 creator center / 表单 / 上传 / 生成页

特征：
- 需要登录态；
- 页面上有输入、上传、草稿、发布、生成；
- 随时会出现验证码/风控；
- 最终动作不可逆。

优先路线：
- `ensureSitePage`
- `typeIntoSiteTarget`
- `clickSiteTarget`
- `uploadSiteFiles` / `uploadSiteTarget`
- `captureSiteScreenshot`
- `readSiteSnapshot`

默认策略：
- 先填充，不默认最终提交；
- 只有显式 `--submit` / `--publish` / `--save-draft` 才进入后续动作；
- 能停在人审边界就停。

参考：`jimeng.ts`、`xhs.ts`、`douyin.ts`

### D. 脚本复杂 / 加签 / 动态状态机站点

特征：
- 请求参数来源不清楚；
- DOM 和 network 都看不懂；
- 接口依赖运行时脚本状态；
- 需要定位具体 JS 逻辑。

优先路线：
- `scripts list/search/get`
- `break text`
- `break xhr`
- `hook fetch/xhr/crypto`
- `paused` / `eval` / `resume`

注意：
- 这些命令主要用于**找证据和路线**；
- 最终 adapter 仍然应尽量回落到 DOM、公开 HTTP、network replay 或显式页面动作；
- 不要把“调试器探索过程”直接塞进 adapter 主链路，除非这是唯一稳定实现。

## 逆向顺序

资深做法不是一上来读脚本，而是按成本递增排查。

1. **先看页面最终态**
   - URL、title、可见文案、按钮、输入框、错误提示。
2. **再看网络**
   - 哪个请求真正返回目标数据；
   - 请求是页面打开触发，还是点击/滚动触发；
   - response 是否比 DOM 更完整。
3. **再看 console / hook**
   - 有没有 runtime error、challenge、加签线索、fetch/xhr/crypto 行为。
4. **最后才看 scripts / breakpoint**
   - 当你需要定位 operationName、signature、cursor builder、状态机分支时再下去。

如果 network 已经足够稳定，停止继续逆向。不要过度设计。

## 加签判断规则

下面这些信号一出现，就要怀疑请求不是“直接 replay 就能长期稳定工作”：

- request body 里有 `sign` / `signature` / `token` / `auth` / `ts` / `nonce` / `x-s` / `x-t` 一类字段；
- 同一路径同样参数，重放很快 401 / 403 / 419 / 412；
- 页面动作能成功，但脱离页面上下文的 replay 失败；
- hook `crypto` 后看到 `digest` / `sign` / `encrypt` / `getRandomValues` 紧贴请求发生；
- `scripts search` 能搜到 `Hmac`、`SHA-256`、`md5`、`sign`、`nonce`、`timestamp`、`operationName`、`variables` 等拼装逻辑。

一旦怀疑有加签，先读 `references/signature-playbook.md`。

## 工作流

1. **定义命令面**
   - site id
   - command 名
   - 输入参数
   - 是否只读
   - 是否允许副作用
   - receipt `state`
2. **先观察再实现**
   - 用底层 CLI 复现最短可行路径；
   - 记录页面、network、challenge、auth 证据；
   - 确认这条路径是不是稳定路径，而不是偶然路径。
3. **选模板**
   - 从 `references/adapter-templates.md` 选最接近的模板；
   - 不要另起一套 adapter 风格。
4. **实现主路径**
   - 只从 `./capabilities.js` import；
   - 参数解析、页面动作、network 解析、receipt 结构与现有代码保持一致。
5. **补失败路径**
   - auth required
   - blocked by challenge
   - empty result
   - invalid response
   - missing network evidence
   - invalid options
   - signing required / signing unstable（当脱离页面上下文无法稳定重放时）
6. **注册命令**
   - 更新 `src/sites/registry.ts`。
7. **验证**
   - 至少运行 `npm run typecheck`、`npm run test:unit`；
   - 真实浏览器路径按影响面补最小 CLI 验证。

## 底层勘探命令

先用这些命令摸清路径：

```bash
siteflow --json daemon start
siteflow --json browser open 'https://example.com'
siteflow --json browser pages
siteflow --json browser inspect-target --text '提交'
siteflow --json browser click --text '提交'
siteflow --json browser type --selector 'input' --value 'example'
siteflow --json scripts list
siteflow --json scripts search 'graphql'
siteflow --json network list --limit 200
siteflow --json network body 42 --part response
siteflow --json request curl 42
siteflow --json break xhr '/api/'
siteflow --json paused
siteflow --json eval 'location.href'
siteflow --json hook fetch
siteflow --json hook xhr
siteflow --json hook crypto
siteflow --json console list --limit 50
```

## 专家规则

### 1. 路线选择规则

- DOM 能稳定拿到的数据，不要为了“更底层”去做 replay。
- request replay 只有在分页、cursor、滚动流、隐藏数据明显更合适时才上。
- 表单/上传/发布类流程默认做半自动，不默认做最终不可逆动作。
- 若站点强依赖登录后页面上下文，优先做 page-bound adapter，而不是伪造裸请求。
- 如果 replay 受加签影响，优先保住页面内可执行路径，不要为了“全自动 replay”把 adapter 做成脆弱实现。

### 2. 选择器规则

- 优先文字、语义目标、稳定 selector；
- 再退到 `nth`；
- 坐标点击只能做兜底，不应是主要路径；
- 若文案会变化，先找更稳定的交互父节点或输入控件。

### 3. 等待规则

- 不要只堆 `sleep`；
- sleep 只作为页面渲染缓冲；
- 需要状态确认时优先用页面文本、network 证据、截图后页面态、或后置条件；
- 对生成/上传类流程，提交后必须重新读取页面和 recent errors。

### 4. 登录与 challenge 规则

- 登录页、短信登录、扫码、验证码、Turnstile、Cloudflare 只报状态，不绕过；
- receipt 里返回 `auth_required` 或 `blocked_by_challenge`；
- `next` 明确告诉用户在可见浏览器里手动完成后再 rerun。

### 5. 副作用规则

- 有副作用的命令要显式 flag 驱动；
- 默认不发布、不下载、不生成最终结果、不提交表单；
- 若允许提交，必须把结果证据写回 receipt，并保留人工复核下一步。

### 6. 输出规则

- `observations` 放证据，不放猜测；
- `errors` 放结构化错误码和消息；
- `next` 放用户下一步动作；
- 不要把敏感请求体、cookie、token、Authorization、真实上传内容落盘到普通输出。

## 反模式

这些做法直接判错：

- 在 adapter 里直接 import `../daemon/client.js`、runtime、Playwright；
- 不经过 `capabilities.ts` 自己发明一套 browser helper；
- 默认点击“发布/提交/生成”；
- 把 challenge 绕过去；
- 把 network body、cookie、token 原样塞进 receipt；
- 只写成功路径，不写 auth/challenge/empty/error；
- 用大量坐标点击替代稳定选择器；
- 因为临时调试跑通一次，就把脚本直接提交成 adapter；
- 明知道请求依赖页面内加签，还强行把命令设计成脱离页面上下文的纯 replay。

## 完成标准

- `src/sites/<id>.ts` 实现完成。
- `src/sites/registry.ts` 已注册。
- 相关测试或 proof 已补齐到和改动规模匹配。
- `npm run typecheck` 通过。
- `npm run test:unit` 通过。
- 新命令返回结构化 `SiteReceipt`。
- 失败路径不会抛出非结构化异常。

详细模板看 `references/adapter-templates.md`，能力映射看 `references/capability-map.md`，逆向顺序和稳定性细则分别看 `references/reverse-playbook.md` 与 `references/stability-rules.md`，加签判断和处理看 `references/signature-playbook.md`。
