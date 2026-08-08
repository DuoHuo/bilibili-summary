# Design: B 站扫码登录（passport API）+ Cookie 联动

## 架构与边界

```
┌─ UI 层 ──────────────────────────────────────────────┐
│ settings-panel.tsx：「登录」Section（新增，置顶）     │
│   ├─ 未登录：说明 + Button「登录 B 站账号」           │
│   └─ 已登录：头像 + @昵称 + UID + 「退出登录」        │
│ login-dialog.tsx：二维码 + 轮询状态 + 取消/重试       │
└──────────────┬───────────────────────────────────────┘
               │ onSuccess(profile, cookie)
┌─ App.tsx（状态编排，multi-session 版结构上叠加）─────┐
│ loginOpen state · handleLoginSuccess · handleLogout   │
│ patchConfig({ biliProfile, cookie }) 持久化           │
│ 启动懒校验 cookie 有效性（fetchNavInfo）              │
└──────────────┬───────────────────────────────────────┘
               │
┌─ 适配层 lib/biliAuth.ts（注入 tauriHttpFetch）───────┐
│ generateQrcode / pollQrcode / fetchNavInfo / logoutBili│
└──────────────┬───────────────────────────────────────┘
               │
┌─ 纯函数层 core/auth/bilibili.ts（可单测）────────────┐
│ parseLoginUrl / buildCookieString / extractBiliJct    │
└───────────────────────────────────────────────────────┘
```

- 遵循现有分层：core 纯函数 + lib 系统适配（Tauri http 插件）+ UI 薄壳
- 与 multi-session 改动正交：只新增模块 + settings-panel Section + App.tsx 三个 handler/effect，不触碰 sessions/workflow 逻辑

## 数据流

### 登录（LoginDialog 内部轮询）
1. 打开 Dialog → `generateQrcode(http)`：`GET passport.../qrcode/generate` → `{ qrcodeKey, content }`
2. `qrcode` 库 `toDataURL(content)` 渲染二维码
3. 每 2s `pollQrcode(http, qrcodeKey)` → `data.code`：
   - `0`：`parseLoginUrl(data.url)` → `buildCookieString()` → `fetchNavInfo()` 校验 → `onSuccess(profile, cookie)`
   - `86101`（未扫）/ `86090`（已扫未确认）：更新提示文案，继续轮询
   - `86038`（失效）：自动重新 `generateQrcode`
4. 关闭 Dialog 清理 interval

### 启动校验（R7）
App configReady 后若 `cookie` 非空：懒调 `fetchNavInfo`：
- `isLogin=true` → 若 `biliProfile` 缺失则补全
- `isLogin=false` → `patchConfig({ biliProfile: null, cookie: "" })` + toast「B 站登录已过期，请重新登录」

### 退出登录（R6）
1. `logoutBili(http, cookie)`：`POST passport.../login/exit/v2`，body `biliCSRF=<bili_jct>`，content-type `application/x-www-form-urlencoded`
2. 无论接口成败，本地必清（接口仅使服务端会话失效）

## 契约

```ts
// lib/biliAuth.ts
export interface QrcodePayload { qrcodeKey: string; content: string }
export interface PollResult { code: number; message: string; loginUrl: string | null }
export interface BiliProfile { uid: number; name: string; face: string }  // 由 lib/types 导出
export async function generateQrcode(http: HttpFetch): Promise<QrcodePayload>
export async function pollQrcode(http: HttpFetch, qrcodeKey: string): Promise<PollResult>
export async function fetchNavInfo(http: HttpFetch, cookie: string): Promise<{ isLogin: boolean; profile: BiliProfile | null }>
export async function logoutBili(http: HttpFetch, cookie: string): Promise<void>  // 尽力而为

// core/auth/bilibili.ts（纯函数）
export function parseLoginUrl(url: string): Record<string, string>   // 白名单提取 SESSDATA/bili_jct/DedeUserID/DedeUserID__ckMd5/sid
export function buildCookieString(cookies: Record<string, string>): string
export function extractBiliJct(cookie: string): string | null
```

## 持久化（决策：扩展 UserConfig）

```ts
// lib/types.ts
export interface BiliProfile { uid: number; name: string; face: string }
// UserConfig 新增：
biliProfile: BiliProfile | null
```

- `isUserConfig` guard：`biliProfile` 允许缺失（undefined/null 合法，兼容旧配置，先例 promptMode）
- `DEFAULT_CONFIG`（App.tsx）加 `biliProfile: null`
- 理由：cookie 已在 UserConfig；单 store key；明文与 apiKey 同先例

## 交互形态（决策：Dialog 弹窗）

复用 `components/ui/dialog.tsx`（CustomPromptDialog 先例）。设置页保持简洁。

## 兼容性

- `isUserConfig` 向后兼容（biliProfile 可选）
- Cookie 格式 `k=v; k2=v2` 命中现有「含 = 与 ; 时按请求头发送」逻辑
- 手动 Cookie 配置保留（登录只是自动填充）
- 不触碰 multi-session 的 sessions/workflow/whisper 改动

## 权衡与风险

| 项 | 说明 |
|---|---|
| B 站接口变更 | 集中封装在 `lib/biliAuth.ts`；官方 passport 接口，成熟项目在用 |
| SESSDATA 约 1 个月过期 | 启动懒校验自动清登录态并提示 |
| 新依赖 `qrcode` | 纯 JS，WebView 可用（已确认在 package.json） |
| 二维码安全 | 登录 URL 过期即失效（86038），本地生成不落盘 |
| 轮询频率 | 2s/次 |

## 回滚

- 纯新增模块 + settings-panel Section + App.tsx handler；不动现有流程
- 回滚 = 删新模块 + 还原 settings-panel 标题（biliProfile 字段冗余无害）
