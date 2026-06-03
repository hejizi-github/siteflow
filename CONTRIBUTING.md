# 贡献指南

感谢你考虑贡献 Siteflow。这个项目的核心是：本地 Browser Kernel + 可复用站点工作流。贡献时请优先保持架构边界清晰、输出稳定、安全边界明确。

## 开发环境

要求：

- Node.js `>=20.0.0`
- npm

安装和构建：

```bash
npm install
npm run build
```

常用验证：

```bash
npm run typecheck
npm run test:unit
npm pack --dry-run
```

## 项目结构

- `src/cli/`：Commander CLI 入口和 JSON 输出。
- `src/daemon/`：本地 daemon client/server、lock、state。
- `src/runtime/`：Browser Kernel，负责 Playwright/CDP、network、console、debugger、auth、storage、hooks、page actions。
- `src/sites/`：站点 adapter、registry、runner、capabilities facade。
- `src/shared/`：跨层类型、路径、错误。
- `src/traces/`：failure receipt 和 trace artifact。
- `test/unit/`：Node 内置 `node:test` 测试。

## 架构边界

站点 adapter 的调用链必须是：

```text
site adapter
  -> src/sites/capabilities.ts
    -> daemon client
      -> Browser Kernel
```

不要在 adapter 中直接：

- import `../daemon/client.js`；
- import `./helpers.js`；
- 创建 Playwright browser/page；
- 手写 daemon HTTP 请求；
- 直接 `console.log` 或 `process.exit()`。

导入边界由 `test/unit/site-import-governance.test.mjs` 保护。

## 新增 Site Adapter

1. 新建 `src/sites/<id>.ts`。
2. 实现 `SiteAdapter`。
3. 命令通过 `runSiteCommand` 注册和输出。
4. 在 `src/sites/registry.ts` 加入 adapter。
5. 通过 `src/sites/capabilities.ts` 使用浏览器能力。
6. 增加或更新测试。
7. 运行：

```bash
npm run typecheck
npm run test:unit
```

adapter receipt 应该稳定返回：

```json
{
  "site": "example",
  "command": "status",
  "ok": true,
  "state": "observed",
  "observations": {},
  "errors": [],
  "next": []
}
```

## 安全规则

不要提交：

- cookie、token、Authorization header；
- browser profile；
- network dump、HAR、trace、receipt；
- 真实账号截图或私信/订单/财务信息；
- campaign 输出、下载文件、站点抓取原始数据。

遇到验证码、Cloudflare、Turnstile、登录页、年龄门槛、DRM、付费墙或平台风控时，正确行为是报告结构化状态，不是绕过。

## 测试要求

- 修改 TypeScript 代码：运行 `npm run typecheck`。
- 修改 runtime、daemon、sites、shared types 或 adapter 边界：运行 `npm run test:unit`。
- 修改发布边界：运行 `npm pack --dry-run`。
- 改 bug 要加回归测试。
- 测试使用 Node 内置 `node:test` 和 `node:assert/strict`，不要引入新测试框架。

## PR 要求

PR 标题使用 Conventional Commit 风格，例如：

```text
feat: add hackernews adapter command
fix: preserve network body pruning invariants
chore: harden open-source metadata
```

PR 描述必须包含：

- 解决的问题；
- 改了什么；
- 涉及的架构边界；
- 运行过的验证命令；
- 是否涉及 cookie/network/trace/browser profile；
- 剩余风险或已知限制。

不要提交泛泛的 AI 摘要。维护者应能根据 PR 描述解释代码和边界。
