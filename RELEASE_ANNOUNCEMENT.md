# Siteflow 0.1.0 发布公告草稿

今天把 Siteflow 的第一版开源仓库整理出来了。

Siteflow 是一个由本地 Browser Kernel 驱动的可复用站点工作流 CLI。它不是一次性脚本集合，而是把网页观察、请求采集、调试、回放和站点能力沉淀成稳定命令的一套平台。

## 这次开源包含什么

### 1. Browser Kernel

Siteflow 的底层是一个 daemon-backed Browser Kernel，负责：

- 页面打开、切换、导航、截图、点击、输入、上传；
- scripts / console / network / storage / hooks；
- debugger breakpoint、paused eval、step/resume；
- cookie export/import、trace、request replay；
- 结构化 JSON receipt。

### 2. Site Adapter Layer

上层站点能力已经统一走 `src/sites/capabilities.ts`，不再让每个 adapter 自己直连 daemon。

当前内置 adapter 包括：

- 1688
- arxiv
- bilibili
- cninfo
- douyin
- eastmoney
- github
- hackernews
- jimeng
- media
- producthunt
- reddit
- rouman5
- sec
- suno
- telegram
- twitter / x
- xhs
- xueqiu
- youtube

### 3. 开源治理文件

这次一并补齐了：

- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `RELEASE.md`
- `OPEN_SOURCE_CHECKLIST.md`

并加上了：

- GitHub CI
- Release Check workflow
- issue 模板
- PR 模板
- 脱敏 receipt 示例

## 这次重点修了什么

在开源前，我把一批容易让人误判“项目能跑但不稳”的问题收掉了，包括：

- `rouman5` reader 标题和章节索引对齐；
- `douyin` 登录页误判修复；
- `hackernews user` 页面解析恢复；
- `suno create` 从旧 DOM 假设切到当前页面结构；
- `jimeng generate --submit` 改进真实提交后的状态判定；
- `sec download` 对错误 accession 给出明确提示；
- `xueqiu` 核心行情链路恢复；
- `youtube transcript` 能准确区分“字幕体不可用”。

此外，我还把全站点执行过程整理成了 `SITE_EXECUTION_LOG.md`，把哪些站点稳定、哪些受 challenge / 登录态限制、哪些只是正确失败边界，都写清楚了。

## 当前定位

Siteflow 现在更像是：

> 一个本地浏览器观察和站点工作流平台

而不是：

> 某个站点脚本合集

它适合做：

- 站点自动化研发
- 浏览器行为调试
- agent 驱动的可复用网页流程
- 有证据链的页面采集与重放

## 已知限制

当前这版仍然有一些明确限制：

- 某些站点会被 challenge / 登录态阻断；
- `xueqiu discussions` 还没完全打通；
- `twitter/x home/search` 依赖有效登录态 profile；
- `youtube transcript` 对部分视频仍只能返回 `TRANSCRIPT_UNAVAILABLE`。

这些限制没有被隐藏，而是尽量做成了明确、结构化、可诊断的失败状态。

## 安装

```bash
npm install -g siteflow-cli
siteflow --help
```

如果你更想从源码跑：

```bash
npm install
npm run build
npm link
```

## 最后

如果你对这类“本地 Browser Kernel + 可复用站点工作流”的方向感兴趣，欢迎直接看：

- `README.md`
- `CONTRIBUTING.md`
- `SITE_EXECUTION_LOG.md`

如果你想接着补 adapter、修 challenge 边界、或者把某个站点 workflow 做成稳定命令，也欢迎开 issue。
