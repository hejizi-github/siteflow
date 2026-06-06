# YouTube Adapter 业务用例

本文档基于 `src/sites/youtube.ts` 和 `src/sites/probes/youtube.ts` 梳理 YouTube adapter 的用户故事、业务用例和后续人工评估 workflow。

范围：`siteflow youtube` 下的 `search`、`video`、`channel`、`comments`、`transcript` 五类只读能力，以及全部指令共享的 `--page-id` 页面复用能力。

非目标：本文不是执行结果报告，也不承诺 YouTube 页面总能暴露评论或字幕正文。执行评估时必须同时检查顶层 envelope、业务 receipt、steps evidence 和业务字段。

## 能力地图

| 能力 | 用户视角用途 | 指令 | 关键输入 | 关键输出 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| 搜索视频 | 按关键词发现候选视频 | `siteflow youtube search <keyword> --limit <n>` | 关键词、返回数量 | `observations.videos[]`，包含 `id`、`title`、`href`、`channel`、`metadata`、`text` | 无 |
| 视频元数据 | 读取单个 watch 页的结构化信息 | `siteflow youtube video <target>` | 视频 URL、`youtu.be` URL 或视频 ID | `observations.video`，包含标题、频道、描述、时长、观看数、发布日期、分类 | 无 |
| 频道快照 | 查看频道页当前可见页面文本 | `siteflow youtube channel <target>` | handle 或频道 URL | `observations.title`、`heading`、`text` | 无 |
| 可见评论 | 采集当前页面能加载出来的评论 | `siteflow youtube comments <target> --limit <n>` | 视频 target、评论数量 | `observations.comments[]`，包含作者、正文、点赞数、时间 | 无 |
| 字幕 transcript | 发现字幕 track 并在正文可取时下载 XML | `siteflow youtube transcript <target> --out <dir>` | 视频 target、输出目录 | 成功时 `filePath`、`bytes`；失败时 `errors[].code` | 成功时写文件 |
| 页面复用 | 将多个操作绑定到同一个 browser tab | 任意 YouTube 指令加 `--page-id <id>` | 已存在 page id | 返回同一 `pageId` 对应的 receipt | 取决于具体指令 |

## 用户故事

### US-01：内容运营按主题发现候选视频

作为内容运营，我想按关键词获取一批 YouTube 视频候选，这样我可以快速建立选题池，而不是手动复制搜索结果。

### US-02：研究员核验单个视频的基础信息

作为市场研究员，我想输入视频 ID 或 URL 后得到标题、频道、描述、时长、观看数和发布日期，这样我可以把视频加入竞品研究表。

### US-03：运营同学快速判断频道是否值得继续分析

作为运营同学，我想输入频道 handle 后看到频道页标题和正文快照，这样我可以初步判断频道定位、订阅规模和内容方向。

### US-04：社媒分析师采集视频下方的可见评论

作为社媒分析师，我想采集视频页面当前可见的评论文本、作者、点赞数和时间，这样我可以做轻量情绪和主题归纳。

### US-05：内容分析师下载可用字幕

作为内容分析师，我想下载视频可用字幕 XML，这样我可以把字幕交给后续文本清洗、摘要或关键词提取流程。

### US-06：自动化执行者复用同一个浏览器页面

作为自动化执行者，我想对同一个已打开 tab 连续执行视频信息、评论、字幕等读取操作，这样我可以减少重复开页和页面上下文漂移。

### US-07：评估人员区分“命令成功”和“业务成功”

作为评估人员，我想把顶层命令返回、业务 receipt、steps evidence 和业务字段拆开检查，这样我不会把 `ok:true` 但业务为空或失败的结果误判为成功。

## 业务用例

### UC-01：关键词搜索候选视频

- 对应用户故事：US-01
- 主要角色：内容运营、选题研究员
- 目标：给定关键词，返回去重后的视频候选列表。
- 指令模板：

```bash
siteflow --json youtube search "<keyword>" --limit <n>
```

- 前置条件：本机 Siteflow 可启动 browser runtime；YouTube 搜索页可访问。
- 输入约束：
  - `keyword` 必填。
  - `--limit` 默认 20，有效范围 1 到 50。
- 主流程：
  1. 打开 `https://www.youtube.com/results?search_query=<keyword>`。
  2. 等待搜索结果加载。
  3. 提取页面候选视频节点。
  4. 按视频 ID 去重并裁剪到请求数量。
