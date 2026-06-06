---
name: user-use-case-execution
description: Use when asked to execute, validate, verify, evaluate, or parallel-run written user stories, business use cases, acceptance cases, adapter scenarios, CLI workflows, or browser automation use cases.
---

# 用户用例执行 Workflow

## 概览

把已经写好的用户故事 / 业务用例变成实际执行、分层验证和可复查报告。核心规则：业务用例执行不是“跑命令看 ok”。必须用隔离状态执行，按证据层分类，最后把稳定报告写回 `docs/用户用例/`。

## 什么时候使用

适用于这类请求：

- “基于这个用户用例去执行和验证”
- “按 workflow 跑这些用例”
- “并行执行用例并出报告”
- “验证 adapter / CLI / browser automation 的业务用例”
- “把用户故事 / 验收用例跑一遍并分类结果”

如果执行结果出现 `ok:true` 但空数组、字段缺失、内部 receipt 失败、DOM/network 矛盾，必须同时使用 `scene-diagnosis` 的分层判断法。不要在没有证据时改代码。

## 输出位置

最终报告默认写到：

```text
docs/用户用例/YYYY-MM-DD-<target>-execution.md
```

规则：

- 普通业务用例执行报告放 `docs/用户用例/`。
- 根因诊断报告才放 `docs/diagnostics/`。
- 临时 JSON 摘要、receipt 摘要、输出文件检查结果放 `/tmp/<project-or-target>-usecase-validation/`，不要放进仓库。
- 不要把 cookie、token、浏览器 profile、完整 DOM、完整 network dump、未整理 raw output 写进仓库。

## 必走流程

1. **读取用例文档**
   - 找出 UC 编号、目标、命令模板、前置条件、成功不变量、失败/空结果分类、验收矩阵。
   - 标记依赖关系：能并行的独立用例、必须串行的 page-id 复用 / 共享状态用例、最终汇总用例。

2. **准备隔离环境**
   - 使用临时 `SITEFLOW_HOME` / profile / 输出目录。
   - 浏览器或 daemon 类用例优先显式 `daemon start`，结束时显式 `daemon stop`。
   - 构建或准备 CLI 只做一次；不要让每个并行 worker 重复跑 project-wide build/test/lint/format。

3. **并行执行独立用例**
   - 用户要求“并行 / parallel”时，必须使用 `task` subagents，不能只并行 tool calls。
   - 每个 subagent 负责一个独立 UC 或一个必须内部串行的小组。
   - 每个 subagent 只写 `/tmp/.../results/<uc>.json` 结构化摘要，不编辑仓库。

4. **每个用例都按五层证据分类**
   - Envelope：exit code、顶层 `ok`、顶层 error。
   - 业务 receipt：内层 `data.ok`、`state`、`errors`、业务字段。
   - Runtime：URL、title、pageId、readyState、scroll、daemon/page 状态。
   - Source：DOM selector counts、页面文本布尔值、API/network payload 摘要、step evidence。
   - Extraction：数组长度、字段完整度、文件路径、字节数、副作用。

5. **空结果和失败必须分类**
   - `success`：业务不变量满足。
   - `empty_result_confirmed`：数据源明确为空。
   - `not_loaded`：容器或页面存在，但业务数据未加载。
   - `extraction_failed`：source 有数据，parser/selector 产物为空或缺字段。
   - `source_unavailable`：页面/服务不可用、blocked、404、登录/地区/年龄门槛。
   - `needs_more_evidence`：证据不足。
   - 保留代码自带错误码，例如 `NO_TRANSCRIPT`、`TRANSCRIPT_UNAVAILABLE`、`CAPTION_FETCH_FAILED`。

6. **处理启动门槛失败**
   - 如果命令在业务 receipt 前失败于 daemon/runtime startup，不能判定业务用例失败。
   - 先记录为 `environment_failure` 或 `startup_gate_failure`。
   - 用显式 `daemon start` 复跑一次；复跑结果才用于业务分类。

