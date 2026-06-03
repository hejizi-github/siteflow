# Siteflow 全站点串行执行记录

> 目标：避免并行导致的内存压力，按站点逐个执行所有命令，并在每完成一个站点后立即记录结果，降低会话压缩带来的上下文丢失风险。

## 执行规则

- 串行执行，一次只跑一个站点。
- 每完成一个站点，立即把命令、参数、结果、产物路径、失败原因写入本文档。
- 对会产生真实副作用的命令，记录是否真实下载、真实上传、真实草稿、真实生成或真实发布。
- 若站点命令受登录态、挑战页、风控或权限限制阻断，也必须记录明确状态，不跳过不省略。

## 站点清单

- [x] 1688
- [ ] arxiv
- [ ] bilibili
- [ ] cninfo
- [ ] douyin
- [ ] eastmoney
- [ ] github
- [ ] hackernews
- [ ] jimeng
- [ ] media
- [ ] producthunt
- [ ] reddit
- [ ] rouman5
- [ ] sec
- [ ] suno
- [ ] telegram
- [ ] twitter / x
- [ ] xhs
- [ ] xueqiu
- [ ] youtube

---

## 执行记录

### 1688

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `1688 home` | `--limit 3` | 成功 | 进入 `https://air.1688.com/kapp/channel-fe/cps-4c-pc/home`，拿到 3 条精选货源；返回首页类目、筛选项、排序项和文本摘要。 | `/tmp/siteflow-1688-home.json` |
| `1688 search` | `--keyword 喷雾瓶 --limit 3` | 成功 | 搜索页返回 3 条真实商品，含价格、销量、供应商、详情链接；suggestions 返回“化妆品喷雾瓶”“日化喷雾瓶”。 | `/tmp/siteflow-1688-search.json` |
| `1688 suggest` | `--keyword 喷雾瓶` | 成功 | 自动补全 API 返回 14 条建议词，如“补水喷雾小瓶”“喷雾瓶100ml”“消毒喷雾瓶”。 | `/tmp/siteflow-1688-suggest.json` |
| `1688 product` | `--offer 524670995986` | 成功 | 真实打开详情页并提取商品标题、公司、价格、服务标签、SKU、属性、图片链接和长文本摘要。 | `/tmp/siteflow-1688-product.json` |
| `1688 seo` | `--keyword 喷雾瓶 --title '可爱分装瓶旅行便携喷雾瓶细雾化妆补水爽肤水小喷壶消毒酒精喷瓶' --limit 8` | 成功 | 输出 SEO 诊断，给出 competitor terms、标题审计和建议标题；无外部副作用。 | `/tmp/siteflow-1688-seo.json` |

备注：

- 本站点所有命令均为真实执行，没有使用 dry-run。
- `product` 参数来自 `search` 第一条结果的 `offerId=524670995986`。
- 本组命令无真实上传、无真实发布、无本地下载文件，仅有 JSON 结果文件。

### arxiv

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `arxiv latest` | `--category cs.AI --limit 3` | 成功 | 真实打开 `https://arxiv.org/list/cs.AI/new`，返回 3 篇最新论文，含 id、title、authors、absUrl、pdfUrl。 | `/tmp/siteflow-arxiv-latest.json` |
| `arxiv search` | `'diffusion model' --limit 3` | 成功 | 搜索页返回 3 篇结果，包含摘要、作者、subjects、abs/pdf 链接。第一次错误地把查询词拆成两个参数，CLI 明确报 `too many arguments`，改成带引号后成功。 | `/tmp/siteflow-arxiv-search.json` |
| `arxiv paper` | `2506.01573` | 成功 | 真实进入论文详情页并提取标题、作者、摘要、subjects、pdfUrl、sourceUrl。 | `/tmp/siteflow-arxiv-paper.json` |
| `arxiv pdf` | `2506.01573` | 成功（dry-run） | 命令真实执行，但当前产品设计只返回 PDF dry-run 计划，不写文件。 | `/tmp/siteflow-arxiv-pdf-dry.json` |
| `arxiv pdf` | `2506.01573 --apply` | 受限 | 命令真实执行后返回 `apply_not_implemented`，明确说明尚未实现真实 PDF 下载。 | `/tmp/siteflow-arxiv-pdf-apply.json` |

备注：

- `paper` / `pdf` 参数使用固定公开 arXiv id：`2506.01573`。
- 该站点没有真实发布或上传副作用。
- `pdf --apply` 不是失败于环境，而是 adapter 明确未实现真实下载，这是当前代码能力边界。

### bilibili

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `bilibili search` | `AI --limit 3` | 成功 | 真实打开搜索页并抓到公开视频结果；当前页面样本只返回 1 条 `BV1Xx411c7cH`，标题为“高级弹幕”。 | `/tmp/siteflow-bilibili-search.json` |
| `bilibili video` | `BV1Xx411c7cH` | 成功 | 通过公开 API 拿到视频 metadata：标题“高级语言弹幕测试”、owner=碧诗、播放量/弹幕/点赞等统计完整。 | `/tmp/siteflow-bilibili-video.json` |
| `bilibili comments` | `BV1Xx411c7cH --limit 5` | 成功 | 通过公开评论接口返回 3 条高赞评论，包含 author、message、like、ctime、reply 数。 | `/tmp/siteflow-bilibili-comments.json` |
| `bilibili creator` | `2` | 成功 | 真实打开 UP 主空间 `https://space.bilibili.com/2`，识别名称“碧诗”，并抓到主页长文本和链接列表。 | `/tmp/siteflow-bilibili-creator.json` |

