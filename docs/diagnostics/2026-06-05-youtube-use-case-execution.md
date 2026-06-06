# YouTube 用户用例执行结果场景诊断

诊断对象：[`docs/用户用例/2026-06-05-youtube-business-use-cases-execution.md`](../用户用例/2026-06-05-youtube-business-use-cases-execution.md)

本次按场景诊断重新现场执行了异常用例，不只复核已有报告。

临时执行目录：`/tmp/siteflow-youtube-diagnosis-fresh/`  
隐私边界：只保存结构化摘要；未保存 cookie、token、浏览器 profile、完整 DOM 文本、完整 network body、签名字幕 URL 或 transcript 正文。

## 问题

执行报告中有两个业务失败需要根因诊断：

1. UC-04 comments：`youtube comments h6UbVuHprZA --limit 5` 顶层成功，业务 receipt `comments_collected`，但 `comments: []`。
2. UC-05 transcript：多个视频顶层成功，watch 页也发现 caption tracks，但业务 receipt `TRANSCRIPT_UNAVAILABLE`，没有 XML 文件写入。

同时复核原报告中的启动门槛问题：业务 receipt 前失败应分类为 `startup_gate_failure`，不能算 YouTube 业务失败。

## 证据

### UC-04 comments：现场 browser runtime 深挖

现场执行：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-diagnosis-fresh/uc04-comments \
  node dist/cli/main.js --profile uc04comments --json daemon start

SITEFLOW_HOME=/tmp/siteflow-youtube-diagnosis-fresh/uc04-comments \
  node dist/cli/main.js --profile uc04comments --json youtube comments h6UbVuHprZA --limit 5
```

随后用 browser runtime 底层能力执行：

- `eval` 读取 URL、title、readyState、scrollY、selector counts、登录/评论/不可用文案布尔值。
- targeted scroll 到 `#comments`。
- 4 次增量 scroll + wait。
- `network list --limit 300` 只保存 URL path、status、resourceType 摘要，不读 body。

证据分层：

- Envelope 层：daemon start exit code 0；comments 命令 exit code 0，顶层 `ok:true`；daemon stop exit code 0。
- 业务 receipt 层：`site: youtube`，`command: comments`，`ok:true`，`state: comments_collected`，`errors: []`，`commentsLength: 0`，`pageId: 2`，`sideEffects: []`。
- Runtime 层：URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`；title 为 `How to Use SiteFlow - YouTube`；`readyState: complete`。
- Source 层：`#comments` 容器存在；页面文本包含“评论”和登录相关文案；network 匹配摘要中有 YouTube 登录跳转和 `youtubei/v1/next`，但没有 comment/continuation URL 摘要。
- Extraction 层：adapter root 为 `ytd-comment-thread-renderer`；extract evidence `count: 0`；DOM 中 `ytd-comment-thread-renderer: 0`、`#content-text: 0`、`#author-text: 0`。

DOM 前后对比：

| 阶段 | scrollY | `#comments` | `ytd-comment-thread-renderer` | `#content-text` | `#author-text` |
| --- | ---: | ---: | ---: | ---: | ---: |
| comments 命令后 | 3356 | 1 | 0 | 0 | 0 |
| targeted scroll + 4 次增量后 | 3634 | 1 | 0 | 0 | 0 |

Network 摘要：

- 匹配条目：6
- `youtubei/v1/next`：1 条 HTTP 200 fetch
- `accounts.google.com/ServiceLogin` / `InteractiveLogin` / `signin/identifier`：存在 302/403 登录相关 document 请求
- comment URL：0
- continuation URL：0

结论：`not_loaded`。评论容器存在，但评论 thread/content/author 节点未 hydrate。根因边界在 Source/DOM hydration，不是已证明的 selector/parser 错误。

### UC-05 transcript：现场多样本复跑

现场执行：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-diagnosis-fresh/uc05-transcript \
  node dist/cli/main.js --profile uc05transcript --json daemon start
