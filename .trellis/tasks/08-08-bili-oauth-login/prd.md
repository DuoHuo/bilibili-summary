# B 站扫码登录（passport API）+ Cookie 联动

## Goal

在 bilibili summary 的**设置页**中新增「登录」区块，通过 **B 站官方 passport 扫码登录 API** 让用户用 B 站账号登录桌面应用：展示登录状态（头像 / 昵称 / UID），并**自动填充 Cookie** 解锁会员视频字幕抓取。

设置页结构：**「登录」区块（新增）+ 「AI」区块（现有模型配置，由「鉴权」改名）**。现有「字幕抓取」区块保留（手动 Cookie 配置作为兜底）。

## User Value

- 一次扫码同时解决两件事：B 站身份登录 + 会员字幕 Cookie（替代手动复制 Cookie 的痛点）
- 用户操作最少（手机扫码即可），不依赖任何第三方服务
- 设置页分区清晰：「登录」管账号，「AI」管模型

## Confirmed Facts（代码证据）

### 项目架构（当前 working tree 状态，含 multi-session 改动）
- Tauri 2 桌面应用，单栈 TypeScript：`frontend/src/core/` 纯逻辑 + `frontend/src/lib/` Tauri 系统能力适配（`ARCHITECTURE.md`）
- 设置页：`frontend/src/components/settings-panel.tsx`，现有两个 `Section`：「鉴权」（API Key / Base URL / 模型）与「字幕抓取」（Cookie / Whisper 语言 / 截图标注）
- 导航：`view: "home" | "settings" | "session"`（`App.tsx`，multi-session 已加 session 视图）
- 配置持久化：Tauri plugin-store，`user-config.json` / key `active`；`UserConfig` 字段 apiKey/model/baseUrl/prompt/promptMode/cookie/sttLanguage/screenshot；`isUserConfig` guard + `DEFAULT_CONFIG` 合并
- 明文存储先例：apiKey（无加密）
- Cookie 抓取链路已就绪：`fetchBilibiliSubtitles`（`core/subtitle/bilibili.ts`）已透传 `Cookie` 头

### B 站官方扫码登录 API（2025-08-08 实测可用）
- 参考实现：`luyuduan/get_bilibili_cookie`（get_cookie.py）+ BilibiliPotPlayer 同款方案
- 接口流程（纯 REST，无内嵌浏览器）：
  1. `GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header` → `{qrcode_key, url}`
  2. 前端生成二维码（`qrcode` npm 包），用户手机 B 站 App 扫码
  3. 轮询 `GET .../qrcode/poll?qrcode_key=<key>&source=main-fe-header` → `data.code`：`0`=成功（`data.url` 含 SESSDATA 等）/ `86038`=失效 / `86101`=未扫 / `86090`=已扫未确认
  4. 登录态检测：`GET https://api.bilibili.com/x/web-interface/nav` → `data.isLogin` + `uname/face/mid`
  5. 退出登录：`POST https://passport.bilibili.com/login/exit/v2`（bili_jct 作 CSRF）
- 实测响应结构：外层 `code:0` = 请求成功，poll 状态在 `data.code`；`data.url` 未成功时为空串

### 已完成的 Tauri 网络层修复（保留在 working tree）
- `src-tauri/capabilities/default.json`：`http:default` 已配置 scope（`*.bilibili.com` / `*.hdslb.com` / `*.youtube.com` / `video.google.com`）—— 否则所有 plugin-http 请求被拒（上次「获取二维码失败」根因）
- `src-tauri/Cargo.toml`：`tauri-plugin-http` 已启用 `unsafe-headers` —— 否则 `Cookie`/`Referer` 头被静默丢弃

### 已评估并放弃的方案
- **bili-auth（icyux/bili-auth）**：token 拿不到 Cookie、依赖第三方实例、私信确认操作多，放弃

## Requirements

- [ ] R1：设置页新增「登录」区块（B 站账号登录入口）
- [ ] R2：设置页现有「鉴权」区块更名为「AI」
- [ ] R3：扫码登录流程：点击登录 → 展示二维码 → 轮询 poll 直到成功 / 失效自动刷新 / 取消
- [ ] R4：登录成功后展示 B 站用户信息（头像 / 昵称 / UID）
- [ ] R5：登录成功后自动将 SESSDATA 写入 `UserConfig.cookie`，解锁会员字幕
- [ ] R6：支持退出登录：调 passport exit 接口（尽力而为）+ 清除本地登录态
- [ ] R7：登录状态重启后保持；cookie 失效时（nav isLogin=false）自动清登录态并提示

## Acceptance Criteria

- [ ] AC1：设置页可见「登录」与「AI」两个区块
- [ ] AC2：点击「登录」弹出二维码，扫码确认后自动完成登录并显示头像/昵称/UID
- [ ] AC3：登录成功后「字幕抓取」区块 Cookie 字段被自动填充
- [ ] AC4：重启应用后登录状态保持
- [ ] AC5：退出登录后回到未登录态，Cookie 字段被清除
- [ ] AC6：未登录时摘要/字幕抓取逻辑无回归（multi-session 功能不受影响）

## Out of Scope

- 不接入 bili-auth / 任何第三方 OAuth 服务
- 不自部署服务端
- 不实现会员视频下载（仅解锁字幕抓取）
- 不联动摘要流程身份标注（登录态仅用于字幕 Cookie + 身份展示）

## 设计决策（详见 design.md）

- **存储**：扩展 `UserConfig` 新增 `biliProfile`（可选字段，兼容旧配置；cookie 复用现有字段）
- **交互**：LoginDialog 弹窗引导（复用现有 dialog 组件）
- **模块**：core/auth 纯函数（可单测）+ lib/biliAuth 网络适配（注入 tauriHttpFetch）+ UI 薄壳