- 成功输出不变量：
  - 顶层 envelope `ok` 为 `true`。
  - `data.site` 为 `youtube`。
  - `data.command` 为 `search`。
  - `data.ok` 为 `true`。
  - `data.state` 为 `search_collected`。
  - `observations.videos` 是数组。
  - 每个有效视频至少应包含 `id` 和 `href`。
  - `observations.sideEffects` 为 `[]`。
- 空结果分类：
  - 如果 `steps.extract_search_results.evidence.count` 为 0 且 `videos.length` 为 0，记录为 `empty_result_confirmed` 或 `needs_more_evidence`，需要结合页面 DOM 判断。
  - 如果 DOM 有视频节点但 `videos` 为空，记录为 `extraction_failed`。
- 评估重点：搜索结果数量、ID 去重、limit 是否生效、返回字段是否足够支持选题池入库。

### UC-02：读取视频元数据

- 对应用户故事：US-02
- 主要角色：市场研究员、内容分析师
- 目标：给定视频 URL、短链 URL 或视频 ID，读取 watch 页元数据。
- 指令模板：

```bash
siteflow --json youtube video "<target>"
```

- 前置条件：目标视频页面可访问。
- 输入约束：
  - `target` 支持 watch URL、`youtu.be` URL 或视频 ID。
  - 如果 `target` 能解析出视频 ID，adapter 会打开标准 watch URL。
  - 如果不能解析出视频 ID，adapter 会按原始 target 打开。
- 主流程：
  1. 解析视频 ID。
  2. 打开目标 watch 页。
  3. 等待页面加载。
  4. 从 `ytInitialPlayerResponse` 和 DOM fallback 中提取视频详情。
- 成功输出不变量：
  - `data.command` 为 `video`。
  - `data.state` 为 `video_collected`。
  - `observations.target` 等于用户输入。
  - 可解析 ID 时，`observations.id` 应存在。
  - `observations.video` 是对象，字段可包含 `id`、`title`、`channel`、`description`、`lengthSeconds`、`viewCount`、`publishDate`、`category`。
  - `observations.text` 是页面可见文本快照，不应作为稳定结构化字段使用。
  - `observations.sideEffects` 为 `[]`。
- 失败和风险：
  - 页面可能正常打开但不是有效视频页。不能只看 `data.ok`，还要检查 `observations.video.id` 或 step evidence 的 `hasVideoId`。
  - 描述、观看数、分类等字段取决于 YouTube 页面暴露的数据，可能为空。
- 评估重点：ID 解析、URL 标准化、核心 metadata 字段是否满足研究表入库。

### UC-03：读取频道页面快照

- 对应用户故事：US-03
- 主要角色：频道运营、竞品研究员
- 目标：输入频道 handle 或 URL，得到频道页当前可见文本快照。
- 指令模板：

```bash
siteflow --json youtube channel "<target>"
```

- 前置条件：目标频道页可访问。
- 输入约束：
  - `target` 如果以 `http` 开头，则按 URL 打开。
  - 非 URL target 会补成 `https://www.youtube.com/@<target>`。
  - 已带 `@` 的 handle 不会重复添加 `@`。
- 主流程：
  1. 规范化频道 target。
  2. 打开频道页。
  3. 等待频道页加载。
  4. 提取 `url`、`title`、`heading` 和最多 5000 字符的 `text`。
- 成功输出不变量：
  - `data.command` 为 `channel`。
  - `data.state` 为 `channel_collected`。
  - `observations.target` 等于用户输入。
  - `observations.title`、`observations.text` 是调用方判断业务有效性的主要字段。
  - `observations.sideEffects` 为 `[]`。
- 失败和风险：
  - 404 或不可用页面也可能返回业务 `ok:true`，因为 adapter 当前只表示页面快照已采集。
  - `heading` 不是稳定必填字段。评估时不要把 `heading` 为空直接判为 adapter 失败。
- 空结果分类：
  - `title` 显示 404 且 `text` 为空时，应记录为 `source_unavailable`。
  - 页面正文存在但 `heading` 为空时，按有效快照继续评估，不要把可选字段缺失当成整体失败。
- 评估重点：频道 target 规范化、404 识别、正文快照是否足以支持人工初筛。

### UC-04：采集当前可见评论

- 对应用户故事：US-04
- 主要角色：社媒分析师、社区运营
- 目标：采集视频页当前能加载出的评论列表，用于轻量评论分析。
- 指令模板：

