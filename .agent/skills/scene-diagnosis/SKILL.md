---
name: scene-diagnosis
description: Use when a business scenario, site adapter, browser automation, CLI workflow, MCP tool, or API reports success but returns empty, partial, contradictory, failed-inner-receipt, or suspicious business results.
---

# 场景诊断

## 概览

诊断完整业务场景，不诊断单个表面症状。一个场景是用户真正关心的完整路径：命令/API → runtime → 页面/服务 → DOM/network/数据源 → extraction → 业务结果。

核心规则：**不要把任意单层 success flag 当业务成功。没有底层交叉证据前，不改代码、不改 selector、不加 retry。**

如果诊断可能引出代码修改，先使用 `systematic-debugging`。本技能只负责定位根因边界和给出最小下一步证据。

## 什么时候使用

适用于：

- `ok:true` 但数组为空、字段缺失、计数为 0、导出文件为空。
- exit code / envelope 成功，但内部 business receipt 失败。
- 浏览器自动化、网页采集、站点 adapter、CLI workflow、MCP tool、API 集成。
- 懒加载、selector 漂移、时序问题、登录/地区限制、服务商部分失败。
- 用户要求“是不是坏了”“问题在哪一层”“用底层能力交叉验证”“别猜，查根因”。

不适用于：

- 没有实际执行结果的纯代码 review。
- 明确编译错误、类型错误、语法错误的普通修复。
- 已经知道根因且只需要实现修复的任务。

## 诊断铁律

1. **先复现或复跑可疑场景。** 用户给的是执行结果时，不能只读报告就结束；对失败、空结果、内部 receipt 失败的场景，要尽量现场复跑。
2. **用项目自己的底层 runtime 能力。** 在 Siteflow 项目里，优先使用 Siteflow CLI 暴露的 browser runtime 能力，而不是通用外部 browser tool。
3. **先高层，后底层。** 先跑业务命令拿 receipt，再用 runtime / DOM / network / file 证据证明数据在哪一层消失。
4. **空结果必须分类。** 空数组、空文件、0 count 是诊断对象，不是结论。
5. **诊断阶段不修代码。** 只能写诊断报告和临时摘要；修复要等根因边界清楚后另起任务。

## Siteflow CLI 底层能力

Siteflow 场景诊断时，优先使用这些项目内 CLI 能力：

```bash
siteflow --json daemon start
siteflow --json <site> <command> ...
siteflow --json eval '<js expression>'
siteflow --json network list --limit <n>
siteflow --json network get <id>
siteflow --json network body <id> --part response   # 默认不要持久化 body
siteflow --json console list --limit <n>
siteflow --json browser pages
siteflow --json daemon stop
```

在本仓库源码执行时可用等价形式：

```bash
SITEFLOW_HOME=/tmp/<scenario> node dist/cli/main.js --profile <profile> --json ...
```

使用要求：

- 使用临时 `SITEFLOW_HOME`、专用 profile、临时输出目录。
- 显式 `daemon start`，结束后显式 `daemon stop`。
- `eval` 只返回摘要：URL、title、readyState、scrollY、document height、selector count、关键文案布尔值。
- `network list` 优先记录 endpoint 类型、method、status、resourceType、URL path；不要保存 headers、cookies、token、签名 URL、完整 query、完整 request/response body。
- 只有当 body shape 是定位根因必需时，才读取 body；默认只在临时目录保存脱敏摘要，不写入仓库。
- 文件型输出只检查 path、exists、bytes、是否能解析；不要把私密正文写进报告。

## 五层证据模型

| 层级 | 要回答的问题 | 证据 |
| --- | --- | --- |
| Envelope 层 | 命令/工具是否正常返回？ | exit code、顶层 `ok`、HTTP status、顶层 error |
| 业务 receipt 层 | 业务场景是否真的成功？ | 内层 `data.ok`、`state`、`errors`、业务不变量字段 |
| Runtime 层 | browser/client 是否到达预期状态？ | URL、title、page id、selected tab、readyState、scroll、daemon/page 状态 |
| Source 层 | 页面/服务是否暴露业务数据？ | DOM 节点、可访问性文本、network/API payload 摘要、服务端状态、文件元信息 |
| Extraction 层 | parser/selector/file writer 是否拿到数据？ | selector count、parsed rows、字段完整度、filePath、bytes、sideEffects |

判断规则：

- Envelope 成功但业务 receipt 失败 → `business_failure`，不要报告成功。
- Runtime 到达页面但 Source 没数据 → `not_loaded` / `source_unavailable` / `empty_result_confirmed`。
- Source 有数据但 Extraction 为空 → `extraction_failed` 或 timing 问题。
- 文件路径存在但 bytes 为 0 → 文件型业务失败或 extraction failure。
- 业务 receipt 前失败 → `startup_gate_failure` / `environment_failure`，显式 start 后复跑。

## 空结果分类

| 情况 | 报告为 |
| --- | --- |
| 数据源明确说 count 为 0 / no results | `empty_result_confirmed` |
| 容器存在，但业务数据节点没加载 | `not_loaded` |
| DOM/network/API 有数据，但 parser 返回空 | `extraction_failed` |
| 页面/服务 unavailable、blocked、404、登录/地区/年龄门槛 | `source_unavailable` |
| 业务 receipt 前 daemon/runtime 失败 | `startup_gate_failure` / `environment_failure` |
| 证据不足 | `needs_more_evidence` |

保留业务错误码，例如 `NO_TRANSCRIPT`、`TRANSCRIPT_UNAVAILABLE`、`CAPTION_FETCH_FAILED`。

## 必走 Workflow

