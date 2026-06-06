# YouTube workflow 快速执行验证

诊断对象：[`docs/用户用例/youtube-business-use-cases.md`](../用户用例/youtube-business-use-cases.md)

现场执行：已按 workflow 并行复跑 UC-01 到 UC-06，并用 UC-07 的分层规则汇总判断。执行前运行 `npm run build`。所有命令使用临时 `SITEFLOW_HOME=/tmp/siteflow-youtube-workflow-quick/*` 和专用 profile，并显式 `daemon start` / `daemon stop`。

隐私边界：只保留结构化摘要；未保存 cookie、token、browser profile、完整 DOM、完整 network body、签名字幕 URL 或 transcript 正文。

## 问题

需要快速验证 YouTube adapter 的业务用例是否满足文档中的最小验收标准，并区分：

- 顶层 envelope 成功 vs 业务 receipt 成功。
- 空评论数组是真空、未加载、不可用还是提取失败。
- transcript 发现 track 后是否真的写入 XML，或是否返回结构化业务失败。
- `--page-id` 复用是否稳定绑定同一 page。

## 证据

### UC-01：关键词搜索候选视频

- 命令：`youtube search "siteflow cli" --limit 3`
- Envelope 层：exit 0；顶层 `ok:true`。
- 业务 receipt 层：`site: youtube`；`command: search`；`data.ok:true`；`state: search_collected`；`errors: []`；`sideEffects: []`。
- Runtime 层：`pageId: 2`；URL 为 `https://www.youtube.com/results?search_query=siteflow+cli`；title 为 `siteflow cli - YouTube`。
- Source 层：`extract_search_results` evidence `count: 9`，`requestedLimit: 3`，root 为 `ytd-video-renderer, ytd-rich-item-renderer, a#video-title`。
- Extraction 层：返回 3 条视频；ID 为 `SqoFY0bQJDQ`、`h6UbVuHprZA`、`hgFRRwIZ5Lw`；去重后仍为 3；每条都有 `id` 和 `href`。

结论：`success`。满足返回数组、limit 生效、视频 ID 去重的最小验收。

### UC-02：读取视频元数据

- 命令：`youtube video h6UbVuHprZA`
- Envelope 层：exit 0；顶层 `ok:true`。
- 业务 receipt 层：`command: video`；`data.ok:true`；`state: video_collected`；`errors: []`；`sideEffects: []`。
- Runtime 层：`pageId: 3`；URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`；title 为 `How to Use SiteFlow - YouTube`。
- Source 层：`extract_video_details` evidence `hasVideoId:true`。
- Extraction 层：`video.id: h6UbVuHprZA`；title 为 `How to Use SiteFlow`；channel 为 `SiteMax | The Jobsite Management Platform`；`lengthSeconds: 148`；`viewCount: 307`；`publishDate: 2024-03-22T13:32:24-07:00`；`category: Film & Animation`。

结论：`success`。满足有效 `video.id`、标题、频道和核心 metadata 的最小验收。

### UC-03：读取频道页面快照

有效样本：`youtube channel "@YouTube"`

- Envelope 层：exit 0；顶层 `ok:true`。
- 业务 receipt 层：`command: channel`；`data.ok:true`；`state: channel_collected`；`errors: []`；`sideEffects: []`。
- Runtime 层：`pageId: 2`；URL 为 `https://www.youtube.com/@YouTube`；title 为 `YouTube - YouTube`。
- Source 层：页面暴露可读频道快照；`title` 可读；正文含频道导航、订阅、视频信息。
- Extraction 层：`observations.target` 匹配输入；`title` 和 `text` 存在；`heading` 为空。

负例样本：`youtube channel "@SiteMaxSystems"`

- Envelope 层：exit 0；顶层 `ok:true`。
- 业务 receipt 层：`data.ok:true`；`state: channel_collected`，但这只表示快照采集完成。
- Runtime 层：URL 为 `https://www.youtube.com/@SiteMaxSystems`；title 为 `404 Not Found`。
- Source 层：频道源不可用；title 为 404，正文为空。
- Extraction 层：捕获到 404 title；`textLength: 0`；`heading` 为空。

结论：有效频道为 `success`；404 样本为 `source_unavailable`。`heading` 不是必填字段，`channel_collected` 不能等同业务有效频道。

### UC-04：采集当前可见评论

- 命令：`youtube comments h6UbVuHprZA --limit 5`
- Envelope 层：顶层 `ok:true`。
- 业务 receipt 层：`command: comments`；`data.ok:true`；`state: comments_collected`；`errors: []`；`sideEffects: []`；`comments: []`。
- Runtime 层：daemon 显式启动；页面 URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`；title 为 `How to Use SiteFlow - YouTube`；`readyState: complete`。
- Source 层：targeted scroll + wait 后，`ytd-comments` roots 为 2，`ytd-comment-thread-renderer: 0`，`#content-text: 0`，`#author-text: 0`；页面文本信号包含登录入口和 `0 条评论` / 排序控件；未观察到评论关闭文案。
- Extraction 层：adapter `extract_comments` evidence `count: 0`，root 为 `ytd-comment-thread-renderer`；返回 `comments.length: 0`。

结论：未通过“采集到评论记录”的业务验收；本轮分类为 `source_unavailable`。DOM 中没有评论 thread/content/author 节点，因此不是已证实的 parser/selector 提取失败。

