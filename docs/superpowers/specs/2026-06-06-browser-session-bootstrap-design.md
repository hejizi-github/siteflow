# 浏览器会话导入基础能力设计

## 目标

为 Siteflow 增加一项基础能力：从用户本机 Chromium 系浏览器的默认 profile 或指定 profile 中迁移会话状态到当前 Siteflow profile，让用户无需 attach 浏览器、无需手工导出 cookie 文件，就能把日常浏览器里的登录态带进 Siteflow。

第一版覆盖 Chromium 系浏览器、cookies 和 localStorage。`sessionStorage`、Safari、Firefox、完整跨浏览器会话克隆都不进入第一版。

## 用户决策

- 第一版浏览器范围：Chromium 系。
  - Chrome
  - Chromium
  - Edge
  - Brave
  - Arc
- 迁移内容：cookies + localStorage。
- 不迁移 sessionStorage。
- 默认命令直接导入，不需要 `--apply`。
- `--domain` 是可选过滤项；不传时默认全量导入。
- 不使用 browser attach。
- 运行中的浏览器优先通过快照读取；失败时提示用户关闭浏览器后重试。
- 命令保持简单，复杂来源选择通过 `auth sources` 和 `--source` 处理。

## 非目标

第一版不做：

- Safari / Firefox 支持。
- 直接复用或修改用户真实浏览器 profile。
- attach 到真实浏览器。
- sessionStorage 迁移。
- 自动关闭用户浏览器。
- 绕过 Keychain、系统权限、浏览器加密保护或网站风控。
- 在普通输出、receipt、trace、测试 fixture 中写出 cookie value 或 localStorage value。
- 试图判断“用户已登录成功”；验证只证明状态已导入并可被当前 Siteflow context 读取。

## CLI 设计

### 查看可用来源

```bash
siteflow auth sources
```

输出本机可用 Chromium profile 摘要：

```json
{
  "sources": [
    {
      "id": "chrome:Default",
      "browser": "chrome",
      "profile": "Default",
      "path": "/Users/example/Library/Application Support/Google/Chrome/Default",
      "default": true,
      "lastUsed": "2026-06-06T10:00:00.000Z"
    }
  ]
}
```

该命令只输出 source 元数据，不输出 cookie/localStorage 值。

### 默认全量导入

```bash
siteflow auth import-browser
```

默认行为：

1. 自动发现 Chromium 系浏览器来源。
2. 自动选择来源：
   - 优先系统默认浏览器；
   - 没有可判定默认浏览器时，优先 Chrome；
   - 再 Edge / Brave / Arc / Chromium。
3. 自动选择 profile：
   - 优先 `Default`；
   - 否则选择最近使用的 profile。
4. 快照读取 cookies 和 localStorage。
5. 导入当前 Siteflow profile。
6. 输出结构化 receipt。

### 按域名过滤

```bash
siteflow auth import-browser --domain x.com
```

只迁移：

- `x.com`、`.x.com` 及其子域 cookie；
- `https://x.com`、`http://x.com` 及其子域 origin 的 localStorage。

### 指定来源

```bash
siteflow auth import-browser --source chrome:Default
siteflow auth import-browser --source arc:Profile-1
```

`--source` 的格式是：

```text
<browser>:<profile>
```

其中 `browser` 是 `chrome | chromium | edge | brave | arc`。

### 可选模式

```bash
siteflow auth import-browser --preview
siteflow auth import-browser --cookies-only
siteflow auth import-browser --no-verify
```

- `--preview`：只读取来源并显示会导入的数量，不写当前 Siteflow profile。
- `--cookies-only`：只迁移 cookies，不读取/导入 localStorage。
- `--no-verify`：导入后不做轻量验证。

## Receipt 设计

### 全量导入

```json
{
  "ok": true,
  "source": "chrome:Default",
  "scope": "all",
  "cookies": {
    "imported": 214,
    "failedDecrypt": 6,
    "domains": 37
  },
  "localStorage": {
    "origins": 12,
    "keys": 80,
    "failedOrigins": 1
  },
  "verification": {
    "mode": "summary-only",
    "cookieCount": 214,
    "storageOrigins": 12
  },
  "warnings": [
    "Imported browser session data may contain sensitive account state."
  ]
}
```

### 域名导入

