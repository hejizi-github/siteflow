# Site Adapter 开发指南

Site adapter 是 Siteflow 的上层能力：它把某个站点上可重复执行的操作封装成稳定 CLI 命令。

## 设计目标

一个好的 adapter 应该：

- 返回结构化 receipt，而不是散落的文本输出；
- 明确区分成功、登录要求、挑战页、空结果和真实错误；
- 只通过 `src/sites/capabilities.ts` 使用浏览器能力；
- 默认 read-only；mutating flow 必须显式，并停在人审边界；
- 不泄漏 cookie、token、真实用户数据或原始私密 trace。

## 文件结构

```text
src/sites/<id>.ts          adapter 实现
src/sites/registry.ts      注册 adapter
src/sites/types.ts         SiteAdapter / SiteReceipt 类型
src/sites/capabilities.ts  adapter 使用 browser/daemon 能力的唯一门面
```

## 最小骨架

```ts
import type { Command } from 'commander';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';
import { runSiteCommand } from './runner.js';
import { ensureSitePage, readSiteSnapshot } from './capabilities.js';

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  const page = await ensureSitePage(ctx.profile, 'https://example.com', 'example.com');
  const snapshot = await readSiteSnapshot(ctx.profile);
  return {
    site: 'example',
    command: 'status',
    ok: true,
    state: 'observed',
    page: { url: page.url, title: page.title },
    observations: {
      textExcerpt: snapshot.text.slice(0, 1000),
    },
  };
}

export const exampleAdapter: SiteAdapter = {
  id: 'example',
  title: 'Example',
  description: 'Example site adapter.',
  commands: [
    {
      name: 'status',
      description: 'Observe the current Example page state.',
      configure(command: Command): void {
        command.action(async function () {
          await runSiteCommand(this, runStatus);
        });
      },
    },
  ],
};
```

然后在 `src/sites/registry.ts` 注册。

## Receipt 状态建议

常见 `state`：

- `observed`：页面成功观察。
- `collected` / `*_collected`：数据成功采集。
- `auth_required`：需要登录。
- `blocked_by_challenge`：遇到 Cloudflare、Turnstile、验证码等挑战。
- `age_gate_present`：遇到年龄门槛。
- `empty_result`：请求成功但没有数据。
- `invalid_response`：站点返回非预期响应。

错误应放在 `errors`，用户下一步放在 `next`。

## Capabilities

优先使用这些门面能力：

- `ensureSitePage`
- `openSitePage`
- `navigateSitePage`
- `clickSiteTarget`
- `typeIntoSiteTarget`
- `uploadSiteFiles`
- `readSiteSnapshot`
- `captureSiteScreenshot`
- `readRecentSiteErrors`
- `detectSiteCaptcha`
- `evaluateInSitePage`
- `listSiteNetwork`
- `readSiteNetworkBody`
- `replaySiteRequestWithBody`
- `replaySiteRequestWithUrl`

不要从 adapter 直接 import daemon client 或 helpers。

## 登录和挑战页

adapter 不应该绕过安全挑战。

正确行为：

```json
{
  "ok": false,
  "state": "blocked_by_challenge",
  "errors": [
    {
      "code": "CHALLENGE_DETECTED",
      "message": "Cloudflare or CAPTCHA challenge is present."
    }
  ],
  "next": ["Complete the challenge manually, then rerun the command."]
}
```

## 测试

新增 adapter 后至少验证：

```bash
npm run typecheck
npm run test:unit
siteflow --json sites list
```

如果 adapter 有纯逻辑解析，给解析函数加单元测试。如果 adapter 是浏览器流程，优先设计可注入依赖的 proof test，不要把真实 cookie 或账号数据写进 fixture。
