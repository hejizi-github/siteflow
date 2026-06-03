# 安全政策

Siteflow 是本地浏览器自动化和站点工作流工具。它会接触浏览器 profile、cookie、请求头、network body、trace、receipt、截图和站点页面内容。请按下面规则报告和处理安全问题。

## 支持范围

当前安全维护范围：

- `siteflow-cli` 当前主分支；
- npm 包中发布的 `dist/` 运行时代码；
- Browser Kernel、daemon、auth/cookie、network、trace、site adapter 相关代码。

## 如何报告漏洞

请通过私密渠道报告安全问题。公开 issue 中不要粘贴以下内容：

- cookie、session、Authorization header、API token、私钥；
- 完整 network dump、HAR、trace、receipt；
- 包含真实账号、手机号、邮箱、订单、私信、财务信息的截图；
- 真实浏览器 profile 或解密后的 cookie 数据库；
- 可以直接复用的登录态或第三方服务凭据。

如果必须提供复现证据，请先脱敏：

```text
Cookie: [REDACTED:128]
Authorization: [REDACTED:64]
https://example.com/path?token=[REDACTED]
```

## 不接受的报告类型

Siteflow 不接受、也不会实现以下方向：

- 绕过 CAPTCHA、Turnstile、Cloudflare、登录风控或平台安全检查；
- 绕过 DRM、付费墙、地域限制或访问控制；
- 未授权账号访问、批量账号操作、撞库或平台滥用；
- 提供可直接复用的 cookie、token、私有 API 或站点绕过脚本。

遇到挑战页、登录页、年龄门槛或风控状态时，Siteflow 的正确行为是返回结构化状态，例如 `blocked_by_challenge`、`auth_required`、`age_gate_present`，而不是绕过它。

## 贡献者安全要求

- Cookie 和敏感 header 必须默认脱敏。
- 写入 cookie、network body、trace、receipt、截图等文件时，必须由用户显式指定路径，并使用私有权限。
- 不要把真实 cookie、trace、network dump、browser profile、campaign 输出或截图提交到仓库。
- 新 site adapter 必须通过 `src/sites/capabilities.ts` 使用浏览器能力，不能绕过统一的 profile、redaction、trace 和错误边界。
- 测试 fixture 必须使用合成数据和 `example.com` / `example.test` 等占位符。

## 本地安全建议

- 用临时 `SITEFLOW_HOME` 做测试：

```bash
SITEFLOW_HOME=/tmp/siteflow-test siteflow --json doctor
```

- 不要把 `~/.siteflow/`、`receipts/`、`downloads/`、`traces/` 或导出的 cookie 文件加入 git。
- 分享 issue 或 PR 证据前，先确认截图和 JSON 中没有真实用户数据。
