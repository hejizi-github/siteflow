# YouTube 用户用例执行与验证报告

来源用例：[`docs/用户用例/youtube-business-use-cases.md`](./youtube-business-use-cases.md)  
执行日期：2026-06-05  
执行方式：并行执行 UC-01 到 UC-05/UC-06，随后对启动门槛失败的 UC-01、UC-05 做显式 daemon start 复跑。  
隔离状态：所有运行使用 `/tmp/siteflow-youtube-usecase-validation/*` 下的临时 `SITEFLOW_HOME` 和专用 profile。  
隐私边界：报告只保留结构化摘要；未写入 cookie、token、浏览器 profile、完整 DOM 文本、完整 network dump 或私有 artifact。

## 执行 Workflow

1. 先执行 `npm run build`，确认 `dist/cli/main.js` 已生成。
2. 为每个用例分配独立临时目录和 profile。
3. 并行执行：
   - UC-01：搜索候选视频。
   - UC-02 + UC-06：视频元数据和 `--page-id` 复用。
   - UC-03：频道快照和 404 负例。
   - UC-04：评论采集，并用 DOM 摘要交叉验证。
   - UC-05：字幕 transcript。
4. 第一轮发现 UC-01、UC-05 在未显式启动 daemon 时失败于 `SITE_FLOW_STEP_FAILED`，没有业务 receipt。
5. 对 UC-01、UC-05 做显式 `daemon start` 后复跑，确认失败边界是启动门槛，不是搜索/字幕业务本身。
6. 按 Envelope、业务 receipt、Runtime、Source、Extraction 五层证据分类结果。

## 总体结论

| 用例 | 结果 | 分类 | 结论 |
| --- | --- | --- | --- |
| UC-01 搜索候选视频 | 通过 | `success` | 显式启动 daemon 后返回 3 条候选视频，limit 生效，搜索能力可用。 |
| UC-02 视频元数据 | 通过 | `success` | 返回有效 `video.id`、标题、频道、时长、观看数、发布日期。 |
| UC-03 频道快照 | 通过但需业务判别 | `valid_channel_snapshot` / `source_unavailable` | 有效频道可返回正文快照；404 频道也会 `data.ok:true`，调用方必须检查 `title/text`。 |
| UC-04 可见评论 | 未通过业务验收 | `not_loaded` | 命令 receipt 成功但评论数组为空；DOM 有 `#comments` 容器，无评论 thread/content 节点。 |
| UC-05 字幕 transcript | 结构化业务失败 | `TRANSCRIPT_UNAVAILABLE` | 命令顶层成功、业务 receipt 失败；发现 1 条英文自动字幕 track，但正文不可用，未写文件。 |
| UC-06 页面复用 | 通过 | `success` | `--page-id 2` 复用后仍返回同一 pageId 和有效视频元数据。 |
| UC-07 分层评估 | 通过 | `success` | 本轮所有用例均按五层证据分类；没有把顶层 `ok` 直接当业务成功。 |

## UC-01：关键词搜索候选视频

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc01-rerun \
  node dist/cli/main.js --profile uc01rerun --json daemon start

SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc01-rerun \
  node dist/cli/main.js --profile uc01rerun --json youtube search "siteflow cli" --limit 3
```

证据：

- Envelope 层：`exitCode: 0`，顶层 `ok:true`。
- 业务 receipt 层：`site: youtube`，`command: search`，`state: search_collected`，`errors: []`。
- Runtime 层：URL 为 `https://www.youtube.com/results?search_query=siteflow+cli`，title 为 `siteflow cli - YouTube`。
- Source 层：`extract_search_results` step `count: 9`，`requestedLimit: 3`。
- Extraction 层：返回 3 条视频摘要，ID 分别为 `SqoFY0bQJDQ`、`h6UbVuHprZA`、`hgFRRwIZ5Lw`。

结论：通过。搜索用例满足“返回数组、limit 生效、视频 ID 去重”的最小验收标准。

风险：第一轮未显式启动 daemon 时失败为 `SITE_FLOW_STEP_FAILED`。后续人工执行 workflow 应先显式启动 daemon，或把启动失败单独归类为 runtime startup gate。

## UC-02：读取视频元数据

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc02-uc06 \
  node dist/cli/main.js --profile uc02uc06 --json youtube video h6UbVuHprZA
