# Reverse Playbook

这份 playbook 讲的是：面对一个新站点，怎样像熟手一样最小成本拿到可实现路线，而不是一头扎进脚本细节。

## Phase 0：先判断值不值得做 adapter

只有同时满足下面几点，才值得沉淀成 adapter：

- 这个站点流程会重复执行；
- 输入输出可以收敛成稳定命令；
- 失败态能结构化表达；
- 不需要绕过认证、DRM、验证码或风控；
- 最终结果对未来线程是可复用的，而不是一次性人工排障。

如果只是一次性排查，先用底层 CLI，不要急着写 adapter。

## Phase 1：拿页面最终态

先做最便宜的观察：

```bash
siteflow --json browser open 'https://example.com'
siteflow --json browser pages
siteflow --json console list --limit 30
siteflow --json eval 'location.href'
```

目标：
- 确认真实 URL，而不是入口 URL；
- 看有没有重定向到 login / challenge；
- 看页面主文案、按钮、列表、空态；
- 看 console 有没有直接报错。

### 判断问题在哪一层

- 页面上已经有目标数据：先走 DOM。
- 页面没有目标数据，但 network 很活跃：看 network。
- network 有请求，但参数/时序不清楚：加 hook 或 breakpoint。
- 页面根本没进入目标态：先解决 auth / challenge / navigation。

## Phase 2：确定数据来源

### 路线 A：DOM 已足够

当你能直接从页面拿到：
- 列表项
- 标题/作者/时间/链接
- 状态标记
- 详情页正文

就停在 DOM，不要继续深挖。

典型实现：
- `openOrNavigateSitePage`
- `sleep`
- `evaluateSiteExpression`
- `siteReceipt`

### 路线 B：network 更真实

当你发现：
- 页面上只显示一部分字段；
- 滚动或点击会触发请求；
- response 里字段比 DOM 完整；
- 数据分页明显依赖 cursor；

就改走 network：

```bash
siteflow --json network list --limit 200
siteflow --json network body <id> --part response
siteflow --json network body <id> --part request
siteflow --json request curl <id>
```

重点看：
- method、url、status
- content-type
- request body 里的 variables / cursor / query
- response 里真正的 items / paging / hasMore

## Phase 3：定位触发条件

有些接口不是页面一开就发，而是动作触发：

- 点击 tab
- 输入关键字
- 滚动到底部
- 选时间范围
- 打开 modal

这时不要猜。直接用底层动作触发一次，再看 network 变化：

```bash
siteflow --json browser inspect-target --text '更多'
siteflow --json browser click --text '更多'
siteflow --json browser type --selector 'input' --value 'AI'
siteflow --json network list --limit 200
```

如果触发条件稳定，adapter 就可以封装这个动作。

## Phase 4：脚本逆向只在必要时介入

只有下面几种情况，才需要 `scripts` / `break` / `hook`：

- 请求 URL 是固定的，但 body 中关键字段看不懂；
- cursor / signature / operationName 的拼装逻辑不明显；
- 某个按钮点击了但 network 没有可见请求；
- 数据来自运行时脚本状态，而不是直接 DOM/network。

### 最小逆向顺序

1. `scripts search 'graphql'`
2. `scripts search 'operationName'`
3. `scripts search 'cursor'`
4. `hook fetch`
5. `hook xhr`
6. `break xhr '/api/'`
7. `break text 'some-needle'`

目标不是“把前端全看懂”，而是只拿到实现 adapter 所需的最小证据。

## Phase 5：决定最终 adapter 形态

### 只读采集 adapter

适合：
- search
- list
- detail
- comments
- profile
- public metadata

要求：
- 默认无副作用；
- 能处理空结果；
- 能处理页面未加载完全时的最小失败态。

### checkpoint / replay adapter

适合：
- timeline
- feed
- cursor 翻页
- GraphQL 分页
- 需要保留请求上下文的 API 拉取

要求：
- 先捕获 checkpoint；
- 再用 replay 扩展页数；
- 保留 endpoint、cursor、parseErrors 等证据。

### draft / publish-assist adapter

适合：
- creator center
- 上传媒体
- 填写标题/正文
- 生成内容
- 暂存草稿

要求：
- 默认停在人审前；
- 登录态、challenge、可见页面结果必须回传；
- 发布类 flag 必须显式。

## Phase 6：把探索结果清洗成仓库风格

把临时探索结果转成正式实现时，做这几件事：

- 删除所有临时 debug 输出；
- 把表达式压缩到能维护的程度；
- 用现有 `clampInt` / `siteReceipt` / `ensureSitePage` / `openOrNavigateSitePage` 组合；
- 把错误路径变成 `SiteReceipt`，不要裸抛错；
- 把敏感字段留在本地临时调试，不进入 adapter 输出。

## 常见误判

### 误判 1：看到一个请求就以为它是主接口

修正：
- 看 response 是否真的包含最终业务数据；
- 看它是否稳定出现；
- 看是否只是预取、埋点或辅助请求。

### 误判 2：DOM 能拿到数据，就忽略它来自异步滚动

修正：
- 如果需要多页、多屏、增量数据，DOM 可能很脆；
- 这时应改用 network replay。

### 误判 3：一次坐标点击成功，就把它写死

修正：
- 只有在站点没有稳定 selector/text target 时才允许坐标兜底；
- 且要尽量放在 fallback 分支。

### 误判 4：逆向出完整脚本逻辑才动手写 adapter

修正：
- adapter 只需要稳定路径，不需要完整理解整个前端。
