# 开源一致性检查清单

本文件用于维护开源仓库的一致性，确保 README、工作流、包发布边界和治理文件同步。

## 当前已对齐项

- 包名：`siteflow-cli`
- CLI 命令：`siteflow`
- README 安装方式：`npm install -g siteflow-cli`
- GitHub CI：`build + test:unit + pack --dry-run`
- Release Check：tag push 时再次校验包边界
- 发布文件：`dist`、README、LICENSE、SECURITY、CONTRIBUTING、docs、examples/receipts、assets/readme
- 安全边界：禁止把 cookie、trace、receipt、profile、campaign、HAR 放进发布包或仓库

## 当前仍保留的已知限制

- `xueqiu discussions`：当前收敛为 `PAGE_CONTEXT_FETCH_FAILED`
- `xueqiu status/comments`：真实目标会被滑动验证阻断
- `youtube transcript`：对当前测试视频返回 `TRANSCRIPT_UNAVAILABLE`
- `twitter/x home/search`：依赖有效登录态 profile
- `suno` / `jimeng`：真实提交后只能确认到 `submitted_unconfirmed`，不能稳定确认完成

## 发布前人工检查

1. `npm run build`
2. `npm run test:unit`
3. `npm pack --dry-run`
4. 检查 `README.md` 中的命令示例是否仍存在于 CLI
5. 检查 `.github/workflows/*.yml` 与 `package.json` scripts 是否一致
6. 检查 `SECURITY.md` / `CONTRIBUTING.md` / `RELEASE.md` 是否仍符合当前发布策略