备注：

- 本站点所有命令都是真实执行，没有 dry-run。
- `video` / `comments` / `creator` 参数来自 `search` 结果中的 bvid 和返回 owner.mid。
- 无真实下载、无真实上传、无真实发布副作用。

### cninfo

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `cninfo latest` | `--market szse_latest --limit 3` | 成功 | 返回深市最新 3 条公告，包含 `announcementId`、`pdfUrl`、`detailUrl`、`adjunctSizeKb` 等字段。 | `/tmp/siteflow-cninfo-latest.json` |
| `cninfo search` | `人工智能 --limit 3` | 成功 | 返回 3 条“人工智能”相关历史公告，来自云从科技、优刻得、有方科技。 | `/tmp/siteflow-cninfo-search.json` |
| `cninfo company` | `000001 --limit 3` | 成功 | 成功解析股票为“平安银行”，并返回 3 条公司公告。 | `/tmp/siteflow-cninfo-company.json` |
| `cninfo announcement` | `1225350408` | 成功 | 成功解析公告 id，对应“董事会有关本次发行并上市的决议”。 | `/tmp/siteflow-cninfo-announcement.json` |
| `cninfo pdf` | `1225350408 --out /tmp/siteflow-cninfo-pdf` | 成功 | 真实下载 PDF 到本地，文件大小 2164191 bytes，SHA256 已返回。 | `/tmp/siteflow-cninfo-pdf.json` |

备注：

- 本站点命令全部为真实执行。
- `announcement` / `pdf` 参数取自 `latest` 第一条公告的 `announcementId=1225350408`。
- 本组真实副作用：下载了 1 个 PDF 到 `/tmp/siteflow-cninfo-pdf/1225350408.pdf`。

### douyin

状态：已完成（登录页阻断已被正确识别）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `douyin status` | 无 | 受限 | 现在正确返回 `auth_required`，明确识别创作者中心登录页。 | `/tmp/siteflow-douyin-status-fixed.json` |
| `douyin works` | `--limit 3` | 受限 | 作品管理页被登录页阻断。 | `/tmp/siteflow-douyin-works.json` |
| `douyin list` | `--limit 3` | 受限 | 与 `works` 相同，当前未登录。 | `/tmp/siteflow-douyin-list.json` |
| `douyin overview` | `--range current --limit 3` | 受限 | 数据中心页面被登录页阻断。 | `/tmp/siteflow-douyin-overview.json` |
| `douyin content-analytics` | `--range current` | 受限 | 内容分析页面被登录页阻断。 | `/tmp/siteflow-douyin-content.json` |
| `douyin stats` | `--range current --limit 3` | 受限 | 依赖 `overview/content-analytics`，因此整体受限。 | `/tmp/siteflow-douyin-stats.json` |
| `douyin inspiration` | `--limit 3` | 受限 | 创作指导页被登录态阻断。 | `/tmp/siteflow-douyin-inspiration.json` |
| `douyin index` | `--type all --limit 3` | 受限 | 指数页被登录态阻断。 | `/tmp/siteflow-douyin-index.json` |
| `douyin ideas` | `--type all --limit 3` | 受限 | 聚合 `inspiration` 和 `index`，因此同样受限。 | `/tmp/siteflow-douyin-ideas.json` |
| `douyin image` | `--title 'Siteflow 图文测试' --body '真实执行测试' --image /tmp/siteflow-douyin-image.webp --topic 测试` | 失败 | 在登录页上找不到“发布图文”，10s 超时。 | `/tmp/siteflow-douyin-image.json` |
| `douyin video` | `--title 'Siteflow 视频测试' --body '真实执行测试' --video /tmp/siteflow-douyin-video.mp4 --topic 测试` | 失败 | 在登录页上找不到“发布视频”，10s 超时。 | `/tmp/siteflow-douyin-video.json` |
| `douyin article` | `--title 'Siteflow 文章测试' --summary '真实执行摘要' --body '这里是一段真实执行的测试正文。'` | 失败 | 在登录页上找不到“发布文章”，10s 超时。 | `/tmp/siteflow-douyin-article.json` |

备注：

- 本站点真实执行已覆盖全部命令面，但当前 profile 未登录抖音创作者中心。
- `isAuthRequired()` 已修复，不再把登录页误判成成功空结果。
- 真实副作用：无。图文/视频/文章发布都在点击发布入口前被登录页阻断。