```bash
siteflow --json youtube comments "<target>" --limit <n>
```

- 前置条件：目标视频页可访问；评论区对当前地区、登录状态和页面状态可见。
- 输入约束：
  - `target` 支持 watch URL、`youtu.be` URL 或视频 ID。
  - `--limit` 默认 50，有效范围 1 到 200。
- 主流程：
  1. 打开目标 watch 页。
  2. 等待页面加载。
  3. 滚动页面触发评论区加载。
  4. 从 `ytd-comment-thread-renderer` 提取评论。
- 成功输出不变量：
  - `data.command` 为 `comments`。
  - `data.state` 为 `comments_collected`。
  - `observations.comments` 是数组。
  - 每条评论包含 `author`、`text`、`likes`、`time` 字段。
  - `observations.sideEffects` 为 `[]`。
- 空结果分类：
  - 评论区 DOM 未加载，`comments.length` 为 0：`not_loaded`。
  - DOM 有 `ytd-comment-thread-renderer`，但 parser 返回空：`extraction_failed`。
  - YouTube 页面显示评论关闭、0 条评论或资源不可用：`empty_result_confirmed` 或 `source_unavailable`。
  - 证据不足时：`needs_more_evidence`。
- 评估重点：不要把空评论数组直接判为成功或失败。必须对照 steps evidence、DOM 评论节点数量和页面文案。

### UC-05：发现并下载字幕 transcript

- 对应用户故事：US-05
- 主要角色：内容分析师、数据处理人员
- 目标：发现视频字幕 tracks，并在字幕正文可读取时写入本地 XML 文件。
- 指令模板：

```bash
siteflow --json youtube transcript "<target>" --out "<dir>"
```

- 前置条件：目标视频页可访问；页面暴露 caption tracks；字幕正文 URL 可读取。
- 输入约束：
  - `target` 支持 watch URL、`youtu.be` URL 或视频 ID。
  - `--out` 可选，默认写入 `downloads/youtube`。
- 主流程：
  1. 打开目标 watch 页。
  2. 等待页面加载。
  3. 从 `ytInitialPlayerResponse.captions` 发现字幕 tracks。
  4. 优先选择英文 track，其次按当前排序选择可用 track。
  5. 请求 track 的 `baseUrl` 获取字幕 XML。
  6. 如果有正文，写入 `<out>/<video-id>.xml`。
- 成功输出不变量：
  - `data.command` 为 `transcript`。
  - `data.ok` 为 `true`。
  - `data.state` 为 `transcript_collected`。
  - `observations.tracks` 至少一条。
  - `observations.selectedTrack` 存在。
  - `observations.filePath` 指向写入文件。
  - `observations.bytes` 大于 0。
  - `observations.sideEffects` 为 `["file_download"]`。
- 业务失败输出：
  - 无字幕 track：`data.ok:false`，`errors[].code` 为 `NO_TRANSCRIPT`。
  - 有 track 但正文不可用：`data.ok:false`，`errors[].code` 为 `TRANSCRIPT_UNAVAILABLE`。
  - 请求字幕失败：`data.ok:false`，`errors[].code` 为 `CAPTION_FETCH_FAILED`。
- 评估重点：顶层 envelope 可能成功，但业务 receipt 失败。评估必须检查 `data.ok`、`errors[].code`、`steps.fetch_caption_text.evidence.hasText` 和 `steps.write_transcript_file.evidence.wrote`。

### UC-06：复用已有页面执行连续读取

- 对应用户故事：US-06
- 主要角色：自动化执行者、评估人员
- 目标：对已有 browser page 执行 YouTube 指令，减少重复开 tab。
- 指令模板：

```bash
siteflow --json youtube video "<target>" --page-id <id>
siteflow --json youtube comments "<target>" --page-id <id> --limit 20
siteflow --json youtube transcript "<target>" --page-id <id> --out "<dir>"
```

- 前置条件：`siteflow browser pages` 中已有可用 page id；该 page 属于同一 profile。
- 输入约束：
  - `--page-id` 适用于所有 YouTube 指令。
  - page id 必须是当前 runtime 可访问的页面。
- 主流程：
  1. 获取或确认已有 page id。
  2. 对同一 target 使用 `--page-id` 执行一个或多个指令。
  3. 检查每个 receipt 的 `observations.pageId` 是否与输入一致。