```json
{
  "ok": true,
  "source": "chrome:Default",
  "scope": "domain",
  "domain": "x.com",
  "cookies": {
    "imported": 18,
    "failedDecrypt": 0,
    "domains": ["x.com", ".x.com"]
  },
  "localStorage": {
    "origins": 1,
    "keys": 12
  },
  "verification": {
    "mode": "domain",
    "url": "https://x.com/",
    "readyState": "complete",
    "cookieCount": 18
  }
}
```

### Preview

```json
{
  "ok": true,
  "preview": true,
  "source": "chrome:Default",
  "scope": "all",
  "cookies": {
    "wouldImport": 214,
    "failedDecrypt": 6,
    "domains": 37
  },
  "localStorage": {
    "wouldImportOrigins": 12,
    "wouldImportKeys": 80,
    "failedOrigins": 1
  }
}
```

## 模块设计

新增模块：

```text
src/runtime/browser-session-import.ts
```

职责：

- 发现 Chromium 系浏览器来源。
- 解析 source id。
- 快照复制浏览器 profile 数据。
- 读取 cookies。
- 解密 cookies。
- 读取 localStorage。
- 聚合 import payload 和 receipt metadata。

新增或扩展 runtime 方法：

```ts
importStorage(records: BrowserStorageRecord[]): Promise<StorageImportResult>
```

新增或扩展 CLI：

```text
siteflow auth sources
siteflow auth import-browser
```

## Source Discovery

### Source 类型

```ts
interface BrowserSessionSource {
  id: string;
  browser: 'chrome' | 'chromium' | 'edge' | 'brave' | 'arc';
  profile: string;
  userDataDir: string;
  profileDir: string;
  default: boolean;
  lastUsed?: string;
}
```

### macOS 路径

第一版扫描：

```text
~/Library/Application Support/Google/Chrome
~/Library/Application Support/Chromium
~/Library/Application Support/Microsoft Edge
~/Library/Application Support/BraveSoftware/Brave-Browser
~/Library/Application Support/Arc/User Data
```

### Profile 发现规则

1. 读取 `Local State`。
2. 从 `profile.info_cache` 提取 profile 列表。
3. 使用 `profile.last_used` 或 `Default` 判断默认/最近 profile。
4. 没有 `Local State` 时 fallback 扫描 `Default` 和 `Profile *` 目录。
5. `auth sources` 输出 profile 路径和摘要，不读取敏感数据。

## Cookie 抽取

Chromium cookie DB 位置：

```text
<profileDir>/Network/Cookies
```

读取流程：

1. 创建 `0700` 临时目录。
2. 复制：
   - `Cookies`
   - `Cookies-wal`
   - `Cookies-shm`
3. 只读打开快照 SQLite。
4. 读取字段：
   - `host_key`
   - `name`
   - `path`
   - `expires_utc`
   - `is_secure`
   - `is_httponly`
   - `samesite`
   - `encrypted_value`
   - `value`
5. 解密 cookie value。
6. 转换为现有 `CookieRecord[]`。
7. 通过现有 `runtime.importCookies(...)` 写入 Siteflow context。

### Cookie 转换规则

- `host_key` → `domain`
- `name` → `name`
- `path` → `path`
- 解密后的值 → `value`
- `is_secure` → `secure`
- `is_httponly` → `httpOnly`
- Chromium `samesite` → `CookieRecord.sameSite`
- Chromium `expires_utc` → Playwright cookie `expires`

解密失败的 cookie 不导入空值，计入 `failedDecrypt`。

## localStorage 抽取

Chromium localStorage 位置：

```text
<profileDir>/Local Storage/leveldb
```

第一版策略：

1. 复制整个 `leveldb` 目录到 `0700` 临时目录。
2. 解析 localStorage 记录。
3. 全量模式读取所有可解析 origin。
4. `--domain` 模式只保留目标域及子域 origin。
5. 生成：

```ts
interface BrowserStorageRecord {
  origin: string;
  localStorage: Record<string, string>;
}
```

导入方式：

1. 对每个 origin 打开页面。
2. 在该 origin 下执行：

```ts
localStorage.setItem(key, value)
```

3. 记录导入 origin 数、key 数和失败原因。

不迁移 sessionStorage。

## 运行中浏览器处理

默认策略：

1. 优先复制 SQLite / LevelDB 快照。
2. 如果复制或读取失败：
   - 返回 `SOURCE_LOCKED` 或具体读取错误；
   - 提示用户关闭浏览器后重试；
   - 不自动关闭用户浏览器。