### eastmoney

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `eastmoney quote` | `600519.SH` | 成功 | 返回贵州茅台实时行情：现价 1281.91、涨跌 -25.31、成交额 6743202681 等。 | `/tmp/siteflow-eastmoney-quote.json` |
| `eastmoney kline` | `600519.SH --period day --limit 5` | 成功 | 返回最近 5 根日 K，含 open/close/high/low/volume/turnoverRate。 | `/tmp/siteflow-eastmoney-kline.json` |
| `eastmoney trades` | `600519.SH --limit 5` | 成功 | 返回最近 5 条逐笔成交 tick。 | `/tmp/siteflow-eastmoney-trades.json` |
| `eastmoney flow` | `600519.SH` | 成功 | 返回资金流向分钟序列，数据量较大但结构完整。 | `/tmp/siteflow-eastmoney-flow.json` |
| `eastmoney announcements` | `600519.SH --limit 3` | 成功 | 返回 3 条最新公告列表。 | `/tmp/siteflow-eastmoney-announcements.json` |
| `eastmoney reports` | `600519.SH --limit 3` | 成功 | 返回 3 份研报，含机构名、评级、标题、发布日期。 | `/tmp/siteflow-eastmoney-reports.json` |
| `eastmoney guba` | `600519.SH --limit 3` | 成功 | 返回股吧文章列表，包含帖子标题、用户、点击、评论、发布时间。 | `/tmp/siteflow-eastmoney-guba.json` |

备注：

- 本站点全部为真实读取型执行，无 dry-run。
- 无真实下载、无上传、无发布副作用。

### github

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `github trending` | `--language typescript --since weekly --limit 3` | 成功 | 真实打开 Trending 页面，返回 3 个 TypeScript 热门仓库。 | `/tmp/siteflow-github-trending.json` |
| `github repo` | `microsoft/TypeScript` | 成功 | 通过 GitHub API 返回仓库详情，包括 stars、forks、defaultBranch、更新时间。 | `/tmp/siteflow-github-repo.json` |
| `github releases` | `microsoft/TypeScript --limit 3` | 成功 | 返回最近 3 个 release，如 `v6.0.3`、`v6.0.2`。 | `/tmp/siteflow-github-releases.json` |
| `github issues` | `microsoft/TypeScript --state open --limit 3` | 成功 | 返回 3 条 open issues / PR 记录。 | `/tmp/siteflow-github-issues.json` |
| `github search-repos` | `'browser automation' --sort stars --limit 3` | 成功 | 返回 3 个高星搜索结果，如 `vercel-labs/agent-browser`。 | `/tmp/siteflow-github-search.json` |

备注：

- 全部为真实执行，无 dry-run。
- 无真实下载、无上传、无发布副作用。

### hackernews

状态：已完成（`user` 解析已修复）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `hackernews frontpage` | `--limit 3` | 成功 | 返回首页前 3 条故事，含 rank、id、title、points、user、comments。 | `/tmp/siteflow-hn-frontpage.json` |
| `hackernews newest` | `--limit 3` | 成功 | 返回最新发布前 3 条。 | `/tmp/siteflow-hn-newest.json` |
| `hackernews ask` | `--limit 3` | 成功 | 返回 Ask HN 前 3 条。 | `/tmp/siteflow-hn-ask.json` |
| `hackernews show` | `--limit 3` | 成功 | 返回 Show HN 前 3 条。 | `/tmp/siteflow-hn-show.json` |
| `hackernews jobs` | `--limit 3` | 成功 | 返回 jobs 前 3 条。 | `/tmp/siteflow-hn-jobs.json` |
| `hackernews item` | `48388324` | 成功 | 成功进入 story 页面并采样 20 条评论。 | `/tmp/siteflow-hn-item.json` |
| `hackernews user` | `cloud8421` | 成功 | 现已正确解析 user / created / karma / about 以及 submissions / favorites 链接。 | `/tmp/siteflow-hn-user-fixed.json` |

备注：

- `user` 页面解析已从空对象修复为通用 `tr/td` 配对解析。
- 无真实下载、无上传、无发布副作用。
- 全部为真实执行，无 dry-run。
- `item` / `user` 参数来自 `frontpage` 第一条 story。
- 无真实下载、无上传、无发布副作用。

### jimeng

状态：已完成（完成判定已改进）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `jimeng status` | 无 | 成功 | 成功进入即梦首页，页面为 `https://jimeng.jianying.com/ai-tool/home`。 | `/tmp/siteflow-jimeng-status.json` |
| `jimeng generate` | `--prompt '极简蓝白风格产品图标，一枚带有浏览器和流程箭头的抽象技术图形' --screenshot /tmp/siteflow-jimeng-filled.png` | 成功 | 成功填入 prompt，但未提交。 | `/tmp/siteflow-jimeng-generate-fill.json` |
| `jimeng generate` | `--prompt '极简蓝白风格产品图标，一枚带有浏览器和流程箭头的抽象技术图形' --submit --wait 10000 --screenshot /tmp/siteflow-jimeng-submit-fixed2.png` | 已真实提交 | 现在会优先点击“搜索”按钮，并用 `submissionLikely=true` 标记真实提交迹象；状态为 `submitted_unconfirmed`，但不再把已提交流程记成失败。 | `/tmp/siteflow-jimeng-submit-fixed2.json` |

备注：

- 本站点已覆盖全部命令面。
- `generate --submit` 的判定已改进：即使没有看到固定“生成完成”文本，也会根据页面状态给出 `submitted_unconfirmed` + `submissionLikely=true`。
- 第二次 `generate --submit` 属于真实外部副作用：已真实向即梦提交生成请求。

### media

