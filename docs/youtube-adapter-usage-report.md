# YouTube Adapter 使用与业务验证报告

本文档记录 `src/sites/youtube.ts` 暴露的 YouTube 站点指令、返回结构、真实业务验证结果和已观察到的限制。

验证日期：2026-06-05  
验证环境：本地源码构建，`SITEFLOW_HOME=/tmp/siteflow-youtube-validation`，profile 为 `youtube-validation`。  
验证对象：`siteflow youtube` 下的 `search`、`video`、`channel`、`comments`、`transcript`。

## 指令总览

```bash
siteflow youtube search [options] <keyword>
siteflow youtube video [options] <target>
siteflow youtube channel [options] <target>
siteflow youtube comments [options] <target>
siteflow youtube transcript [options] <target>
```

通用选项：

| 选项 | 适用指令 | 含义 |
| --- | --- | --- |
| `--page-id <id>` | 全部 YouTube 指令 | 复用 `siteflow browser pages` 中已有页面，使自动化绑定到指定 tab。 |
| `--limit <n>` | `search`、`comments` | 限制返回视频或评论数量。`search` 默认 20，范围 1-50；`comments` 默认 50，范围 1-200。 |
| `--out <dir>` | `transcript` | 字幕 XML 下载成功时写入的本地目录。 |

所有 YouTube 指令都返回 Siteflow receipt。顶层 JSON envelope 形状为：

```json
{
  "ok": true,
  "data": {
    "site": "youtube",
    "command": "search",
    "ok": true,
    "state": "search_collected",
    "observations": {},
    "errors": [],
    "next": [],
    "steps": []
  },
  "meta": {
    "profile": "youtube-validation"
  }
}
```

说明：

- 顶层 `ok` 表示 CLI 命令是否正常完成并返回 JSON envelope。
- `data.ok` 表示站点业务 receipt 是否成功。`transcript` 可能出现顶层 `ok: true` 但 `data.ok: false`，代表命令正常返回了“业务失败”的结构化结果。
- `observations` 是业务返回内容主体。
- `steps` 是工作流步骤证据，记录每一步名称、状态、耗时区间和小型 evidence。
- `sideEffects` 标注副作用。搜索、视频、频道、评论均为 `[]`；字幕成功写文件时为 `['file_download']`。

## 1. 搜索视频

用途：打开 YouTube 搜索页，等待结果加载，提取视频列表。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube search "siteflow cli" --limit 3
```

实测返回摘要：

```json
{
  "site": "youtube",
  "command": "search",
  "ok": true,
  "state": "search_collected",
  "observations": {
    "keyword": "siteflow cli",
    "pageId": 2,
    "limit": 3,
    "url": "https://www.youtube.com/results?search_query=siteflow+cli",
    "title": "siteflow cli - YouTube",
    "videos": [
      {
        "id": "SqoFY0bQJDQ",
        "title": "Building Command Line Tools with lambdaisland/CLI/Babashka - Arne Brasseur",
        "href": "https://www.youtube.com/watch?v=SqoFY0bQJDQ&pp=ygUMc2l0ZWZsb3cgY2xp",
        "channel": "ClojureTV\n  \n  \n  \n    ClojureTV",
        "metadata": "ClojureTV ... 466次观看 ... 2天前",
        "text": "52:09 ... Building Command Line Tools with lambdaisland/CLI/Babashka - Arne Brasseur ..."
      },
      {
        "id": "h6UbVuHprZA",
        "title": "How to Use SiteFlow",
        "href": "https://www.youtube.com/watch?v=h6UbVuHprZA&pp=ygUMc2l0ZWZsb3cgY2xp",
        "channel": "SiteMax | The Jobsite Management Platform\n  \n  \n  \n    SiteMax | The Jobsite Management Platform",
        "metadata": "SiteMax | The Jobsite Management Platform ... 306次观看 ... 2年前",
        "text": "2:29 ... How to Use SiteFlow ..."
      },
      {
        "id": "hgFRRwIZ5Lw",
        "title": "Getting Started with ScientiFlow: Install & Connect ScientiFlow-CLI Agent",
        "href": "https://www.youtube.com/watch?v=hgFRRwIZ5Lw&pp=ygUMc2l0ZWZsb3cgY2xp",
        "channel": "Scientiflow\n  \n  \n  \n    Scientiflow",
        "metadata": "Scientiflow ... 321次观看 ... 1年前",
        "text": "3:54 ... Getting Started with ScientiFlow: Install & Connect ScientiFlow-CLI Agent ..."
      }
    ],
    "sideEffects": []
  }
}
```

步骤证据：

```json
[
  {
    "name": "open_search_page",
    "ok": true,
    "state": "open_search_page_ok",
    "evidence": { "pageId": 2 }
  },
  {
    "name": "wait_for_search_results",
    "ok": true,
    "state": "wait_for_search_results_ok",
    "evidence": { "pageId": 2, "waitedMs": 2200 }
  },
  {
    "name": "extract_search_results",
    "ok": true,
    "state": "extract_search_results_ok",
    "evidence": {
      "count": 9,
      "limit": 9,
      "root": "ytd-video-renderer, ytd-rich-item-renderer, a#video-title",
      "requestedLimit": 3
    }
  }
]
```

结论：`search` 可用。返回内容包含视频 `id`、标题、链接、频道文本、元信息和可见文本。当前 selector 会先提取页面可见候选，再按请求 limit 去重裁剪。

## 2. 读取视频元数据

用途：打开 watch 页，提取视频详情、可见页面正文和页面元数据。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube video h6UbVuHprZA
```