```

证据：

- Envelope 层：`exitCode: 0`，顶层 `ok:true`。
- 业务 receipt 层：`site: youtube`，`command: video`，`state: video_collected`，`errors: []`。
- Runtime 层：`pageId: 2`，URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`，title 为 `How to Use SiteFlow - YouTube`。
- Source 层：`extract_video_details` step `hasVideoId:true`。
- Extraction 层：`video.id: h6UbVuHprZA`，title 为 `How to Use SiteFlow`，channel 为 `SiteMax | The Jobsite Management Platform`，`lengthSeconds: 148`，`viewCount: 307`，`publishDate: 2024-03-22T13:32:24-07:00`。

结论：通过。视频元数据用例满足核心字段验收标准。

风险：第一轮无显式 daemon start 的直接命令曾失败；复跑后业务链路正常。

## UC-03：读取频道页面快照

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc03 \
  node dist/cli/main.js --profile uc03 --json youtube channel "@YouTube"

SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc03 \
  node dist/cli/main.js --profile uc03 --json youtube channel "@SiteMaxSystems"
```

有效频道证据：

- Envelope 层：顶层 `ok:true`。
- 业务 receipt 层：`command: channel`，`state: channel_collected`，`errors: []`。
- Runtime 层：`pageId: 3`，steps 均成功。
- Source 层：URL 为 `https://www.youtube.com/@YouTube`，title 为 `YouTube - YouTube`。
- Extraction 层：`titlePresent:true`，`textLength: 4633`，`headingPresent:false`，`sideEffects: []`。

负例证据：

- 输入：`@SiteMaxSystems`。
- 顶层和业务 receipt 仍为成功：`data.ok:true`，`state: channel_collected`。
- Source/Extraction 层显示业务不可用：title 为 `404 Not Found`，`textLength: 0`。

结论：通过，但必须保留业务判别。`channel_collected` 只表示页面快照采集完成，不表示频道有效。404 目标应按 `source_unavailable` 分类。

风险：`heading` 实测为空，不能作为必填验收字段。

## UC-04：采集当前可见评论

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc04 \
  node dist/cli/main.js --profile uc04 --json youtube comments h6UbVuHprZA --limit 5
```

证据：

- Envelope 层：`exitCode: 0`，顶层 `ok:true`。
- 业务 receipt 层：`command: comments`，`state: comments_collected`，`errors: []`，`sideEffects: []`。
- Runtime 层：`pageId: 2`，URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`，eval 后 title 为 `How to Use SiteFlow - YouTube`。
- Source 层：`scroll_to_comments` step `scrolled:true`；`extract_comments` evidence 为 `count: 0`、`limit: 5`、root 为 `ytd-comment-thread-renderer`。
- DOM 交叉验证：`#comments: 1`，`ytd-comment-thread-renderer: 0`，`#content-text: 0`，`readyState: complete`，`scrollY: 1436`，`documentHeight: 4403`。
- Extraction 层：`comments.length: 0`。

结论：未通过业务验收，分类为 `not_loaded`。原因是页面已有评论容器，但没有评论 thread 和正文节点，不能证明真实没有评论，也不是 parser 已经漏提 DOM 中存在的评论。

暂不修改：没有证据证明 selector 错误；本轮不应直接改 selector 或加 retry。下一步应做 targeted scroll / wait 和 network continuation 验证。

## UC-05：发现并下载字幕 transcript

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc05-rerun \
  node dist/cli/main.js --profile uc05rerun --json youtube transcript h6UbVuHprZA \
  --out /tmp/siteflow-youtube-usecase-validation/transcripts/uc05-rerun
```

证据：

- Envelope 层：`exitCode: 0`，顶层 `ok:true`。
- 业务 receipt 层：`data.ok:false`，`state: transcript_failed`，error code 为 `TRANSCRIPT_UNAVAILABLE`。
- Runtime 层：目标视频 title 为 `How to Use SiteFlow - YouTube`。
- Source 层：`discover_caption_tracks` step `trackCount: 1`，`transcriptUnavailableHint:true`。
- Extraction 层：`fetch_caption_text` step `hasText:false`，`languageCode: en`；`write_transcript_file` step `wrote:false`。
- 文件副作用：输出目录存在，但 `filesWritten: 0`，`totalBytes: 0`，receipt 未报告 `filePath`。

结论：未通过“成功写 XML”验收，但通过“结构化业务失败”验收。分类为 `TRANSCRIPT_UNAVAILABLE`。这不是命令崩溃，也不是文件写入失败；边界在 caption track 存在但正文不可取。

风险：进程 exit code 为 0，但业务 receipt `data.ok:false`。调用方必须以业务 receipt 为准。

## UC-06：复用已有页面执行连续读取

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-usecase-validation/uc02-uc06 \
  node dist/cli/main.js --profile uc02uc06 --json youtube video h6UbVuHprZA --page-id 2
```

