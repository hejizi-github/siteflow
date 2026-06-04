# Siteflow 发布说明

本项目当前以 npm CLI 包形式发布，包名为 `siteflow-cli`，命令为 `siteflow`。

## 发布前检查

先确认工作区干净，并且当前分支通过以下检查：

```bash
npm install
npm run build
npm run test:unit
npm pack --dry-run
```

必须确认：

- `npm run build` 通过；
- `npm run test:unit` 全部通过；
- `npm pack --dry-run` 只包含预期文件；
- 不包含 cookie、trace、receipt、browser profile、截图、campaign 输出等私有 artifact。

## 推荐发布流程

### 方式 A：自动发布（推荐）

1. 修改 `package.json` 版本号。
2. 提交并推送到 `main`。
3. 打 tag：

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

4. GitHub Actions 会自动执行：

- `CI`：在 `main` 和 PR 上跑 typecheck、unit tests、package dry run；
- `Release Check`：在 tag push 时再次校验打包边界；
- `Publish to npm`：在 tag push 时校验版本与 tag 一致，随后使用 npm Trusted Publishing 自动发布，并创建 GitHub Release。

自动发布依赖：

- GitHub 仓库开启 Actions；
- npm 包 `siteflow-cli` 已在 npm 侧配置 Trusted Publishing；
- GitHub 仓库存在名为 `npm-publish` 的 environment（可选但推荐），用于保护发布审批。

### 方式 B：手动发布

如果还没配好 npm Trusted Publishing，可以手动执行：

```bash
npm publish
```

## 发布边界

发布包当前应只包含：

- `dist/`
- `README.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `docs/`
- `examples/receipts/`
- `assets/readme/`
- `package.json`

任何包含以下内容的文件都不能进入发布包：

- cookie
- session
- token
- trace
- receipt
- browser profile
- HAR
- campaign 输出
- 本机私有路径数据

## Trusted Publishing 配置要点

在 npm 包设置中把 GitHub 仓库加为 Trusted Publisher，并允许：

- repository: `hejizi-github/siteflow`
- workflow: `.github/workflows/publish.yml`
- environment: `npm-publish`（如果启用 environment 保护）

## 当前版本策略

当前仓库采用：

- `main` 分支持续集成；
- `v*` tag 触发正式发布；
- npm 自动发布 + GitHub Release 自动创建；
- 手动 `npm publish` 只作为应急回退路径。