7. **汇总报告**
   - 报告必须包含：来源用例、执行日期、隔离状态、隐私边界、执行 workflow、总体结论表、每个 UC 的证据、验收矩阵复核、本轮发现、下一步。
   - 对失败或部分通过用例，写清楚“暂不修改”或“下一条最小证据”。

8. **验证报告**
   - 自检章节完整。
   - 自检每个 UC 都有分类。
   - 自检包含五层证据关键词。
   - 自检无未完成标记。
   - 自检没有 raw 私密 artifact 路径进入仓库报告。

## 并行拆分规则

| 类型 | 执行方式 |
| --- | --- |
| 搜索、单页元数据、频道快照、独立 transcript | 可并行，每个 UC 独立 temp profile。 |
| 评论懒加载 / DOM 交叉验证 | 可并行，但 worker 内部要先跑命令再做 DOM 摘要。 |
| `--page-id` 复用 | 同一个 worker 内串行，因为需要先拿 pageId。 |
| 分层评估 / 总结用例 | 所有摘要完成后由主 agent 汇总。 |
| 失败复跑 | 只复跑 startup/runtime gate，不重复所有已通过用例。 |

## 临时摘要 JSON 结构

每个 worker 写一个摘要，字段至少包含：

```json
{
  "uc": "UC-01",
  "command": "sanitized command string",
  "exitCode": 0,
  "classification": "success",
  "passed": true,
  "evidenceLayers": {
    "envelope": {},
    "businessReceipt": {},
    "runtime": {},
    "source": {},
    "extraction": {}
  },
  "invariants": {},
  "risks": [],
  "rawCommandSummary": {}
}
```

文件型用例还要包含 `fileCheck`：是否报告 `filePath`、是否存在、字节数、是否写入预期临时目录。

## 报告模板

````markdown
# <Target> 用户用例执行与验证报告

来源用例：<link>
执行日期：<date>
执行方式：<parallel/sequential + reruns>
隔离状态：<SITEFLOW_HOME/profile/output dirs>
隐私边界：<what was not saved>

## 执行 Workflow

1. <step>

## 总体结论

| 用例 | 结果 | 分类 | 结论 |
| --- | --- | --- | --- |

## UC-01：<title>

命令：

```bash
<sanitized command>
```

证据：

- Envelope 层：<exit/top-level ok>
- 业务 receipt 层：<data ok/state/errors>
- Runtime 层：<url/title/pageId>
- Source 层：<DOM/network/step evidence summary>
- Extraction 层：<count/fields/file/sideEffects>

结论：<passed/failed/partial + classification>

风险：<if any>

## 验收矩阵复核

| 用例 | 最小可验收结果 | 本轮结果 | 判定 |
| --- | --- | --- | --- |

## 本轮发现

1. <finding>

## 下一步

- <next action>
````

## 常见错误

| 错误 | 正确做法 |
| --- | --- |
| 只跑命令，不显式隔离状态 | 使用临时 `SITEFLOW_HOME`、profile、输出目录。 |
| 顶层 `ok:true` 就写通过 | 检查业务 receipt 和不变量。 |
| 空数组不分类 | 用 source/extraction 证据分类为空原因。 |
| startup 失败就判业务失败 | 显式 start daemon 后复跑，区分环境门槛和业务结果。 |
| 把临时摘要写进仓库 | 临时 JSON 放 `/tmp/.../results/`，仓库只放最终报告。 |
| 把 transcript track 当作下载成功 | 必须检查正文、filePath、bytes、write evidence。 |
| 用户要求并行但只顺序跑 | 使用 `task` subagents 并行执行独立 UC。 |

## 这个技能要防止的基线失败

没有这套 workflow 时，agent 容易：

- 在仓库里保存中间摘要 JSON；
- 漏掉显式 daemon lifecycle，导致 startup failure 被误判为业务失败；
- 对 `ok:true` + 空结果不做分层分类；
- 忽略 transcript / 文件型用例的副作用检查；
- 只写“执行成功/失败”，不给每个 UC 的证据层；
- 用户要求并行时没有使用 `task` subagents。