实测返回摘要：

```json
{
  "site": "youtube",
  "command": "video",
  "ok": true,
  "state": "video_collected",
  "observations": {
    "target": "h6UbVuHprZA",
    "id": "h6UbVuHprZA",
    "pageId": 3,
    "url": "https://www.youtube.com/watch?v=h6UbVuHprZA",
    "title": "How to Use SiteFlow - YouTube",
    "video": {
      "id": "h6UbVuHprZA",
      "title": "How to Use SiteFlow",
      "channel": "SiteMax | The Jobsite Management Platform",
      "description": "Learn More: https://help.sitemaxsystems.com/ Learn how to create Siteflows. Get step-by-step guidance to start using Siteflows for your Subcontractors! Subscribe: https://bit.ly/45csJ9r LinkedIn: https://bit.ly/3LFcyKT iOS Appstore link: http://bit.ly/3LBCWFq Android Appstore link: https://bit.ly/48A22hZ",
      "lengthSeconds": "148",
      "viewCount": "306",
      "publishDate": "2024-03-22T13:32:24-07:00",
      "category": "Film & Animation"
    },
    "text": "跳过导航 登录 0:00 / 2:28 How to Use SiteFlow SiteMax | The Jobsite Management Platform ... 0 条评论 ...",
    "sideEffects": []
  }
}
```

步骤证据：

```json
[
  {
    "name": "open_video_page",
    "ok": true,
    "state": "open_video_page_ok",
    "evidence": { "pageId": 3 }
  },
  {
    "name": "wait_for_watch_page",
    "ok": true,
    "state": "wait_for_watch_page_ok",
    "evidence": { "pageId": 3, "waitedMs": 2200 }
  },
  {
    "name": "extract_video_details",
    "ok": true,
    "state": "extract_video_details_ok",
    "evidence": { "pageId": 3, "hasVideoId": true }
  }
]
```

结论：`video` 可用。它适合采集 watch 页结构化 metadata。`text` 字段会包含大量当前页面可见文本和推荐视频文本，不适合当作稳定业务字段使用。

## 3. 读取频道页面快照