3. cookies 和 localStorage 可部分成功：
   - 部分 cookie 解密失败允许 partial；
   - 部分 localStorage origin 解析失败允许 partial；
   - source profile 整体不可读则整体失败。

## 验证流程

### 全量导入验证

全量导入不逐站打开验证。只验证当前 Siteflow context 的摘要：

- cookie count
- storage origins count
- receipt 标记 `verification.mode = "summary-only"`

### 域名导入验证

如果指定 `--domain x.com`，默认打开：

```text
https://x.com
```

读取：

- URL
- title
- readyState
- redacted cookie count

不判断业务登录状态，只证明状态已导入并可被当前 context 读取。

### 跳过验证

```bash
siteflow auth import-browser --no-verify
```

## 错误模型

主要错误码：

- `NO_BROWSER_SOURCES`
- `SOURCE_NOT_FOUND`
- `SOURCE_PROFILE_NOT_FOUND`
- `SOURCE_LOCKED`
- `COOKIE_DB_NOT_FOUND`
- `COOKIE_DECRYPT_FAILED`
- `LOCAL_STORAGE_NOT_FOUND`
- `LOCAL_STORAGE_PARSE_FAILED`
- `BROWSER_IMPORT_PARTIAL`
- `STORAGE_IMPORT_FAILED`

## 安全与隐私边界

- 临时快照目录权限为 `0700`。
- 临时快照执行后清理。
- receipt 不输出 cookie value。
- receipt 不输出 localStorage value。
- 测试 fixture 不包含真实 cookie、token、session 或个人数据。
- 全量导入时输出高敏警告。
- `--preview` 不写 Siteflow profile。
- 不绕过 Keychain 或系统权限。
- 不自动关闭用户浏览器。
- 不把导出的真实浏览器数据写入仓库。

## 测试策略

### 单元测试

新增：

```text
test/unit/browser-session-import.test.mjs
```

覆盖：

- Chromium source path mapping。
- `Local State` profile 解析。
- `chrome:Default` source id 解析。
- 默认 source/profile 选择。
- domain matching。
- cookie row → `CookieRecord`。
- Chromium expires 转换。
- sameSite 转换。
- failed decrypt 计数。
- localStorage origin filtering。
- receipt aggregation。

### Fake profile fixture

用临时目录模拟 Chromium profile：

```text
/tmp/fake-chrome/
  Local State
  Default/
    Network/Cookies
    Local Storage/leveldb/
```

写入测试 cookie rows、localStorage records 和多 profile 场景。

### Smoke

新增：

```bash
npm run smoke:auth-import-browser
```

流程：

1. 构建 CLI。
2. 创建 fake Chromium profile。
3. 运行：

```bash
siteflow auth import-browser --source chrome:Default --profile-source-root <fixture> --domain example.test
```

4. 验证 Siteflow active context 中 cookie/localStorage 可见。
5. 不读取真实用户浏览器数据。

`--profile-source-root` 只作为测试/调试参数，文档标注 internal。

## 实现里程碑

下面是实现拆分，不是对用户可见能力的降级。完整批准的能力仍是 Chromium 系 cookies + localStorage 导入；实现时可以先让 cookie 路径独立通过，再接入 localStorage。

### Milestone 1：Chromium cookie import

- `auth sources`
- `auth import-browser`
- Chromium source discovery
- cookie DB snapshot
- cookie decrypt / convert / import
- `--domain`
- `--preview`
- 单测 + fake profile smoke

### Milestone 2：localStorage import

- LevelDB snapshot / parser
- origin filtering
- runtime storage import
- verification by origin
- smoke coverage

### Milestone 3：Polish and browser coverage

- Arc / Brave / Edge path hardening
- default browser detection polish
- better source ranking
- partial import receipt polish
- docs and troubleshooting

## Acceptance Criteria

- `siteflow auth sources` lists Chromium browser profiles without exposing secret values.
- `siteflow auth import-browser` imports cookies from the selected/default Chromium source into the active Siteflow profile.
- Without `--domain`, import defaults to all supported cookies/localStorage.
- With `--domain`, import is restricted to matching cookie domains and localStorage origins.
- `--preview` performs no writes.
- `--cookies-only` skips localStorage extraction/import.
- `--no-verify` skips verification.
- Cookie/localStorage values never appear in ordinary CLI output, receipt, trace, tests, or docs.
- Running browser profile data is read via snapshot copy; lock failures produce structured errors.
- Fake profile unit and smoke tests pass without reading a real user browser.
