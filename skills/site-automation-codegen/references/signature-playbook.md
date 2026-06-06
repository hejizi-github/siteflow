# Signature Playbook

这份文档只讲一件事：站点请求存在加签、nonce、时间戳、动态 token 或页面内派生参数时，怎样判断、怎样落地，不把 adapter 做成一碰就碎的假自动化。

## 先认清目标

你的目标通常不是“彻底破解签名算法”。

在这个仓库里，更常见、更正确的目标是：

- 确认请求是否依赖页面内签名；
- 找到签名发生在哪个阶段；
- 判断能不能复用页面上下文稳定执行；
- 如果不能稳定脱离页面上下文，就把命令设计成 page-bound workflow，而不是伪造纯 HTTP adapter。

## 加签常见信号

### 请求侧信号

- query/body/header 中出现：
  - `sign`
  - `signature`
  - `auth`
  - `token`
  - `nonce`
  - `timestamp` / `ts`
  - `x-s` / `x-t` / `x-sign` / `x-signature`
- 同一路径只要时间或参数变了，请求体就跟着变；
- 请求里有明显摘要值、长十六进制串、base64 串；
- 请求重放很快失败，但页面里原始动作成功。

### 页面运行时信号

- `hook crypto` 看到 `digest` / `sign` / `encrypt` / `getRandomValues` 紧邻目标请求；
- `hook fetch` / `hook xhr` 看到请求发出前伴随 crypto 调用；
- `scripts search 'sign'` / `scripts search 'digest'` / `scripts search 'Hmac'` / `scripts search 'SHA-256'` 命中相关代码；
- `break xhr` 命中时，paused frame 栈里能看到签名/组包函数。

## 排查顺序

### 1. 先抓一条成功请求

```bash
siteflow --json network list --limit 200
siteflow --json network body <id> --part request
siteflow --json network body <id> --part response
siteflow --json request curl <id>
```

先回答：
- 这个请求真的是业务主请求吗？
- request body 哪些字段显然是动态的？
- response 是否足够支持你要的 adapter？

### 2. 直接试一次 replay

如果仓库能力支持：

```bash
siteflow --json request replay <id>
```

或在 adapter 里用：
- `replaySiteRequestWithBody`
- `replaySiteRequestWithUrl`

#### 结果解释

- **立即成功**：说明未必存在强签名，或当前上下文足够复用。
- **偶尔成功，稍后失败**：通常有时间戳、nonce、一次性 token。
- **稳定失败，但页面动作成功**：大概率依赖页面内签名或上下文。

### 3. 开 hook 看签名是不是贴着请求发生

```bash
siteflow --json hook fetch
siteflow --json hook xhr
siteflow --json hook crypto
siteflow --json console list --limit 100
```

重点看：
- `SITEFLOW_HOOK` 的 crypto 记录是否出现在目标请求前后；
- algorithm 是什么；
- stack 是否能暴露出文件、函数名、打包 chunk 线索。

这个仓库当前的 `crypto` hook 能观测到：
- `crypto.subtle.digest`
- `crypto.subtle.sign`
- `crypto.subtle.encrypt`
- `crypto.subtle.decrypt`
- `crypto.getRandomValues`

够用来判断“有没有页面内签名参与”。

### 4. 再用 scripts / breakpoint 缩小范围

```bash
siteflow --json scripts search 'sign'
siteflow --json scripts search 'digest'
siteflow --json scripts search 'operationName'
siteflow --json break xhr '/api/'
siteflow --json paused
siteflow --json eval 'location.href'
```

目的不是还原整个混淆 bundle，而是回答这几个问题：

- 签名是请求前本地生成，还是服务端下发 token？
- 签名输入里有哪些业务字段？
- 是否依赖随机数、时间戳、storage、cookie、页面内隐状态？
- 能否通过保持页面上下文来稳定执行，而不用离线重签？

## 三种落地策略

### 策略 A：根本不需要碰签名

适用：
- DOM 已经够用；
- 或公开 HTTP API 已足够；
- 或页面中已有可见数据，不需要调私有接口。

做法：
- 不走 replay；
- 不暴露签名逻辑；
- 直接做 DOM/公开接口 adapter。

这是最优解。

### 策略 B：保留页面上下文，做 page-bound adapter

适用：
- 请求依赖登录态、页面 runtime、隐式 token 或签名；
- 但页面里真实动作可以稳定成功。

做法：
- adapter 通过 `ensureSitePage` / `clickSiteTarget` / `typeIntoSiteTarget` / `evaluateSiteExpression` 驱动页面；
- 需要读结果时从 DOM 或页面内状态取；
- 把命令设计成“在当前登录浏览器里完成动作”，而不是“离线构造 HTTP 请求”。

这是有加签时最常见、最稳的正确落地。

### 策略 C：基于现有上下文做短链 replay

适用：
- 请求签名不是完全一次性；
- 已捕获请求可以在短时间内复用；
- adapter 目标是分页/增量拉取，而不是长期离线接口调用。

做法：
- 先 capture checkpoint；
- 再在同一会话内 replay；
- 失败时返回 `signing_unstable` / `missing_network_evidence` / `auth_required` 一类状态；
- 不承诺“拿到请求就永久可重放”。

参考心法：像 `twitter.ts` 那样先拿 endpoint 和 request context，再做短链扩展，而不是脱离页面状态重新发明一套客户端。

## 什么时候不要继续硬攻

碰到这些情况就该停：

- 重放强依赖一次性 nonce；
- 签名明显依赖运行时闭包、随机数、页面内密钥材料；
- 离线重签需要复制大量前端混淆逻辑；
- 这样做会让 adapter 比页面直接执行更脆；
- 这样做会逼近风控/反爬/未授权边界。

此时正确做法不是“继续破解”，而是：
- 改成 page-bound workflow；
- 或只做到 checkpoint / evidence collection；
- 或明确返回当前仓库边界下无法稳定脱离页面上下文。

## Receipt 该怎么表达

当你确认签名影响稳定性时，receipt 不要装作成功。

推荐状态：
- `signing_required`
- `signing_unstable`
- `missing_network_evidence`
- `auth_required`
- `blocked_by_challenge`

示例：

```json
{
  "site": "example",
  "command": "api-page",
  "ok": false,
  "state": "signing_unstable",
  "errors": [
    {
      "code": "SIGNING_UNSTABLE",
      "message": "Captured request depends on page-context signing and could not be replayed reliably outside the current runtime path."
    }
  ],
  "next": [
    "Keep the authenticated page open and rerun the page-bound command.",
    "If replay is required, capture fresh network evidence and validate it in the same browser session."
  ]
}
```

## 反模式

- 看到 `sign` 字段就盲目复制到 adapter 常量里；
- replay 一次成功就宣称“接口已打通”；
- 把 bundle 里抠出来的临时签名函数直接复制进 adapter；
- 为了脱离页面重放而引入大量站点专属混淆逻辑；
- 把明显依赖页面 runtime 的请求伪装成稳定 HTTP API；
- 为了重放成功而泄露 cookie、token、storage、完整敏感 body。

## 在这个仓库里可直接用的签名排查原语

- `siteflow --json hook crypto`
- `siteflow --json hook fetch`
- `siteflow --json hook xhr`
- `siteflow --json console list --limit 100`
- `siteflow --json scripts search 'sign'`
- `siteflow --json scripts search 'digest'`
- `siteflow --json break xhr '/api/'`
- `siteflow --json request replay <id>`

这些能力已经够判断“是否存在页面内签名依赖”，通常也够决定 adapter 应该走哪条路。