1. **读场景和报告**
   - 明确用户真正要的业务结果。
   - 标记可疑项：空数组、0 count、内部 `data.ok:false`、文件为空、报告矛盾。

2. **准备隔离复跑**
   - 构建或准备 CLI 只做一次。
   - 临时 `SITEFLOW_HOME=/tmp/<scenario>`。
   - 专用 profile。
   - 显式 `daemon start`。

3. **复跑高层命令**
   - 保存脱敏 receipt 摘要：exit code、top-level ok、data.ok、state、errors、observations 关键字段、steps evidence。
   - 不保存 raw cookies、profile、完整 DOM、完整 network dump。

4. **调用底层 runtime 交叉验证**
   - `eval`：URL/title/readyState/scroll/selector counts/关键文案布尔值。
   - 懒加载：执行 targeted scroll/click/wait，再读取前后 DOM 差异。
   - `network list`：检查 API endpoint、status、continuation/next/comment/timedtext 信号。
   - `console list`：检查页面错误或 hook 输出。
   - 文件：检查 exists/bytes/parse 状态。

5. **分类根因边界**
   - 说明数据在哪一层从“存在”变成“缺失”。
   - 如果边界还不清楚，报告 `needs_more_evidence`，列下一条最小证据。

6. **写诊断报告**
   - 稳定结果写 `docs/diagnostics/YYYY-MM-DD-场景短名.md`。
   - 临时摘要可留在 `/tmp/<scenario>/results/*.json`，不要放仓库。

## 典型场景模板

### Adapter 返回空评论

1. 跑 adapter：记录 receipt 中 `comments.length` 和 extract evidence count。
2. 用 `eval` 统计：`#comments`、`ytd-comment-thread-renderer`、`#content-text`、`#author-text`。
3. targeted scroll 到 `#comments`，循环 scroll/wait，再统计同一组 selector。
4. 用 `network list` 查 `youtubei/v1/next`、comment、continuation 请求摘要。
5. 判断：
   - targeted scroll 后评论出现 → wait/scroll 策略问题。
   - DOM 有 thread/content 但 adapter 为空 → extraction/selector 问题。
   - 容器有但 rows 一直没有 → `not_loaded`。
   - 页面明确 disabled / blocked / login gate → `source_unavailable` 或 `empty_result_confirmed`。

### Transcript 有 track 但无文件

1. 跑 transcript 命令：记录 `data.ok`、`state`、`errors[].code`、track count、selectedTrack、`hasText`、`wrote`、`filePath`、bytes。
2. 用比较样本复跑，区分单个视频不可用和通道普遍失败。
3. 如需更底层，只做脱敏 timedtext 探针：status、content-type、byte count、是否含 caption node；不保存 signed URL 或 body。
4. 判断：
   - track count 0 → `NO_TRANSCRIPT`。
   - track 有但 body 空 → `TRANSCRIPT_UNAVAILABLE` / `source_unavailable`。
   - body 有 bytes 但 parser 空 → `extraction_failed`。
   - fetch timeout / non-2xx → `CAPTION_FETCH_FAILED`。

## 报告模板

```markdown
# <场景> 场景诊断

诊断对象：<link or command>
现场执行：<是否复跑；用到哪些 CLI runtime 能力>
隐私边界：<未保存什么>

## 问题

<观察到的业务矛盾>

## 证据

- Envelope 层：<exit/top-level ok/status>
- 业务 receipt 层：<inner ok/state/errors/output count>
- Runtime 层：<URL/title/page/page state>
- Source 层：<DOM/network/file/API 摘要>
- Extraction 层：<selector/parser/file counts>

## 结论

<classification>

## 根因

<一句话说明数据在哪个边界从“存在”变成“缺失”>

## 暂不修改

<哪些诱人的修复尚未被证实>

## 下一步

<最小验证修复，或还缺的下一条证据>
```

## 存放约定

- 稳定诊断报告：`docs/diagnostics/YYYY-MM-DD-场景短名.md`。
- 一个诊断场景一个 Markdown 文件。
- 必须包含：问题、证据、结论、根因、暂不修改、下一步。
- 临时摘要：`/tmp/<scenario>/results/*.json`。
- 不要把临时日志、缓存、browser profile、未整理 raw dump 放进 `docs/diagnostics/`。

## 常见错误

| 错误 | 正确做法 |
| --- | --- |
| 只读执行报告就下结论 | 对可疑项现场复跑，除非证据已不可再取得。 |
| 用通用 browser 绕过项目 runtime | Siteflow 场景优先用 CLI 的 `eval`、`network list`、`browser pages`。 |
| 把顶层 `ok:true` 当业务成功 | 必须检查内部 receipt 和业务不变量。 |
| 没查 DOM/network 就怪 selector | 先证明数据是否存在，以及在哪一层消失。 |
| 空数组不分类 | 区分真实为空、未加载、不可用、提取失败。 |
| startup 失败算业务失败 | 显式 daemon start 后复跑，业务 receipt 前失败单独分类。 |
| 保存 raw network body / token / signed URL | 只保存脱敏 metadata，必要 body 只进临时私密位置。 |
| 没找到根因就加 retry | 先确认哪一层慢、缺失或失败。 |

## 快速检查表

- 是否现场复跑了失败/可疑项？
- 是否使用项目自己的底层 runtime 能力？
- 是否有 Envelope、业务 receipt、Runtime、Source、Extraction 五层证据？
- 是否至少有两个独立底层信号交叉验证？
- 空输出是否已分类？
- 是否明确写出“暂不修改”？
- 报告是否写入 `docs/diagnostics/`？
