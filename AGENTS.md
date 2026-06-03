# 仓库级 Agent 指南

请使用与用户相同的语言回复。

这是一个 Node 20+ TypeScript ESM CLI 项目，包名为 `siteflow-cli`，发布命令为 `siteflow`。根目录 `AGENTS.md` 只保留每个任务都需要知道的热路径规则：项目地图、硬约束、架构边界和验证要求。

## 工作原则

- 从第一性原理出发：先看真实需求、代码事实和验证结果；目标不清楚时先和用户确认。
- 代码是事实来源。除非用户明确要求，不要为了理解实现去读普通 Markdown 文档。
- 修改代码前，先读相关代码和最近约束，遵守当前目录最近的 `AGENTS.md`。
- 变更保持聚焦，不要顺手加入无关重构。
- 提交、PR 描述和说明文字中不要暴露 agent 身份，不要添加 co-author attribution。
- 不要提交 cookie、token、trace、receipt、browser profile、network dump、campaign 输出、截图等本地或隐私 artifact。

## 项目地图

- `src/cli/`：Commander CLI 入口、命令注册、全局选项、JSON envelope 输出和顶层错误处理。
- `src/daemon/`：本地 daemon client/server、profile lock、daemon state。daemon server 持有 runtime 实例。
- `src/runtime/`：Browser Kernel。包含 Playwright/CDP 浏览器生命周期、页面选择、page actions、console/network recorder、debugger、hooks、storage、auth/cookie 等底层能力。
- `src/sites/`：站点 adapter、registry、runner、共享 HTTP 工具和 capabilities facade。
- `src/shared/`：跨 CLI/daemon/runtime/sites 的公共类型、路径和错误类型。
- `src/traces/`：failure receipt 和 trace artifact 存储。
- `test/unit/`：Node 内置 `node:test` 单元测试和架构治理测试。
- `test/fixtures/basic/`：本地浏览器 fixture 页面，用于需要临时端到端验证时复用。

## 核心架构边界

Siteflow 的主链路是：

```text
CLI
  -> daemon client
    -> daemon server
      -> Browser Kernel / runtime
        -> Playwright / CDP / page context

site adapter
  -> src/sites/capabilities.ts
    -> daemon client
      -> Browser Kernel
```

硬规则：

- `BrowserRuntime` / `src/runtime/` 是唯一应该持有 Playwright `BrowserContext` / `Page` 生命周期的层。
- `src/daemon/server.ts` 只做 HTTP 路由、输入解析和 runtime 调用，不承载站点业务逻辑。
- `src/daemon/client.ts` 只做 daemon 请求封装，不承载浏览器状态逻辑。
- 站点 adapter 必须通过 `src/sites/capabilities.ts` 使用 daemon/browser 能力。
- 站点 adapter 不得直接 import `../daemon/client.js`，也不得直接依赖 `./helpers.js` 内部能力。
- 允许直接接触 daemon client 的站点基础设施仅限：`src/sites/capabilities.ts`、`src/sites/helpers.ts`、`src/sites/runner.ts`。
- 新增或修改站点 adapter 后，必须保持 `test/unit/site-import-governance.test.mjs` 通过。

## 构建、测试与开发命令

- `npm install`：按 `package-lock.json` 安装依赖。
- `npm run build`：运行 `tsc`，输出 `dist/`，并把 `dist/cli/main.js` 标记为可执行。
- `npm run typecheck`：运行 `tsc --noEmit`。
- `npm run test:unit`：先 build，再运行 `node --test test/unit/**/*.test.mjs`。
- `npm start -- <args>`：通过源码构建后的 CLI 入口运行本地命令。
- `npm run pack:local`：生成本地 npm tarball。

验证要求：

- 修改 TypeScript 源码后，至少运行 `npm run typecheck`。
- 修改 runtime、daemon、CLI 输出、shared types、site adapter 或 capabilities 边界后，运行 `npm run test:unit`。
- 修改浏览器端到端行为、daemon 生命周期、debugger、network、console、auth/cookie、trace、request replay、hook、state 或 page actions 后，至少运行 `npm run test:unit`，并按影响面用临时 `SITEFLOW_HOME` 做 CLI 级验证。
- 修改发布边界时，运行 `npm pack --dry-run` 并确认包内容不包含本地 artifact 或隐私数据。
- 不要为了让测试通过而跳过测试、削弱断言或伪造输出。