用途：打开频道页，返回频道页面标题和可见正文快照。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube channel "@YouTube"
```

实测返回摘要：

```json
{
  "site": "youtube",
  "command": "channel",
  "ok": true,
  "state": "channel_collected",
  "observations": {
    "target": "@YouTube",
    "pageId": 5,
    "url": "https://www.youtube.com/@YouTube",
    "title": "YouTube - YouTube",
    "heading": "",
    "text": "跳过导航 登录 首页 Shorts 订阅 我 YouTube @YouTube • 4540万位订阅者 • 1429 个视频 YouTube's official YouTube channel …更多 YouTube 和另外 2 个链接 订阅 首页 视频 Shorts 直播 播客 播放列表 帖子 Olandria reacts to her Watch History | Watch History ...",
    "sideEffects": []
  }
}
```

步骤证据：

```json
[
  {
    "name": "open_channel_page",
    "ok": true,
    "state": "open_channel_page_ok",
    "evidence": { "pageId": 5 }
  },
  {
    "name": "wait_for_channel_page",
    "ok": true,
    "state": "wait_for_channel_page_ok",
    "evidence": { "pageId": 5, "waitedMs": 1800 }
  },
  {
    "name": "extract_channel_summary",
    "ok": true,
    "state": "extract_channel_summary_ok",
    "evidence": { "pageId": 5, "hasHeading": false }
  }
]
```

结论：`channel` 部分可用。它能打开频道并返回正文快照，但实测 `heading` 为空。业务上应优先使用 `title` 和 `text`，不要依赖 `heading` 必填。

反例：

```bash
siteflow --json youtube channel "@SiteMaxSystems"
```

该 handle 实测返回 `title: "404 Not Found"`、`text: ""`，但 receipt 仍为 `ok: true`、`state: "channel_collected"`。因此调用方需要检查 `title`、`text` 或 URL 是否符合预期，不能只看 `data.ok`。

## 4. 读取可见评论

用途：打开视频页，滚动到评论区，提取当前可见评论。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube comments h6UbVuHprZA --limit 5
```

实测返回摘要：

```json
{
  "site": "youtube",
  "command": "comments",
  "ok": true,
  "state": "comments_collected",
  "observations": {
    "target": "h6UbVuHprZA",
    "id": "h6UbVuHprZA",
    "pageId": 6,
    "limit": 5,
    "url": "https://www.youtube.com/watch?v=h6UbVuHprZA",
    "title": "How to Use SiteFlow - YouTube",
    "comments": [],
    "sideEffects": []
  }
}
```

步骤证据：

```json
[
  {
    "name": "open_video_page",
    "ok": true,
    "state": "open_video_page_ok",
    "evidence": { "pageId": 6 }
  },
  {
    "name": "wait_for_watch_page",
    "ok": true,
    "state": "wait_for_watch_page_ok",
    "evidence": { "pageId": 6, "waitedMs": 1500 }
  },
  {
    "name": "scroll_to_comments",
    "ok": true,
    "state": "scroll_to_comments_ok",
    "evidence": { "pageId": 6, "scrolled": true }
  },
  {
    "name": "extract_comments",
    "ok": true,
    "state": "extract_comments_ok",
    "evidence": {
      "count": 0,
      "limit": 5,
      "root": "ytd-comment-thread-renderer"
    }
  }
]
```

另一个有活跃页面内容的视频也实测返回空评论：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube comments iOhT9MKc7lo --limit 5
```

返回：

```json
{
  "ok": true,
  "state": "comments_collected",
  "observations": {
    "target": "iOhT9MKc7lo",
    "id": "iOhT9MKc7lo",
    "comments": []
  },
  "steps": [
    { "name": "scroll_to_comments", "ok": true, "evidence": { "scrolled": true } },
    { "name": "extract_comments", "ok": true, "evidence": { "count": 0, "root": "ytd-comment-thread-renderer" } }
  ]
}
```

结论：`comments` 流程可以跑通，但真实 YouTube 页面上不保证能提取到评论。业务语义应表述为“采集当前可见评论”，不是“保证下载视频评论”。调用方应同时检查 `comments.length` 和 `steps.extract_comments.evidence.count`。

## 5. 下载字幕 transcript

用途：打开视频页，发现 caption tracks，按优先级选择 track，尝试下载字幕 XML，成功时写入本地目录。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube transcript h6UbVuHprZA --out /tmp/siteflow-youtube-validation/transcripts
```

实测返回摘要：

```json
{
  "site": "youtube",
  "command": "transcript",
  "ok": false,
  "state": "transcript_failed",
  "observations": {
    "target": "h6UbVuHprZA",
    "id": "h6UbVuHprZA",
    "pageId": 10,
    "url": "https://www.youtube.com/watch?v=h6UbVuHprZA",
    "title": "How to Use SiteFlow - YouTube",
    "tracks": [
      {
        "name": "英语 (自动生成)",
        "languageCode": "en",
        "baseUrl": "https://www.youtube.com/api/timedtext?...&kind=asr&lang=en"
      }
    ],
    "transcriptUnavailableHint": true,
    "selectedTrack": {
      "name": "英语 (自动生成)",
      "languageCode": "en",
      "baseUrl": "https://www.youtube.com/api/timedtext?...&kind=asr&lang=en"
    },
    "sideEffects": []
  },
  "errors": [
    {
      "code": "TRANSCRIPT_UNAVAILABLE",
      "message": "This YouTube video exposes caption tracks but the transcript body is unavailable from the watch page."
    }
  ]
}
```