### UC-05：发现并下载字幕 transcript

- 命令：`youtube transcript h6UbVuHprZA --out /tmp/siteflow-youtube-workflow-quick/uc05/transcripts`
- Envelope 层：transcript 命令 exit 0；顶层 `ok:true`。
- 业务 receipt 层：`command: transcript`；`data.ok:false`；`state: transcript_failed`；`errors: [TRANSCRIPT_UNAVAILABLE]`；`sideEffects: []`；无 `filePath` / `bytes`。
- Runtime 层：`pageId: 2`；URL 为 `https://www.youtube.com/watch?v=h6UbVuHprZA`；title 为 `How to Use SiteFlow - YouTube`。
- Source 层：发现 1 条英文自动字幕 track；`selectedTrack.languageCode: en`；`transcriptUnavailableHint:true`。
- Extraction 层：`fetch_caption_text` evidence `hasText:false`；`write_transcript_file` evidence `wrote:false`；输出目录文件数 0，总字节 0。

结论：`business_failure: TRANSCRIPT_UNAVAILABLE`。未通过成功写 XML，但通过“结构化业务失败”验收。根因边界在 caption track metadata 存在、caption body 不可用这一段；文件 writer 正确没有写空文件。

### UC-06：复用已有页面执行连续读取

- 命令：先 `youtube video h6UbVuHprZA` 返回 `pageId: 3`，再 `youtube video h6UbVuHprZA --page-id 3`。
- Envelope 层：两次 video 命令均 exit 0；顶层 `ok:true`。
- 业务 receipt 层：两次均 `data.ok:true`、`state: video_collected`。
- Runtime 层：复用命令输入 `page-id=3`，返回 `observations.pageId=3`；URL/title 仍对应目标视频。
- Source 层：复用后 `open_video_page` / `wait_for_watch_page` / `extract_video_details` 都停留在 `pageId: 3`。
- Extraction 层：复用后 `video.id`、title、channel、length/view/date/category 仍有效。

结论：`success`。满足 page id 复用和业务判断独立的最小验收。

### UC-07：业务 receipt 分层评估

本轮所有用例都按五层证据判断：

- UC-01、UC-02、UC-06：业务成功，且有 source/extraction 证据支撑。
- UC-03：有效频道成功，404 样本按 `source_unavailable` 判别。
- UC-04：顶层和业务 receipt 成功，但业务字段为空；按 DOM/source 证据分类，不报告业务成功。
- UC-05：顶层成功但业务 receipt 失败；按 `TRANSCRIPT_UNAVAILABLE` 处理，不报告下载成功。

结论：`success`。本轮没有把单层 success flag 当成业务成功。

## 总体结论

| 用例 | 分类 | 最小验收 |
| --- | --- | --- |
| UC-01 搜索候选视频 | `success` | 通过 |
| UC-02 视频元数据 | `success` | 通过 |
| UC-03 频道快照 | `success` / `source_unavailable` | 通过，需业务判别 404 |
| UC-04 可见评论 | `source_unavailable` | 未通过采集评论；通过空结果分类 |
| UC-05 transcript | `business_failure: TRANSCRIPT_UNAVAILABLE` | 未通过 XML 下载；通过结构化失败验收 |
| UC-06 页面复用 | `success` | 通过 |
| UC-07 分层评估 | `success` | 通过 |

## 根因

1. **UC-04 根因边界：Source 层不可用。** 页面到达 watch 页并出现评论区域相关 UI，但 DOM 中没有 `ytd-comment-thread-renderer`、`#content-text`、`#author-text`。本轮还观察到 `0 条评论` 文案，因此不能证明是 selector/parser 错误。
2. **UC-05 根因边界：Source → Extraction。** Watch 页暴露 caption track metadata，但 caption body 不可用；adapter 返回 `TRANSCRIPT_UNAVAILABLE` 且不写空文件。
3. **UC-03 业务边界：channel 快照不是频道有效性保证。** 404 页面也能完成快照采集，调用方必须检查 `title/text`。
4. **Daemon 生命周期观察：** 多个子流程首次 `daemon stop` 出现 timeout，重试后停止成功。该现象不影响业务结果分类，但应避免把 stop timeout 混入 YouTube 业务失败。

## 暂不修改

- 暂不改 comments selector：DOM 中目标评论节点为 0，没有证据证明 selector 漏提了已存在评论。
- 暂不把 UC-04 归为 extraction failure：Source 层没有评论 thread/content/author 节点。
- 暂不把 transcript track count > 0 当成功：必须同时满足 `hasText:true`、`wrote:true`、`filePath` 和 bytes > 0。
- 暂不改 transcript 文件写入逻辑：正文不可用时不写空 XML 是正确行为。
- 暂不把 daemon stop timeout 归因到 adapter：业务命令已返回结构化 receipt，stop 重试成功。

## 下一步

1. 如果要提升 UC-04，通过认证 profile 或另一个 known-public comments 样本复跑，区分“视频真实 0 评论/匿名不可见”和“滚动加载策略不足”。
2. 如果要提升 UC-05，增加底层 timedtext 探针，只记录 status、content-type、byte count、是否含 caption node，不保存 signed URL 或正文。
3. 可以把人工执行 workflow 固化为：`npm run build` → 显式 `daemon start` → 业务命令 → `eval`/文件元信息交叉验证 → `daemon stop` 重试保护。