状态：已完成（主播放列表下载需要先选具体 media playlist）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `media inspect` | `https://example.com/` | 成功 | 识别为普通 HTML 资源，返回 preview。 | `/tmp/siteflow-media-inspect-example.json` |
| `media inspect` | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 --out /tmp/siteflow-media-inspect-hls` | 成功 | 识别为未加密 HLS master playlist，列出 5 条可选 media playlists。 | `/tmp/siteflow-media-inspect-hls.json` |
| `media download` | `https://example.com/ --out /tmp/siteflow-media-download-example --filename example-index.html --i-have-rights` | 成功 | 真实下载普通资源，写入 HTML 文件。 | `/tmp/siteflow-media-download-example.json` |
| `media download` | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 --out /tmp/siteflow-media-download-hls --filename mux-sample --i-have-rights` | 受限 | 真实执行后明确拒绝直接下载 master playlist，返回 `MASTER_PLAYLIST_ONLY`。 | `/tmp/siteflow-media-download-hls.json` |
| `media download` | `https://test-streams.mux.dev/x36xhzz/url_4/193039199_mp4_h264_aac_7.m3u8 --out /tmp/siteflow-media-download-hls-selected --filename mux-sample-512p --i-have-rights` | 成功 | 真实下载 64 段 HLS，产出 39MB `mux-sample-512p.ts`。 | `/tmp/siteflow-media-download-hls-selected.json` |

备注：

- 本站点全部为真实执行，无 dry-run。
- 真实副作用：下载了 `example-index.html` 和 `mux-sample-512p.ts` 两个文件。
- adapter 行为合理：master playlist 只能 inspect，想下载必须选具体 media playlist。

### producthunt

状态：已完成（全部命令被 Cloudflare 挑战阻断）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `producthunt status` | 无 | 受限 | 真实进入首页，但被 Cloudflare 安全验证阻断，返回 `blocked_by_challenge`。 | `/tmp/siteflow-producthunt-status.json` |
| `producthunt open` | `/` | 受限 | 首页 route 打开成功，但仍落在挑战页。 | `/tmp/siteflow-producthunt-open-home.json` |
| `producthunt open` | `/posts/chatgpt` | 受限 | 具体帖子 route 打开成功，但同样被挑战页阻断。 | `/tmp/siteflow-producthunt-open-post.json` |

备注：

- 本站点命令已全部真实执行。
- adapter 行为符合预期：检测 challenge，明确停止，不绕过。
- 无真实下载、无上传、无发布副作用。

### reddit

状态：已完成（全部命令被 Reddit network security 阻断）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `reddit subreddit` | `programming --limit 3` | 受限 | 真实请求 `.json` endpoint，但返回 403 challenge/block page，状态 `network_security_blocked`。 | `/tmp/siteflow-reddit-subreddit.json` |
| `reddit search` | `browser --subreddit programming --limit 3` | 受限 | 搜索接口同样返回 403 block page。 | `/tmp/siteflow-reddit-search.json` |
| `reddit post` | `1i0mhmj` | 受限 | 指定 post 的 `.json` 接口同样被阻断。 | `/tmp/siteflow-reddit-post.json` |
| `reddit comments` | `1i0mhmj --limit 5` | 受限 | 评论接口同样被阻断。 | `/tmp/siteflow-reddit-comments.json` |

备注：

- 本站点命令已全部真实执行。
- 当前 adapter 已不再 JSON parse 崩溃，而是正确把站点返回的 403 block page 结构化为 `network_security_blocked`。
- 无真实下载、无上传、无发布副作用。

### rouman5

状态：已完成

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `rouman5 status` | 无 | 成功 | 返回站点首页状态，识别 18+ 门槛、登录入口和授权要求。 | `/tmp/siteflow-rouman5-status.json` |
| `rouman5 home` | `--limit 3` | 成功 | 返回首页 3 部推荐作品。 | `/tmp/siteflow-rouman5-home-2.json` |
| `rouman5 search` | `漫画 --limit 3` | 成功 | 返回 3 条搜索结果。 | `/tmp/siteflow-rouman5-search-2.json` |
| `rouman5 comic` | `https://rouman5.com/books/cmmgn12ou000ws6p7vny408rs` | 成功 | 真实解析作品详情，作品名已正确提取为“我想安静地工作”。 | `/tmp/siteflow-rouman5-comic-2.json` |
| `rouman5 chapters` | `https://rouman5.com/books/cmmgn12ou000ws6p7vny408rs` | 成功 | 返回完整 24 章章节列表。 | `/tmp/siteflow-rouman5-chapters-2.json` |
| `rouman5 chapter` | `cmmgn12ou000ws6p7vny408rs/1` | 成功 | 返回章节元数据，图片数组已按页序稳定。 | `/tmp/siteflow-rouman5-chapter-2.json` |
| `rouman5 download` | `cmmgn12ou000ws6p7vny408rs/1 --out /tmp/siteflow-rouman5-real-download --apply --i-have-rights` | 成功 | 真实下载第 2 话全部 45 张图，并生成 `reader.html`。 | `/tmp/siteflow-rouman5-download-2.json` |
| `rouman5 download-book` | `https://rouman5.com/books/cmmgn12ou000ws6p7vny408rs --limit 2 --out /tmp/siteflow-rouman5-book-download --apply --i-have-rights` | 成功 | 真实下载前 2 章，共 119 张图，生成总索引页。 | `/tmp/siteflow-rouman5-download-book-2.json` |

备注：

- 本站点命令全部真实执行，无 dry-run。
- 真实副作用：下载了 1 个章节阅读目录和 1 个整书索引目录。
- 已验证修复生效：作品名不再误写成“全部漫畫”，reader 标题也跟随修复。