步骤证据：

```json
[
  {
    "name": "open_video_page",
    "ok": true,
    "state": "open_video_page_ok",
    "evidence": { "pageId": 10 }
  },
  {
    "name": "wait_for_watch_page",
    "ok": true,
    "state": "wait_for_watch_page_ok",
    "evidence": { "pageId": 10, "waitedMs": 1800 }
  },
  {
    "name": "discover_caption_tracks",
    "ok": true,
    "state": "discover_caption_tracks_ok",
    "evidence": {
      "pageId": 10,
      "trackCount": 1,
      "transcriptUnavailableHint": true
    }
  },
  {
    "name": "fetch_caption_text",
    "ok": true,
    "state": "fetch_caption_text_ok",
    "evidence": {
      "skipped": false,
      "hasText": false,
      "languageCode": "en"
    }
  },
  {
    "name": "write_transcript_file",
    "ok": true,
    "state": "write_transcript_file_ok",
    "evidence": { "wrote": false }
  }
]
```

同一轮还验证了 `iOhT9MKc7lo`，结果同样是：发现 `tracks`，但正文不可用，返回 `TRANSCRIPT_UNAVAILABLE`。

结论：`transcript` 当前能发现字幕 track，但真实下载字幕正文不稳定。业务上不要承诺“可靠下载字幕”。更准确的能力描述是：发现 watch 页暴露的 caption tracks，并在正文可取时写入 XML；不可取时返回结构化失败。

## 6. 复用页面 `--page-id`

用途：把 adapter 操作绑定到已打开页面，避免每次新开 tab。

命令：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json youtube video h6UbVuHprZA --page-id 3
```

实测返回：

```json
{
  "ok": true,
  "state": "video_collected",
  "observations": {
    "target": "h6UbVuHprZA",
    "id": "h6UbVuHprZA",
    "pageId": 3,
    "url": "https://www.youtube.com/watch?v=h6UbVuHprZA",
    "title": "How to Use SiteFlow - YouTube"
  },
  "steps": [
    { "name": "open_video_page", "ok": true, "evidence": { "pageId": 3 } },
    { "name": "extract_video_details", "ok": true, "evidence": { "pageId": 3, "hasVideoId": true } }
  ]
}
```

结论：`--page-id` 可用，返回中保持同一个 `pageId`。

## 业务结论

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 搜索视频 | 可用 | 返回稳定视频列表字段，适合作为只读搜索采集。 |
| 视频元数据 | 可用 | 返回 `video` 结构化对象，适合采集标题、频道、描述、时长、观看数等 metadata。 |
| 频道快照 | 部分可用 | 能返回页面正文，但 `heading` 实测为空；404 页面也可能以业务 `ok: true` 返回。 |
| 可见评论 | 有风险 | 流程成功不代表一定有评论；实测多个页面返回空数组。 |
| 字幕下载 | 有风险 | 能发现 tracks，但正文下载返回 `TRANSCRIPT_UNAVAILABLE`。 |
| 页面复用 | 可用 | `--page-id` 能绑定已有 tab。 |

## 调用方建议

1. 不要只看顶层 `ok`。应同时检查 `data.ok`、`data.state`、`data.errors`。
2. 对 `channel`，检查 `observations.title` 和 `observations.text`，避免把 404 当成有效频道。
3. 对 `comments`，把空数组视为正常可能结果，不要当作命令失败。
4. 对 `transcript`，把 `TRANSCRIPT_UNAVAILABLE` 当作可预期业务结果处理。
5. 搜索和视频元数据可以作为当前最稳定的 YouTube 业务能力。

## 验证命令

构建：

```bash
npm run build
```

YouTube 相关单元测试和架构边界测试：

```bash
npm run build && node --test \
  test/unit/adapter-proofs.test.mjs \
  test/unit/site-probes.test.mjs \
  test/unit/site-import-governance.test.mjs
```

实测结果：

```text
46 tests
46 pass
0 fail
```

验证结束后停止 daemon：

```bash
SITEFLOW_HOME=/tmp/siteflow-youtube-validation \
  siteflow --profile youtube-validation --json daemon stop
```
