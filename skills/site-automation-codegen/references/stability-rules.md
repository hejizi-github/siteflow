# Stability Rules

这份规则讲的是：怎样让生成出来的 adapter 不脆。

## 1. 选择器稳定性

优先级：

1. 明确业务 selector
2. 明确可见文本 / aria label
3. 稳定父节点 + 子节点约束
4. `nth`
5. 坐标点击兜底

### 应该做

- 优先选语义上稳定的控件；
- 文案可能变化时，用更高层、更稳定的可交互父节点；
- 坐标点击只放 fallback；
- `nth` 前先确认列表顺序对业务是否稳定。

### 不该做

- 把随机 class name 当长期 selector；
- 没看页面就上 `nth: 7`；
- 一开始就用坐标点击；
- 多个逻辑分支共用一个模糊选择器却不校验结果。

## 2. 等待与确认

### 原则

- `sleep` 是缓冲，不是证明；
- 每个关键动作后，最好有一个可验证的后置条件；
- 上传、提交、生成后必须重新读页面或网络。

### 常见确认手段

- `expectText` / `expectSelector` / `expectUrlContains`（browser click 层）
- `readSiteSnapshot`
- `readRecentSiteErrors`
- `waitForText`
- `listSiteNetwork` 是否出现目标请求

### 反模式

- 全流程只靠几个固定 `sleep`；
- 点击之后不校验页面是否真的变化；
- 生成/发布后直接返回成功，不复读页面。

## 3. 登录态与 challenge

### 登录态检测

登录态不要只看 URL，也要看页面文字信号。

参考模式：`douyin.ts`、`xhs.ts`

- URL 是否进入 `/login`
- 页面是否出现 “扫码 / 验证码 / 手机号登录 / 短信登录”
- 页面是否缺少认证后才能看到的正向信号

### challenge 检测

优先做显式检测并停下：

- CAPTCHA
- Turnstile
- Cloudflare challenge
- 年龄门槛

返回：
- `state: blocked_by_challenge`
- `errors`
- `next: ['Complete the challenge manually, then rerun ...']`

## 4. 副作用边界

### 默认原则

- 默认只观察、不提交；
- 默认只填充、不发布；
- 默认只生成草稿证据，不做最终不可逆动作。

### 允许副作用时

必须满足：
- 显式参数开启，如 `--submit` / `--publish` / `--save-draft`
- 命令描述里明确说明副作用
- receipt 返回提交后的页面证据
- 若无法确认结果，返回 `submitted_unconfirmed` 一类状态，而不是谎称成功

## 5. 数据提取稳定性

### DOM 提取

- 统一 `clean` 文本；
- 列表采样要限流，用 `slice(0, limit)`；
- 缺字段允许 `undefined`，不要为了凑结构写假值；
- 表达式中尽量返回 plain object / array，减少复杂闭包。

### network 提取

- 先判断 response body 是否 available；
- 解析 JSON 前捕获异常并回到结构化错误；
- endpoint 不存在时返回 `missing_network_evidence` 或类似状态；
- replay 前确认 request body/URL 里真正包含 cursor/variables。

## 6. Receipt 设计

一个好 receipt 至少回答五件事：

1. 运行的是哪个 site / command
2. 当前到底成功、失败还是停在人审边界
3. 页面/请求证据是什么
4. 为什么失败
5. 用户下一步该做什么

### 推荐字段

- `site`
- `command`
- `ok`
- `state`
- `page`
- `observations`
- `errors`
- `next`
- `screenshots`（仅在显式需要时）

### 常见 state

- `observed`
- `*_collected`
- `filled_not_submitted`
- `draft_filled_publish_not_clicked`
- `auth_required`
- `blocked_by_challenge`
- `empty_result`
- `invalid_response`
- `missing_network_evidence`
- `submitted_unconfirmed`
- `invalid_options`

## 7. 测试与验证

### 至少要做

- `npm run typecheck`
- `npm run test:unit`

### 需要补 proof / 单测的情况

- 新增 adapter
- 调整 registry
- 提炼了纯解析函数
- 引入了新的 auth/challenge 识别逻辑
- 改了 capability 使用边界

### CLI 级验证重点

- `siteflow --json sites list` 能看到新 adapter
- 核心命令返回结构化 receipt
- 失败路径不会抛非结构化错误
- mutating flow 默认不越过人审边界

## 8. 安全红线

- 不泄露 cookie / token / Authorization / session
- 不在 receipt 里放完整敏感请求体
- 不把用户私密上传内容作为测试 fixture
- 不实现绕过验证码、风控、付费墙、DRM
- 不为了“自动化更完整”而突破仓库已经定义的人审边界