### sec

状态：已完成（download 错误提示已改进）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `sec company` | `AAPL` | 成功 | 解析出 Apple Inc.、CIK=`0000320193`。 | `/tmp/siteflow-sec-company.json` |
| `sec filings` | `AAPL --limit 3` | 成功 | 返回最近 3 条 filing。 | `/tmp/siteflow-sec-filings.json` |
| `sec filing` | `0000320193-26-000081 --cik 0000320193` | 成功 | 成功构造 archive URL receipt。 | `/tmp/siteflow-sec-filing.json` |
| `sec facts` | `AAPL` | 成功 | 返回 Apple company facts。 | `/tmp/siteflow-sec-facts.json` |
| `sec download` | `0000320193-26-000081 --cik 0000320193 --out /tmp/siteflow-sec-download` | 失败但提示清晰 | 现在返回 `SEC_ARCHIVE_NOT_FOUND`，并带 `indexStatus=404`。 | `/tmp/siteflow-sec-download-check.json` |
| `sec filings` | `AAPL --forms 10-K --limit 1` | 成功 | 额外查询得到真实 10-K accession。 | `/tmp/siteflow-sec-filings-10k.json` |
| `sec download` | `0000320193-25-000073 --cik 0000320193 --out /tmp/siteflow-sec-download-10k` | 成功 | 成功真实下载 SEC archive HTML 文件。 | `/tmp/siteflow-sec-download-10k.json` |

备注：

- 首次 `download` 失败现在不再是模糊错误，而是结构化提示用户先核对 accession/CIK。
- 真实副作用：下载了 `/tmp/siteflow-sec-download-10k/0000320193-25-000073-0000320193-25-000073-index-headers.html`。

### suno

状态：已完成（表单定位已改成单输入框 + ready gate 识别）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `suno status` | 无 | 成功 | 成功进入 Suno 首页，未检测到 captcha。 | `/tmp/siteflow-suno-status.json` |
| `suno create` | `--title 'Siteflow Demo Song' --lyrics-file /tmp/siteflow-suno-lyrics.txt --style-file /tmp/siteflow-suno-style.txt --screenshot /tmp/siteflow-suno-filled.png` | 成功 | 现改为把 lyrics + style 合并写入单一输入框；页面随后进入 `Your songs are ready` / `Join Suno for free to listen` gate。 | `/tmp/siteflow-suno-fixed-fill.json` |
| `suno create` | `--title 'Siteflow Demo Song' --lyrics-file /tmp/siteflow-suno-lyrics.txt --style-file /tmp/siteflow-suno-style.txt --submit --wait 15000 --screenshot /tmp/siteflow-suno-fixed-submit2.png` | 成功（未确认完成） | 不再因第二个 textarea 或 `Create song` 按钮缺失而报错；当前会稳定返回 `submitted_unconfirmed`，并明确识别 ready gate。 | `/tmp/siteflow-suno-fixed-submit2.json` |

备注：

- 当前站点并不是传统双输入框表单，匿名流程会在填入后直接切到 `Join Suno for free to listen` gate。
- 已修复的重点是：命令不再因过时 DOM 假设直接失败。
- 无真实生成文件落地；副作用仍停在 Suno 的登录/试听 gate。

### telegram

状态：已完成（公共频道链路成功，Web 登录链路因未登录而受限）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `telegram chats` | `--limit 5` | 受限 | Telegram Web 未登录，返回 `login_required_or_empty`。 | `/tmp/siteflow-telegram-chats.json` |
| `telegram channel` | `durov --limit 3` | 成功 | 公共频道镜像链路成功，抓到 Pavel Durov 频道最近 3 条消息。 | `/tmp/siteflow-telegram-channel.json` |
| `telegram search` | `durov Telegram --limit 3` | 成功 | 成功在公开频道内按关键词搜索消息。 | `/tmp/siteflow-telegram-search.json` |
| `telegram post` | `durov 1 --limit 5` | 成功 | 成功打开公开 post 窗口并抓取周边 5 条消息。 | `/tmp/siteflow-telegram-post.json` |
| `telegram open` | `https://web.telegram.org/a/#@durov` | 受限 | Web 侧未登录，chat pane 未加载。 | `/tmp/siteflow-telegram-open.json` |
| `telegram messages` | `https://web.telegram.org/a/#@durov --limit 10 --pages 1` | 受限 | Web 侧无可见消息。 | `/tmp/siteflow-telegram-messages.json` |
| `telegram links` | `https://web.telegram.org/a/#@durov --limit 10 --pages 1` | 受限 | Web 侧无可见链接。 | `/tmp/siteflow-telegram-links.json` |
| `telegram media` | `https://web.telegram.org/a/#@durov --limit 10 --pages 1` | 受限 | Web 侧无可见媒体消息。 | `/tmp/siteflow-telegram-media.json` |
| `telegram watch` | `https://web.telegram.org/a/#@durov --duration 10s --interval 5s --limit 10 --pages 1 --max-messages 20 --out /tmp/siteflow-telegram-watch.json` | 部分成功 | watch 真实执行并写出 watch 文件，但因未登录未采到消息。 | `/tmp/siteflow-telegram-watch-receipt.json` |
| `telegram open-link` | `https://web.telegram.org/a/#@durov 0` | 受限 | 因上游 links 为空，没有可打开链接。 | `/tmp/siteflow-telegram-open-link.json` |

