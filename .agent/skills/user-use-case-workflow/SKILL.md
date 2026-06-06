---
name: user-use-case-workflow
description: Use when asked to derive user stories, business use cases, acceptance scenarios, or later evaluation cases from code, CLI commands, adapters, APIs, MCP tools, or workflows.
---

# 用户用例 Workflow

## 概览

把实现代码转成用户视角的用户故事和可执行业务用例。核心规则：不要把“命令列表”当成功能文档。先识别真实用户想完成什么，再把代码支持的场景映射成有证据要求的业务用例。

## 什么时候使用

适用于这类请求：

- “根据这段代码写业务用例 / 用户故事”
- “先写用例，后面让人执行评估”
- “从 adapter / CLI / API 支持的场景整理验收用例”
- “站在用户视角看看这个功能能做什么”
- “把场景诊断 / 业务评估 workflow 固化成用例”

不适用于纯代码 review、bug 修复，或已经有完整产品规格且不需要从代码反推能力边界的场景。

## 输出位置

默认路径：

```text
docs/用户用例/YYYY-MM-DD-or-target-user-use-cases.md
```

规则：

- 必须创建或使用独立目录 `docs/用户用例/`。
- 不要把用户用例文件直接放在 `docs/` 根目录。
- 不要把用户用例放到 `docs/diagnostics/`；诊断目录只放已经完成的根因诊断报告。
- 一个目标模块、adapter 或 workflow 对应一个用例文档。

## 必走流程

1. **界定代码表面**
   - 阅读目标实现文件，以及直接相关的 probe、helper、types 文件。
   - 找出公开命令、选项、输入、输出、副作用和失败 receipt。
   - 只在需要文档风格或已知限制时查看已有文档。

2. **建立能力地图**
   - 表格列：能力、用户视角用途、命令/API、关键输入、关键输出、副作用。
   - 区分稳定只读能力和会写文件/产生副作用的能力。

3. **先写用户故事**
   - 使用“角色 + 目标 + 业务结果”。
   - 示例：“作为内容运营，我想按关键词获取视频候选，这样我可以建立选题池。”
   - 不要从函数名、selector 或内部步骤开始写。

4. **从用户故事推导业务用例**
   - 每个用例必须包含：对应用户故事、角色、目标、命令/API 模板、前置条件、输入约束、主流程、成功输出不变量、失败/空结果分类、评估重点。
   - 如果目标涉及浏览器自动化、网页采集、站点 adapter 或外部服务，必须包含页面、runtime、source、extraction 证据要求。

5. **分类空结果和失败结果**
   - 空数组不是结论。
   - 使用这类分类：`empty_result_confirmed`、`not_loaded`、`extraction_failed`、`source_unavailable`、`needs_more_evidence`。
   - 如果代码已有结构化错误码，保留原始错误码。

6. **添加评估 workflow**
   - 说明后续人工或评估执行者应该如何跑这些用例。
   - 涉及浏览器或 runtime 状态时，要求使用临时 profile 或隔离状态。
   - 禁止保存 cookie、token、浏览器 profile、完整 raw network dump 或私有 artifact。

7. **添加验收矩阵**
   - 每个用例一行。
   - 列：用例、最小可验收结果、必查证据。

8. **写明已知业务边界**
   - 明确哪些能力可靠、部分可用、有风险，或刻意不保证。
   - 不要承诺超过代码证据支持的能力。

## 浏览器 / Adapter 用例的证据层

| 层级 | 要检查什么 |
| --- | --- |
| Envelope 层 | exit code、顶层 `ok`、相关 HTTP status |
| 业务 receipt 层 | 内层 `ok`、`state`、`errors`、业务不变量字段 |
| Runtime 层 | URL、title、page id、当前 tab、scroll/readiness 状态 |
| Source 层 | DOM 文本、selector 数量、network/API payload、原始服务状态 |
| Extraction 层 | 解析行数、字段完整度、文件路径、字节数、副作用 |

如果第 N 层成功，但第 N+1 层缺少预期业务数据，用例必须把这个边界写成后续评估重点。

## 模板

````markdown
# <Target> 用户用例

范围：<覆盖的 commands/APIs/workflows>
非目标：<本文档不证明或不承诺什么>

## 能力地图

| 能力 | 用户视角用途 | 指令/API | 关键输入 | 关键输出 | 副作用 |
| --- | --- | --- | --- | --- | --- |

## 用户故事

### US-01：<用户故事标题>

作为<角色>，我想<能力>，这样我可以<业务结果>。

## 业务用例

### UC-01：<业务用例标题>

- 对应用户故事：US-01
- 主要角色：<role>
- 目标：<business goal>
- 指令/API 模板：

```bash
<带 placeholder 的可复制命令>
```

- 前置条件：<runtime/service/account/data prerequisites>
- 输入约束：<required args, limits, accepted forms>
- 主流程：
  1. <step>
- 成功输出不变量：
  - <observable invariant>
- 失败和空结果分类：
  - <classification and evidence>
- 评估重点：<后续评估者必须验证什么>

## 建议评估 Workflow

1. <step>

## 验收矩阵

| 用例 | 最小可验收结果 | 必查证据 |
| --- | --- | --- |

## 已知业务边界

- <boundary>
````

## 常见错误

| 错误 | 正确做法 |
| --- | --- |
| 只列命令，不写用户故事 | 先写角色和业务结果，再映射命令。 |
| 直接保存到 `docs/` | 保存到 `docs/用户用例/`。 |
| 把 `ok:true` 当成业务成功 | 检查 receipt 字段和业务不变量。 |
| 把空数组直接算成功 | 用 source/extraction 证据分类空结果原因。 |
| 承诺 selector/API 没有暴露的能力 | 把它写成已知业务边界。 |
| 混淆诊断报告和用户用例 | 诊断报告放 `docs/diagnostics/`；计划型用户用例放 `docs/用户用例/`。 |

## 这个技能要防止的基线失败

没有这套 workflow 时，agent 常见失败包括：

- 从命令列表直接跳到文档，没有用户故事；
- 把产物直接保存到 `docs/`；
- 漏掉 comments/search 这类空数组场景的空结果分类；
- 只看 channel/video 的 receipt 成功，不检查业务字段；
- 把“发现 transcript track”描述成“字幕下载成功”，忽略后续正文获取可能失败；
- 漏掉给后续人工执行的评估 workflow。
