# Implement — GUI 重构：macOS 磨砂玻璃分层布局

## Checklist

1. [x] 规划：prd.md / design.md / implement.md
2. [ ] `index.css`：token 值翻转为深色玻璃系；新增 `.glass` / `.glass-strong` / `.ambient-bg` 工具类；`.prosemic` 深色微调（code/pre/表格底色走 token，检查硬编码）
3. [ ] `App.tsx`：重写为 sidebar + main shell；view 状态（home/settings）；hero / 结果态切换；ambient 背景层；drag strip；Toaster 保留
4. [ ] `url-form.tsx`：`variant: "hero" | "compact"` 双形态
5. [ ] `result-panel.tsx`：Frame → 玻璃卡片；空态/加载态适配
6. [ ] `settings-panel.tsx`：Dialog 壳移除 → `SettingsView` 独立视图
7. [ ] `tauri.conf.json`：width 1180 / minWidth 900
8. [ ] 验证：`pnpm --filter ./frontend check` 中 tsc 部分 + `pnpm test`；cargo check 视环境
9. [ ] 视觉 QA：vite dev + agent-browser 截图（首页 / 结果态用 fixture？/ 设置视图）
10. [ ] spec 更新：frontend spec 增补 design-tokens 指南（深色玻璃系约定）
11. [ ] 收尾：任务 archive（不 commit，遵循用户级规则）

## Validation Commands

- `pnpm --filter ./frontend exec tsc --noEmit`
- `pnpm test`
- `pnpm --filter ./frontend exec vite`（端口 5173）+ agent-browser 截图

## Review Gates / Rollback

- 每个组件改完先 tsc；视觉 QA 不达标回退对应文件。
- 全部改动未提交，`git diff` 可随时审查与恢复。