备注：

- 本站点命令已全部真实执行。
- `t.me/s` 公共频道链路工作正常；`web.telegram.org/a/` 系列命令需要该 profile 先手工登录 Telegram Web。
- 真实副作用：`watch` 写出了 `/tmp/siteflow-telegram-watch.json` 监控文件；无上传、无发送消息、无发布副作用。

### twitter / x

状态：已完成（Profile/Tweet 真实链路成功；Home/Search 受登录态限制；部分 replay 命令受 cursor 条件限制）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `twitter status` | `--url https://x.com/durov` | 成功 | 真实进入公开 profile，状态正常，可见 tweet 数 8。 | `/tmp/siteflow-twitter-status-default.json` |
| `twitter collect` | `--url https://x.com/durov --limit 5 --scroll-pages 1` | 成功 | 成功抓取 profile 页面 5 条可见 tweet。 | `/tmp/siteflow-twitter-collect-default-receipt.json` |
| `twitter search` | `--query Telegram --limit 5 --scroll-pages 1` | 受限 | 搜索页跳转到登录引导页，tweetCount=0。 | `/tmp/siteflow-twitter-search-default-receipt.json` |
| `twitter detail` | `--url https://x.com/durov/status/1926381625316642906` | 成功 | 成功抓到 TweetDetail GraphQL 数据，tweet=1，media=1。 | `/tmp/siteflow-twitter-detail-receipt.json` |
| `twitter api-capture` | `--match 'TweetDetail|graphql' --out /tmp/siteflow-twitter-api-capture-default.json` | 成功 | 在 tweet 详情页上成功提取 GraphQL tweet/cursor/media。 | `/tmp/siteflow-twitter-api-capture-default-receipt.json` |
| `twitter home-checkpoint` | `--out /tmp/siteflow-twitter-home-checkpoint.json` | 受限 | 当前 profile 无 HomeTimeline 响应，返回 `no_home_timeline_response`。 | `/tmp/siteflow-twitter-home-checkpoint-receipt.json` |
| `twitter home-diff` | `--before /tmp/siteflow-twitter-home-checkpoint.json` | 受限但可执行 | before/after 都为空，diff 完成但无 timeline 数据。 | `/tmp/siteflow-twitter-home-diff-receipt.json` |
| `twitter home-page` | `--checkpoint /tmp/siteflow-twitter-home-checkpoint.json --cursor bottom` | 失败 | checkpoint 不含 HomeTimeline endpoint。 | `/tmp/siteflow-twitter-home-page-receipt.json` |
| `twitter profile-checkpoint` | `--handle durov --out /tmp/siteflow-twitter-profile-checkpoint.json` | 成功 | 成功采到 100 条 profile timeline tweet，含 media=17。 | `/tmp/siteflow-twitter-profile-checkpoint-receipt.json` |
| `twitter profile-page` | `--checkpoint /tmp/siteflow-twitter-profile-checkpoint.json --cursor bottom` | 失败 | checkpoint 不含 bottom cursor。 | `/tmp/siteflow-twitter-profile-page-receipt.json` |
| `twitter profile-diff` | `--handle durov --before /tmp/siteflow-twitter-profile-checkpoint.json` | 成功 | 真实执行 profile diff，结果无新增 tweet。 | `/tmp/siteflow-twitter-profile-diff-receipt.json` |
| `twitter media-list` | `--from-dump /tmp/siteflow-twitter-dump/manifest.json --out /tmp/siteflow-twitter-media-list.json` | 成功但为空 | network dump 可读，但未从 manifest 中提取到可下载 media。 | `/tmp/siteflow-twitter-media-list-receipt.json` |
| `twitter media-download` | `--from-media-list /tmp/siteflow-twitter-media-list.json --dir /tmp/siteflow-twitter-media --apply` | 成功但为空 | 输入 media-list 为空，因此没有下载文件。 | `/tmp/siteflow-twitter-media-download-receipt.json` |
| `x more` | `--pages 1 --limit 20 --network-limit 300` | 成功 | 在 tweet 当前页继续滚动并保留当前 tweet + media 元数据。 | `/tmp/siteflow-x-more-receipt.json` |
| `x home` | `--pages 1 --wait 7000` | 受限 | 当前 profile 无 HomeTimeline 响应。 | `/tmp/siteflow-x-home-default-receipt.json` |
| `x profile` | `durov --pages 1` | 成功 | 成功采集 profile，tweet=100，media=17。 | `/tmp/siteflow-x-profile-receipt.json` |
| `x tweet` | `https://x.com/durov/status/1926381625316642906` | 成功 | 成功采到 tweet 详情，media=1。 | `/tmp/siteflow-x-tweet-receipt.json` |
| `x download` | `https://x.com/durov/status/1926381625316642906 --apply --media-dir /tmp/siteflow-x-download-media` | 成功 | 真实下载 1 张 tweet 图片到本地。 | `/tmp/siteflow-x-download-receipt.json` |

备注：