## 代码风格与命名约定

- 使用严格 TypeScript、ESM import，本地 import 必须显式写 `.js` 扩展名。
- 使用单引号、两个空格缩进、分号。
- 优先使用 `async` / `await` 处理 daemon/browser 操作。
- CLI 输出应通过 `src/cli/output.ts` 的 JSON envelope helper 统一处理。
- 错误使用 `SiteflowError` / `toSiteflowError`，不要直接抛裸字符串。
- 路径使用 `src/shared/paths.ts`，不要在各层硬编码 profile 目录。
- 公共跨层类型放在 `src/shared/types.ts`；站点 adapter 类型放在 `src/sites/types.ts`。
- 站点 adapter 文件使用小写 ID 命名，例如 `src/sites/<id>.ts`，并通过 `src/sites/registry.ts` 注册。
- 除包入口类文件外，不要引入新的无意义 barrel/index 文件。
- 内部函数只有一个参数时，不要仅为风格统一改成 options object。
- 可选属性直接传 `undefined` 即可，不要用条件 spread 制造对象。

## Site Adapter 规则

- 新增站点能力时，优先实现 `SiteAdapter`，通过 `runSiteCommand` 返回稳定 receipt。
- adapter receipt 必须包含明确的 `site`、`command`、`ok`、`state`，并用 `observations`、`errors`、`next` 表达证据和下一步。
- 读取型 adapter 必须避免副作用。发布、上传、下载、生成等 mutating 行为必须有显式参数或停在人审边界。
- 遇到验证码、Turnstile、Cloudflare、登录页、年龄门槛、风控挑战时，只报告结构化状态，不要绕过。
- 不要在 adapter 中直接 `console.log`、`process.exit` 或写裸 JSON；交给 CLI/runner 统一处理。
- 新 adapter 至少验证：`siteflow sites list --json` 可见、核心命令能返回结构化 receipt、失败路径不会抛非结构化异常。

## 隐私与安全硬约束

- Cookie 值、Authorization、Proxy-Authorization、token、secret、session、真实用户输入、请求体敏感字段不得进入普通输出、日志、trace、receipt、测试 fixture 或示例。
- Cookie/auth/network 相关输出必须保持 redaction。需要暴露真实值时，只能写入用户显式指定的私有文件，并使用安全权限。
- 默认使用 Siteflow dedicated profile：`~/.siteflow/profiles/<profile>/`。测试本地状态写入时使用临时 `SITEFLOW_HOME`。
- `auth export-cookies`、network dump、trace export、campaign receipt、screenshots 和 browser profile 都视为私密 artifact，不得提交。
- 不要实现绕过验证码、DRM、付费墙、平台风控或未授权访问的能力。
- 新增依赖前先确认必要性、许可证兼容性和供应链风险；优先不加依赖。
- `package.json` 的 `files` 当前只发布 `dist`。新增发布内容前必须确认不会包含 cookie、trace、profile、campaign、receipt、downloads 或本地生成物。

## 测试指南

- 测试框架是 Node 内置 `node:test` + `node:assert/strict`，不要引入 Jest/Vitest。
- 优先把测试加到对应组件已有测试文件，不要为小改动创建过多新测试文件。
- 测行为和边界，不测实现细节或默认字符串。
- 改 bug 要加回归测试；改分支逻辑要覆盖关键分支和错误路径。
- runtime 纯状态逻辑优先单测；CLI/daemon/runtime/browser 集成主链需要用本地 fixture 或临时 `SITEFLOW_HOME` 做实际 CLI 验证。
- 不要 mock 掉真正需要验证的浏览器行为。可以对纯 adapter dependency injection 做局部测试，但最终仍要保留 fixture 或 CLI 验证证据。

## 开源准备规则

- 公开文本、测试数据和示例中使用 `example.com`、`example.test`、`YOUR_API_KEY` 等中性占位符。
- 不要引用维护者本机路径、私有账号、私有服务、Notion/Telegram 个人数据或不可复现的本地录制。
- PR 标题使用 Conventional Commit 风格，例如 `chore: remove generated artifacts`。
- PR 描述必须说明问题、变更、边界、验证命令和剩余风险，不要写泛泛的 AI 摘要。
- 开源前必须确认 `npm pack --dry-run` 的 tarball 内容只包含预期发布文件。