```

样本：

| 样本 | 顶层 | 业务 receipt | Runtime | Source | Extraction | 文件检查 | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `h6UbVuHprZA` | exit 0 / `ok:true` | `dataOk:false`，`TRANSCRIPT_UNAVAILABLE` | watch 页 title `How to Use SiteFlow - YouTube` | `trackCount: 1`，选中 `en`，`transcriptUnavailableHint:true` | `hasText:false`，`wrote:false`，无 `filePath` | 0 文件，0 bytes | `TRANSCRIPT_UNAVAILABLE` |
| `dQw4w9WgXcQ` | exit 0 / `ok:true` | `dataOk:false`，`TRANSCRIPT_UNAVAILABLE` | watch 页 title `Rick Astley - Never Gonna Give You Up...` | `trackCount: 6`，选中 `es-419`，`transcriptUnavailableHint:true` | `hasText:false`，`wrote:false`，无 `filePath` | 0 文件，0 bytes | `TRANSCRIPT_UNAVAILABLE` |
| `jNQXAC9IVRw` | exit 0 / `ok:true` | `dataOk:false`，`TRANSCRIPT_UNAVAILABLE` | watch 页 title `Me at the zoo - YouTube` | `trackCount: 2`，选中 `de`，`transcriptUnavailableHint:true` | `hasText:false`，`wrote:false`，无 `filePath` | 0 文件，0 bytes | `TRANSCRIPT_UNAVAILABLE` |

证据分层结论：

- Envelope 层：三个样本都正常返回，说明不是 CLI / daemon crash。
- 业务 receipt 层：三个样本都 `data.ok:false`，同一错误码 `TRANSCRIPT_UNAVAILABLE`。
- Runtime 层：三个样本都到达对应 watch 页。
- Source 层：三个样本都发现 caption track metadata。
- Extraction 层：三个样本都 `hasText:false`、`wrote:false`，没有 `filePath`。
- 文件/副作用层：输出目录无 transcript 文件，bytes 为 0，`sideEffects` 为空。

结论：`source_unavailable` / `TRANSCRIPT_UNAVAILABLE`。根因边界在 Source → Extraction：watch 页暴露 caption track metadata，但当前 runtime 下无法取得 caption body 文本。

### 启动门槛复核

原执行报告中的 `SITE_FLOW_STEP_FAILED` 发生在业务 receipt 前：

- 没有业务 `data`。
- 没有 pageId / URL / title。
- 没有 Source / Extraction evidence。

显式 `daemon start` 后，UC-01 搜索成功，UC-05 进入结构化业务失败。说明第一轮失败应归类为 `startup_gate_failure` / `environment_failure`，不是 YouTube 业务失败。

## 结论

| 场景 | 分类 | 结论 |
| --- | --- | --- |
| UC-04 comments 空数组 | `not_loaded` | `#comments` 容器存在，但评论 rows 没有 hydrate 到 DOM。 |
| UC-05 transcript 无文件 | `source_unavailable` / `TRANSCRIPT_UNAVAILABLE` | 多个样本都有 caption track，但 caption body 不可取。 |
| 业务 receipt 前失败 | `startup_gate_failure` | 显式 daemon start 后复跑，才能判断业务结果。 |
| UC-03 频道 404 | `source_unavailable` | `channel_collected` 仅代表快照采集，不代表频道有效。 |

## 根因

1. **UC-04 根因：Source/DOM hydration 边界。** 匿名临时 runtime 能到达 watch 页和评论容器，但没有加载出 `ytd-comment-thread-renderer`、`#content-text`、`#author-text`。登录相关网络/文案同时出现，提示可能受匿名会话、地区、登录或 YouTube 懒加载策略影响。
2. **UC-05 根因：Source → Extraction 边界。** caption track metadata 存在，但 caption body 获取为空，导致 adapter 正确返回 `TRANSCRIPT_UNAVAILABLE` 且不写空文件。
3. **执行 workflow 根因：Runtime startup gate。** 未显式启动 daemon 的失败不能混入业务判断。

## 暂不修改

- 暂不改 comments selector：现场 DOM 中目标 selector 节点数量为 0，不能证明 selector 错。
- 暂不把 UC-04 判定为真实 0 评论：页面有评论容器，但没有 rows。
- 暂不加盲目 retry：需要绑定明确条件，例如 comment rows 出现、不可用文案出现，或 bounded scroll budget 用尽。
- 暂不改 transcript 写文件逻辑：正文为空时不写空 XML 是正确行为。
- 暂不把 `captionTrackCount > 0` 当作 transcript 成功：必须同时满足 `hasText:true`、`wrote:true`、`filePath`、bytes > 0。

## 下一步

1. **comments 修复方向**
   - 在 adapter 中增加 bounded comments loading loop。
   - 每轮检查：`ytd-comment-thread-renderer`、`#content-text`、登录/不可用/评论关闭文案。
   - 若达到 budget 仍无 rows，receipt evidence 写明 `commentsStatus: not_loaded`、scroll attempts、selector counts。
   - 用认证 profile 或 known-public comments 样本复测，区分匿名限制和滚动策略。

2. **transcript 修复方向**
   - 增加低层 timedtext 探针，只记录 HTTP status、content-type、byte count、是否包含 caption node，不保存 URL/body。
   - 给 caption fetch 加有界 timeout。
   - 如果 timedtext 有 bytes 但 `hasText:false`，诊断为 extraction/fetch path 问题。
   - 如果 timedtext 也为空或不可用，保持 `source_unavailable` / `TRANSCRIPT_UNAVAILABLE`。

3. **workflow 修复方向**
   - 浏览器 adapter 用例执行前显式 `daemon start`。
   - 业务 receipt 前失败统一分类 `startup_gate_failure`。