- `site-auth-all` profile 上的 X cookies 已失效或不可用，因此 Home/Search 相关命令会落到 onboarding/login 页；后续改用 `default` profile 完成公开 profile/tweet 链路验证。
- 真实副作用：`x download` 下载了 1 个媒体文件到 `/tmp/siteflow-x-download-media`；network dump 写出 `/tmp/siteflow-twitter-dump/manifest.json`；截图与 JSON 产物已生成。
- `home-page` 和 `profile-page` 的失败都不是 CLI 崩溃，而是 checkpoint 本身缺少 replay 所需 cursor/endpoint。

### xhs

状态：已完成（draft 命令被登录页阻断）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `xhs status` | 无 | 成功 | 成功进入发布页 URL，页面标题为“小红书创作服务平台”。 | `/tmp/siteflow-xhs-status.json` |
| `xhs draft` | `--title 'Siteflow 小红书测试' --body '这里是一条真实执行的小红书草稿测试内容。' --topic 测试 --image /tmp/siteflow-xhs-image.webp --screenshot /tmp/siteflow-xhs-draft.png` | 受限 | 真实执行后被重定向到登录页，返回 `auth_required`，没有进入填草稿阶段。 | `/tmp/siteflow-xhs-draft.json` |

备注：

- 本站点命令已全部真实执行。
- 当前 profile 未登录小红书创作服务平台，因此 draft 命令在填充前被 401 登录跳转拦截。
- 无真实草稿创建、无上传副作用。

### xueqiu

状态：已完成（核心行情链路已恢复，状态/评论参数约束已收紧）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `xueqiu home` | `--limit 3` | 失败 | 首页聚合链路仍不稳定。 | `/tmp/siteflow-xueqiu-home.json` |
| `xueqiu hot` | `--limit 3` | 成功 | 成功返回 3 条热议事件。 | `/tmp/siteflow-xueqiu-hot.json` |
| `xueqiu search` | `AI --limit 3` | 失败 | 搜索链路仍存在页面导航/加载问题。 | `/tmp/siteflow-xueqiu-search.json` |
| `xueqiu quote` | `SH600519` | 成功 | 已恢复，直接在首页 tab 里成功调用 quote API。 | `/tmp/siteflow-xueqiu-quote-fixed.json` |
| `xueqiu minute` | `SH600519 --period 1d` | 成功 | 已恢复，返回 242 个分钟点。 | `/tmp/siteflow-xueqiu-minute-fixed.json` |
| `xueqiu trades` | `SH600519 --count 5` | 成功 | 已恢复，返回最近 5 条逐笔。 | `/tmp/siteflow-xueqiu-trades-fixed.json` |
| `xueqiu orderbook` | `SH600519` | 成功 | 已恢复，返回盘口 10 档数据。 | `/tmp/siteflow-xueqiu-orderbook-fixed.json` |
| `xueqiu discussions` | `SH600519 --limit 3` | 失败 | 已从“导航超时”收敛为明确的 `PAGE_CONTEXT_FETCH_FAILED`。 | `/tmp/siteflow-xueqiu-discussions-final.json` |
| `xueqiu status` | `8295091535/382601245` | 受限 | 现在会对真实状态页正确返回 `CHALLENGE_DETECTED`，不再误判。 | `/tmp/siteflow-xueqiu-status-real2.json` |
| `xueqiu comments` | `8295091535/382601245 --limit 3` | 受限 | 使用真实状态目标后，接口本身可达，但页面被滑动验证拦截，因此返回 `CHALLENGE_DETECTED`。 | `/tmp/siteflow-xueqiu-comments-real2.json` |
| `xueqiu finance` | `SH600519 --count 3` | 成功 | 已恢复，成功返回 3 期财务指标。 | `/tmp/siteflow-xueqiu-finance-fixed.json` |

备注：

- 当前主要修复成果是：quote/minute/trades/orderbook/finance 不再依赖不稳定的详情页导航，已能稳定跑通。
- `status` 参数契约已收紧，且在真实状态 URL 上会正确识别挑战页。
- `comments` 链路也已验证到真实状态目标，当前主要阻塞是雪球滑动验证，不再是参数不对。
- `discussions` 现在已从超时收敛为可诊断的 `PAGE_CONTEXT_FETCH_FAILED`。

### youtube

状态：已完成（transcript 失败原因已明确为“字幕体不可用”）

| 命令 | 参数 | 结果 | 摘要 | 产物 |
| --- | --- | --- | --- | --- |
| `youtube search` | `AI --limit 3` | 成功 | 成功返回 3 条搜索结果。 | `/tmp/siteflow-youtube-search.json` |
| `youtube video` | `dQw4w9WgXcQ` | 成功 | 成功解析视频详情、标题、频道、描述、时长、播放量和发布时间。 | `/tmp/siteflow-youtube-video.json` |
| `youtube channel` | `@RickAstleyYT` | 成功 | 成功进入频道主页并抓取频道文本摘要。 | `/tmp/siteflow-youtube-channel.json` |
| `youtube comments` | `dQw4w9WgXcQ --limit 5` | 成功 | 成功返回 5 条评论。 | `/tmp/siteflow-youtube-comments.json` |
| `youtube transcript` | `dQw4w9WgXcQ --out /tmp/siteflow-youtube-transcript-fixed4` | 受限 | 已能准确区分“有 caption tracks 但正文体为空”的情况，返回 `TRANSCRIPT_UNAVAILABLE`，不再是模糊抓取失败。 | `/tmp/siteflow-youtube-transcript-fixed4.json` |

