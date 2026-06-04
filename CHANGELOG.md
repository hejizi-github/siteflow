# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-06-03

### Added

- 初始开源版本 `siteflow-cli`，CLI 命令统一为 `siteflow`。
- 本地 daemon-backed Browser Kernel，覆盖页面打开、脚本观察、console、network、debugger、storage、hook、cookie、trace 和 request replay。
- 站点能力门面 `src/sites/capabilities.ts`，统一约束 site adapter 的浏览器访问边界。
- 多站点 adapter 能力，包括 1688、arxiv、bilibili、cninfo、douyin、eastmoney、github、hackernews、jimeng、media、producthunt、reddit、rouman5、sec、suno、telegram、twitter/x、xhs、xueqiu、youtube。
- 中文 README 配图与开源治理文件：`LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、`RELEASE.md`、`OPEN_SOURCE_CHECKLIST.md`。
- GitHub CI / Release Check workflow、issue 模板、PR 模板。
- 脱敏 receipt 示例：X Home、GitHub Trending、Product Hunt Challenge。
- 全站点串行执行记录：`SITE_EXECUTION_LOG.md`。

### Changed

- 项目品牌从 `jsrev` 全量切换为 `Siteflow`。
- 本地状态目录与环境变量切换为 `~/.siteflow/`、`SITEFLOW_HOME`、`SITEFLOW_HEADLESS`、`SITEFLOW_BROWSER_CHANNEL`。
- Site adapter 边界从分散的 daemon helper 访问收束为 `capabilities.ts` 门面。
- 发布包边界收紧，只保留 dist、核心文档、示例和 README 资源。

### Fixed

- `rouman5` 作品标题提取修正，不再误写为“全部漫畫”；章节图片索引和 reader 标题对齐。
- `douyin` 登录页识别修复，不再把创作者中心登录页误判成成功空结果。
- `hackernews user` 页面解析恢复，可正确提取 user / created / karma / about。
- `suno create` 从过时双输入框假设切换为单输入框填充，并识别 ready gate。
- `jimeng generate --submit` 真实提交后可返回 `submissionLikely=true`，不再直接判失败。
- `sec download` 在 accession / CIK 不匹配时返回明确的 `SEC_ARCHIVE_NOT_FOUND` 错误。
- `xueqiu` 的 quote / minute / trades / orderbook / finance 链路从不稳定导航切换为首页 tab 请求路径，显著提升稳定性。
- `youtube transcript` 对“有 caption tracks 但正文不可用”的情况返回明确的 `TRANSCRIPT_UNAVAILABLE`。
- `xueqiu status` 参数契约收紧，要求 status URL 或 `<userId>/<statusId>`，避免裸数字误用。

### Known limitations

- `xueqiu discussions` 目前稳定收敛为 `PAGE_CONTEXT_FETCH_FAILED`，尚未完全打通。
- `xueqiu comments/status` 在真实目标上会被滑动验证阻断。
- `twitter/x home/search` 依赖有效登录态 profile。
- `youtube transcript` 对部分视频只能确认字幕轨道存在，但正文不可用。
- `producthunt`、`reddit`、`xhs`、`telegram web` 等链路受 challenge 或登录态限制。
