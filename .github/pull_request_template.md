## 问题

<!-- 说明这个 PR 解决什么问题。关联 issue，或解释为什么需要这个变更。 -->

## 变更

<!-- 说明改了哪些模块、命令或 adapter。不要只贴 diff 摘要。 -->

## 架构边界

<!-- 如果涉及 site adapter，请说明是否仍通过 src/sites/capabilities.ts。若涉及 runtime/daemon/CLI 输出，请说明边界变化。 -->

## 隐私与安全

- [ ] 不包含 cookie、token、Authorization header、browser profile、trace、receipt、network dump、真实账号截图或私有数据。
- [ ] 如涉及 auth/cookie/network/trace，输出已脱敏或写入用户显式指定的私有文件。
- [ ] 没有实现 CAPTCHA、DRM、付费墙、风控或未授权访问绕过。

## 验证

<!-- 勾选并粘贴实际运行过的命令。 -->

- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm pack --dry-run`
- [ ] 其他：

## 风险和限制

<!-- 说明已知限制、站点挑战页、登录态要求、未覆盖分支或后续事项。 -->