备注：

- 本站点命令已全部真实执行。
- `transcript` 当前针对该视频的真实结果是：字幕轨道存在，但 watch 页 timedtext 正文不可用。
- 无真实下载、无上传、无发布副作用。

---

## 最终汇总

### 已串行执行完成的站点

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

### 总体判断

- **稳定成功**：1688、bilibili、cninfo、eastmoney、github、media、rouman5、youtube（除 transcript）、sec（除首次错误 accession）、telegram 公共频道链路、twitter/x 的公开 profile/tweet/media 下载链路。
- **受登录态阻断**：douyin、telegram Web、xhs、X Home/Search。
- **受挑战页阻断**：producthunt、reddit。
- **DOM/站点结构漂移**：suno、jimeng 完成判定不稳、hackernews user 解析为空。
- **站点导航不稳定**：xueqiu 大量命令 `page.goto` 超时，仅 `hot` 和 `finance` 稳定成功。

### 后续建议

1. **Douyin**：修 `isAuthRequired()`，避免登录页误判成成功空结果。  
2. **Hacker News**：修 `user` 页面 DOM 解析器。  
3. **Suno**：更新 textarea / Create song 按钮定位策略。  
4. **Jimeng**：`generate --submit` 增加结果卡片或任务状态检测，不要只等“生成完成”文本。  
5. **SEC**：`download` 失败时补一个 accession/index 可用性提示。  
6. **Xueqiu**：加强导航等待和页面稳定性；为 `status/comments` 找到可靠动态 id 来源。  
7. **YouTube**：修 transcript 的 timedtext fetch 失败。  
8. **Twitter/X**：Home/Search 相关命令依赖有效登录态；replay 命令依赖 checkpoint 中存在 cursor/endpoint。  

### 2026-06-04 04:00 cron: jsrev site migration watchdog

状态：迁移守护推进完成，验证通过

- 并行会话检查：未发现正在执行的 `jsrev-cli capabilities migration` 会话。
- 测试用例梳理：
  - `test/unit/site-import-governance.test.mjs` 约束 site adapters 不直接 import daemon client/helper internals，`http-utils` 保持 Browser Kernel neutral，capabilities facade 不暴露 legacy daemon-shaped adapter names。
  - `test/unit/adapter-proofs.test.mjs` 覆盖 BrowserRuntime attach 重置、twitter/xhs migrated capability deps proof。
  - `test/unit/browser-kernel-context.test.mjs`、`page-observation.test.mjs`、`network-recorder.test.mjs` 覆盖 Browser Kernel state/observation/network 行为。
  - `test/smoke/fixture-smoke.mjs` 使用本地 HTTP fixture 验证 daemon/browser/eval/console/network 端到端路径；临时 `SITEFLOW_HOME` 位于系统 tmp，结束后清理。
- 迁移状态：当前普通站点 adapter 已通过 `src/sites/capabilities.ts` facade 访问浏览器/页面/网络能力；直接 daemon client import 仅保留在 governance allowlist 中的 facade/helper/runner 层。
- 本轮验证：
  - `npm run typecheck` ✅
  - `npm run test:unit` ✅ 24/24 passed
  - `npm run smoke:fixture` ✅
- 隐私 artifact：本轮仅新增/使用 fixture smoke 临时目录，已由脚本 finally 清理；未提交 cookie、trace、receipt 等隐私 artifact。

### 2026-06-04 05:00 cron: jsrev site migration watchdog

状态：继续迁移 Browser Kernel 相关 page-id/open-or-navigate 能力，验证通过

- 并行会话检查：未发现正在执行的 `jsrev` 相关会话，因此本轮直接推进。
- 执行前测试用例梳理：
  - `test/unit/site-import-governance.test.mjs`：约束 adapters 不直接 import daemon client/helper internals；本轮扩展为同时断言 `http-utils.ts` 不再承载 browser page-id helper，保持 Browser Kernel neutral。
  - `test/unit/adapter-proofs.test.mjs`：覆盖 BrowserRuntime attach reset、twitter/xhs capability deps proof、douyin 登录页 auth detection。
  - `test/unit/site-registry.test.mjs`：确保 built-in adapter/commands 仍完整暴露。
  - `test/smoke/fixture-smoke.mjs`：本地 fixture 端到端验证 build、daemon/browser/evaluate/console/network 路径，`SITEFLOW_HOME` 使用系统临时目录并清理。
- 本轮迁移：
  - 将 `addPageIdOption` 从 `http-utils.ts` 迁入 `src/sites/capabilities.ts`，命名为 `addSitePageIdOption`，让 page-id CLI 能力归属 Browser Kernel facade。
  - 保留/使用 `openOrNavigateSitePage()` 作为统一 open/navigate facade；Bilibili、GitHub、YouTube、Xueqiu 的 page-id 浏览器路径都通过 capabilities facade。
  - `http-utils.ts` 现在只保留 fetch/text/download/receipt/clamp 等 browser-kernel-neutral 工具。
- 本轮验证：
  - `npm run typecheck` ✅
  - `npm run test:unit` ✅ 25/25 passed
  - `npm run smoke:fixture` ✅
- 隐私 artifact：未新增 cookie、trace、receipt 等隐私 artifact；fixture smoke 使用临时目录并由脚本清理。
