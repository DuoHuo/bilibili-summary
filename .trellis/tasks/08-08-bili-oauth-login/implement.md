# Implement: B 站扫码登录（passport API）+ Cookie 联动（恢复）

## 背景

登录功能曾实现后被另一会话清除；capabilities/Cargo.toml 网络层修复仍在。按已批准规划重新实现。

## 有序检查清单

1. **依赖**：确认 `qrcode` + `@types/qrcode` 在 `frontend/package.json`（已存在则跳过）
2. **纯函数层**：新建 `frontend/src/core/auth/bilibili.ts` + `bilibili.test.ts`
   - `parseLoginUrl` / `buildCookieString` / `extractBiliJct`（8 个单测）
3. **类型**：`frontend/src/lib/types.ts` 加 `BiliProfile` + `UserConfig.biliProfile` + guard 可选放行
4. **网络适配**：新建 `frontend/src/lib/biliAuth.ts`
   - `generateQrcode` / `pollQrcode` / `fetchNavInfo` / `logoutBili`（复用 `BILI_HEADERS`、`extractBiliJct`）
5. **UI 组件**：新建 `frontend/src/components/login-dialog.tsx`
   - 二维码 + 2s 轮询 + 状态文案（未扫/已扫确认/失效刷新/错误重试）
   - props：`open / onOpenChange / http / onSuccess(profile, cookie)`
6. **设置页**：`frontend/src/components/settings-panel.tsx`
   - 新增「登录」Section（置顶）；「鉴权」→「AI」
   - props 扩展：`profile / onLogin / onLogout`
7. **状态编排**：`frontend/src/App.tsx`（multi-session 版基础上叠加）
   - `loginOpen` state + `<LoginDialog>` 挂载
   - `handleLoginSuccess` / `handleLogout` / 启动懒校验 effect
   - `DEFAULT_CONFIG` 加 `biliProfile: null`
8. **验证**：`pnpm test` + `pnpm check` + `vite build`
9. **手工 QA**：`pnpm dev` → 扫码登录 → 头像/昵称/UID → 重启保持 → 退出 → 会员字幕

## 验证命令

```bash
pnpm --filter ./frontend test
pnpm --filter ./frontend check
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `lib/types.ts`（isUserConfig） | guard 改动影响配置加载 | 字段可选 → 向后兼容 |
| `App.tsx` | 在 multi-session 版叠加 | 删 handler/effect，不动 sessions 逻辑 |
| `settings-panel.tsx` | 标题改名 + 新 Section | 还原标题 / 删 Section |
| 新文件（core/auth、lib/biliAuth、login-dialog） | 纯新增 | 直接删除 |

## start 前检查

- [x] prd.md 重建（内容与已批准规划一致）
- [x] design.md / implement.md 重建
- [ ] 用户已确认恢复（选 A）
