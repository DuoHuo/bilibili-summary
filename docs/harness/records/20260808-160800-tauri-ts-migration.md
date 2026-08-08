# Tauri 2 + TypeScript 单栈 GUI 迁移

- Time: 20260808-160800
- Scope: backend, frontend, src-tauri, ci

## Intent
将前后端分离的 web 应用（React + Rust/Axum）重构为 Tauri 2 桌面 GUI：核心业务逻辑迁移到 TypeScript，Rust 仅保留极薄系统能力壳；支持跨平台 + GitHub Actions CI/CD。

## Constraints
- 功能等价：四模式（summary/fulltext/timestamp/custom）、三视图、设置持久化、字幕/Whisper 转录、产物导出全部保留
- Whisper 保留为兜底，二进制在打包/CD 阶段分发（sidecar）
- 不保留浏览器 web 部署形态，不引入 Node sidecar

## Checks
- `pnpm test`（vitest 78 用例全绿）
- `npx tsc --noEmit` + `pnpm build`（vite）
- `cargo check`（src-tauri）
- `pnpm tauri dev` 冒烟（窗口启动正常）
- 布局用 agent-browser 截图验证（紧凑桌面 GUI：顶栏 + 输入条 + 撑满结果区）

## DoD
- TS 核心层 `frontend/src/core/` 覆盖平台识别/字幕/转录/LLM/渲染/工作流，带 fixture 回归与 golden HTML 对照
- Rust 壳 `src-tauri/` 仅含系统能力 commands，无 Axum 服务
- `backend/` 已删除（A6：Rust 业务逻辑全部移除，git 历史可回滚）
- GitHub Actions：`ci.yml`（三平台检查）+ `release.yml`（三平台打包发布）+ `scripts/fetch-binaries.sh`（sidecar 分发）

## Rollback
- 分阶段 commit 可单独 revert；`backend/` 删除可 `git revert` 恢复
- 核心层纯函数化 + golden fixture 使回归差异可快速定位

## Files
- `frontend/src/core/**`（TS 核心层 + 测试 + fixtures）
- `frontend/src/lib/tauri.ts`（桥接层）、`api.ts`、`config.ts`（替换）
- `frontend/src/App.tsx`、`components/url-form.tsx`、`components/result-panel.tsx`（布局改造）
- `frontend/package.json`、`tsconfig.json`、`vitest.config.ts`
- `src-tauri/**`（Tauri 2 壳 + commands + sidecar 占位）
- `scripts/fetch-binaries.sh`
- `.github/workflows/ci.yml`、`.github/workflows/release.yml`
- `Makefile`、`start.sh`、`README.md`、`ARCHITECTURE.md`（更新为 Tauri 版）
- `.trellis/spec/backend/`（标记废弃）、`.trellis/spec/frontend/core-guidelines.md`（新增）
- 删除：`backend/`、`frontend/src/components/hero.tsx`、`top-nav.tsx`、`footer.tsx`