证据：

- 初始视频读取返回 `pageId: 2`。
- 复用命令输入 `--page-id 2`。
- 复用后 receipt 仍返回 `pageId: 2`。
- 复用后 `video.id: h6UbVuHprZA`，title/channel/metadata 仍有效。

结论：通过。`--page-id` 能绑定已有 page 并保持业务读取有效。

风险：`browser pages` 在 stop 前摘要为 `pageCount: 0`，但 receipt 自身证明了 `pageId` 复用。后续如果要验证 runtime 页签列表，需要在 stop 前增加更明确的页面列表时机检查。

## UC-07：业务 receipt 分层评估

本轮所有用例都按五层证据评估，结论如下：

- 没有把顶层 `ok:true` 当成业务成功。
- UC-03 证明了 `channel_collected` 可能对应 404 页面。
- UC-04 对空评论数组做了 DOM 交叉验证，并分类为 `not_loaded`。
- UC-05 证明了顶层 `ok:true` 和 exit code 0 可以同时伴随 `data.ok:false` 的业务失败。
- UC-01、UC-02、UC-06 通过业务不变量验证，而不是只看 success flag。

结论：通过。UC-07 workflow 能识别顶层成功、业务失败、空数组和外部服务不可用之间的差异。

## 验收矩阵复核

| 用例 | 最小可验收结果 | 本轮结果 | 判定 |
| --- | --- | --- | --- |
| UC-01 搜索候选视频 | 返回数组，limit 生效，视频 ID 去重 | 返回 3 条，limit 3 生效，source count 9 | 通过 |
| UC-02 视频元数据 | 返回有效 `video.id` 和标题/频道等核心字段 | `video.id`、title、channel、length/view/date 均存在 | 通过 |
| UC-03 频道快照 | 返回可读 `title` 或 `text`，404 可被识别 | 有效频道 `textLength 4633`；负例 title `404 Not Found` | 通过 |
| UC-04 可见评论 | 返回评论数组，或对空数组给出分类 | 空数组已分类为 `not_loaded` | 部分通过：分类通过，采集评论未通过 |
| UC-05 字幕 transcript | 成功写 XML，或返回结构化业务失败 | 返回 `TRANSCRIPT_UNAVAILABLE`，未写文件 | 通过结构化失败验收，未通过下载成功验收 |
| UC-06 页面复用 | 多个指令复用同一 `pageId` 且业务判断独立 | 输入和输出均为 `pageId 2`，视频仍有效 | 通过 |
| UC-07 分层评估 | 每次结果都有明确业务分类 | 全部用例有分层分类 | 通过 |

## 本轮发现

1. **显式启动 daemon 是更稳定的执行前置条件。** UC-01 和 UC-05 第一轮未显式启动时失败于 `SITE_FLOW_STEP_FAILED`，复跑后进入业务链路。
2. **搜索、视频元数据、页面复用是当前稳定通过能力。** 它们满足用例验收不变量。
3. **频道快照需要业务层二次判别。** 404 仍可能 `data.ok:true`。
4. **评论采集当前没有拿到评论节点。** DOM 有评论容器但无 thread/content，分类为 `not_loaded`。
5. **字幕发现不等于字幕下载。** 本轮发现 track，但正文不可用，返回 `TRANSCRIPT_UNAVAILABLE`，无文件写入。

## 下一步

- 对 UC-04 单独做场景诊断：targeted scroll、等待 comments hydration、检查 continuation/network 响应，确认是加载策略还是 YouTube 登录/地区限制。
- 对 UC-05 增加至少一个 known-good 字幕样本，区分“该视频正文不可用”和“字幕下载通道整体不可用”。
- 将人工评估 workflow 的前置命令更新为：先显式 `daemon start`，再执行用例命令。