- 成功输出不变量：
  - 每个 receipt 的 page evidence 保持同一个 page id。
  - 每个指令仍按自己的业务不变量判断成功或失败。
- 失败和风险：
  - 复用页面只保证绑定到指定 tab，不保证业务数据存在。
  - 页面可能被前一个指令导航到新 URL，后续指令必须重新检查 `url` 和 `title`。
- 评估重点：page id 是否稳定、页面 URL 是否符合 target、连续执行是否污染后续结果。

### UC-07：业务 receipt 分层评估

- 对应用户故事：US-07
- 主要角色：QA、场景诊断执行者、业务验收人员
- 目标：用统一 workflow 判断一次 YouTube adapter 调用是否真正满足业务目标。
- 适用范围：全部 YouTube 指令。
- 主流程：
  1. 检查 envelope 层：CLI exit code 和顶层 `ok`。
  2. 检查业务 receipt 层：`data.ok`、`data.state`、`data.errors`。
  3. 检查 runtime 层：`observations.pageId`、`observations.url`、`observations.title`。
  4. 检查 source 层：steps evidence、页面正文、DOM 或 network 证据。
  5. 检查 extraction 层：数组长度、字段完整度、文件字节数。
  6. 给出分类：`success`、`empty_result_confirmed`、`not_loaded`、`extraction_failed`、`source_unavailable`、`needs_more_evidence`。
- 成功输出不变量：
  - 报告不只引用一个 success flag。
  - 空数组必须分类。
  - 文件型输出必须检查文件路径和字节数。
  - mutating side effect 必须和 `sideEffects` 对齐。
- 评估重点：防止把“命令正常返回”误判为“业务完成”。

## 建议评估 Workflow

后续人工执行和评估时，建议按这个 workflow 跑每个用例：

1. 选择目标样本。
   - known-good：预期有搜索结果、有效视频 metadata 或可访问频道。
   - known-empty：预期评论为空、无字幕或页面不可用。
   - failing target：404 频道、无效视频 ID、字幕不可取视频。
2. 用临时 `SITEFLOW_HOME` 和专用 profile 执行命令，避免污染本地默认 profile。
3. 保存顶层 JSON envelope 摘要，不保存 cookie、token、完整浏览器 profile 或未整理 raw dump。
4. 对照本文件的“成功输出不变量”和“失败/空结果分类”。
5. 如出现 `ok:true` 但业务字段为空，补充 DOM、页面文本、steps evidence 或 network 证据后再下结论。
6. 把稳定评估结果写入独立报告。场景诊断类结果写入 `docs/diagnostics/`，普通业务验证报告写入 `docs/`。

## 验收矩阵

| 用例 | 最小可验收结果 | 必查证据 |
| --- | --- | --- |
| UC-01 搜索候选视频 | 返回数组，limit 生效，视频 ID 去重 | `videos.length`、`steps.extract_search_results.evidence.count` |
| UC-02 视频元数据 | 返回有效 `video.id` 和标题/频道等核心字段 | `observations.video`、`hasVideoId` |
| UC-03 频道快照 | 返回可读 `title` 或 `text`，404 可被识别 | `observations.title`、`observations.text` |
| UC-04 可见评论 | 返回评论数组，或对空数组给出分类 | `comments.length`、DOM 评论节点数、extract evidence |
| UC-05 字幕 transcript | 成功写 XML，或返回结构化业务失败 | `data.ok`、`errors[].code`、`filePath`、`bytes`、`wrote` |
| UC-06 页面复用 | 多个指令复用同一 `pageId` 且业务判断独立 | `observations.pageId`、URL/title |
| UC-07 分层评估 | 每次结果都有明确业务分类 | envelope、receipt、runtime、source、extraction 五层证据 |

## 已知业务边界

- 所有 YouTube adapter 能力都是只读，除 transcript 成功下载文件外不产生业务副作用。
- `search` 和 `video` 是当前最适合作为稳定业务能力的场景。
- `channel` 是页面快照能力，不是频道结构化数据库。404 或异常页面可能仍返回 `channel_collected`。
- `comments` 表达的是“当前可见评论采集”，不是“保证下载评论”。空数组需要分类诊断。
- `transcript` 表达的是“发现字幕并尝试下载正文”。发现 track 不等于字幕正文一定可取。
- `--page-id` 是 runtime 绑定能力，不改变具体业务指令的成功标准。
