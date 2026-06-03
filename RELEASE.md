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

1. 确认版本号：

```bash
cat package.json
```

2. 如需 bump 版本，修改 `package.json`。

3. 打 tag：

```bash
git tag v0.1.0
```

4. 推送分支和 tag：

```bash
git push origin main
git push origin v0.1.0
```

5. 触发 GitHub Actions：

- `CI` 会跑 typecheck、unit tests、package dry run；
- `Release Check` 会在 tag push 时再次检查打包内容边界。

6. 手动发布到 npm：

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

## 当前版本策略

当前仓库没有自动 release 脚本，也没有自动 npm publish workflow。发布采取：

- GitHub Actions 做校验
- 维护者手动 `npm publish`

这样可以在开源早期先保持发布节奏可控。
