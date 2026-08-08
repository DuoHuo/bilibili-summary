# State Management

> How state is managed in this project.

---

## Overview

本项目无全局 store 库（无 Redux/Zustand/Jotai），状态管理遵循两条主线：

1. **配置状态**：`App.tsx` 持 `UserConfig`，Tauri plugin-store（`user-config.json`）持久化，启动时加载。
2. **会话状态**：`useSessionManager`（`frontend/src/lib/sessions.ts`）管理并发任务 + 历史记录，plugin-store（`sessions.json`）持久化，启动时加载。

---

## State Categories

| 类别 | 位置 | 持久化 | 生命周期 |
|------|------|--------|----------|
| 配置（API key / 模型 / 模式） | `App.tsx` + `useState` | `user-config.json`（plugin-store） | 应用级 |
| Session 列表（含运行中任务） | `useSessionManager` | `sessions.json`（plugin-store） | 应用级 |
| 当前视图 / active session | `App.tsx` + `useState` | 无（会话内） | 窗口级 |
| 表单输入（url） | `App.tsx` + `useState` | 无 | 窗口级 |

---

## When to Use Global State

- **跨组件共享且需持久化** → `useSessionManager`（列表读写 + 状态落盘都封装在 hook 内）
- **仅 App 内部使用** → 保持 `useState` 在 `App.tsx`，不做全局提升

规则：优先局部 state；只有"多组件要读同一份数据 + 需要持久化"时才提升到 `useSessionManager` 或 config。

---

## Server State

无服务端状态。全部数据（配置、session 索引、产物文件）都在本机：

- session **索引**（元数据）存 plugin-store JSON
- session **产物**（md/html/transcript/wav）落盘到 `{app_data}/output/{run_id}/`，回看时按 `outputDir` 从磁盘读取（`readSessionOutput`）

---

## 并发任务状态

`useSessionManager` 是核心模式，要点：

- `sessions: SessionMeta[]` 同时容纳 running/done/error/cancelled，天然支持并发
- 每次 `start()` 预生成 `run_id`（UUID v4），既是产物目录名也是取消/进度路由键
- 进度更新双通道：
  - core 层 `onProgress` 回调 → `postSummarize` 第三参 → 直接路由 stage
  - 外部子进程逐行输出 → `summary://progress` 事件（payload 带 `run_id`）→ `listen` 过滤路由
- 状态落盘：`useEffect` 监听 `sessions` 变化写 store（快照，不阻塞 UI）
- 取消竞态：`cancel()` 先标记 `cancelled`，`runSummarize` 抛错后 catch 内检查 `status !== "cancelled"` 才覆盖为 error

---

## Common Mistakes

- **并发下全局进度事件不带 run_id** → 无法区分事件属于哪个任务。Rust `run_external` 的 emit payload 必须带 `run_id`，前端 `listen` 必须按 `run_id` 过滤（见 `tauriRunner`）。
- **取消后 catch 覆盖状态** → 进程被 kill 后 `postSummarize` 必然抛错，若 catch 无条件标 error 会覆盖 cancelled。必须保留 cancelled。
- **session 索引存完整结果** → 索引只存元数据，产物按需从磁盘读，避免 store JSON 膨胀。
- **两个 store 文件混用** → `user-config.json` 管配置，`sessions.json` 管会话，职责分离。
