# Implement: Multi-session Management with History

## Ordered Checklist

### 阶段 1：Rust 命令扩展（后端能力地基）

1. `src-tauri/src/commands.rs`
   - 新增全局 `CHILDREN: Mutex<HashMap<String, tokio::process::Child>>` 进程注册表
   - `run_external` 的 `RunExternalRequest` 增加 `id: Option<String>` 字段；spawn 后若有 id 则注册；进程结束后移除
   - 进度事件 emit 时 payload 增加 `run_id` 字段（从 req 取，缺省空串）
   - 新增 `kill_external(id)`：查注册表 kill + wait，返回是否成功终止
   - 新增 `resolve_cache_dir(app)`：返回 `{app_data}/cache/audio` 并创建目录
   - 新增 `remove_dir(path)`：递归删除目录（`std::fs::remove_dir_all`），文件不存在视为成功
2. `src-tauri/src/lib.rs` 注册新命令：`kill_external` / `resolve_cache_dir` / `remove_dir`
3. 验证：`cd src-tauri && cargo check`

### 阶段 2：前端桥接 + session 存储层

4. `frontend/src/lib/tauri.ts`
   - `RunExternalRequest` 类型加 `id`；`tauriRunner` 生成/透传 `id`（每任务一个，如 run_id）
   - 新增 `killExternal(id)`、`resolveCacheDir()`、`removeDir(path)` 桥接
5. 新建 `frontend/src/lib/sessions.ts`
   - `SessionMeta` 类型 + `isSessionMeta` guard（沿用现有 runtime guard 模式，见 `lib/types.ts`）
   - `loadSessions()` / `saveSessions(list)`（plugin-store `sessions.json` / key `list`，对齐 `lib/config.ts` 模式）
   - `useSessionManager()` hook：
     - state：`sessions: SessionMeta[]`、`activeRunId`
     - `start(url)`：创建 running session → 调用 `postSummarize` → 成功后回填 title/status=done → 失败 status=error → 取消 status=cancelled
     - `cancel(runId)`：置 cancelled + `killExternal(runId)`（尽力而为）
     - `remove(runId)`：删索引 + `removeDir(outputDir)`
     - `rerun(sessionId)`：用原 url + 当前 config 调 `start`
     - 进度订阅：listen `summary://progress` 按 run_id 路由到对应 session
6. 验证：`cd frontend && pnpm exec tsc --noEmit`

### 阶段 3：core 层音频缓存复用

7. `frontend/src/core/types.ts`：`SummarizeDeps` 增加 `resolveCacheDir?: () => Promise<string>`
8. `frontend/src/core/whisper/download.ts`：`downloadAudioWithYtdlp` 前先查缓存（`{cacheDir}/{key}.wav` 存在则直接返回缓存路径，跳过下载）
9. `frontend/src/core/whisper/index.ts`：`transcribeWithWhisper` 透传缓存逻辑（resourcesDir 参数保留，缓存命中时 wav 路径指向 cache）
10. `frontend/src/core/workflow/index.ts`：把 `resolveCacheDir` 注入 `transcribeWithWhisper`
11. 测试：`frontend/src/core/whisper/download.test.ts` 增加缓存命中/未命中用例
12. 验证：`cd frontend && pnpm exec vitest run`（或项目现有测试命令）

### 阶段 4：UI 层

13. `frontend/src/App.tsx`
    - `view` 扩展为 `"home" | "settings" | "session"`，新增 `activeRunId`
    - 替换 `result/loading/error` 单状态为 `useSessionManager`
    - hero 表单提交 → `start(url)`；运行中/完成自动进入 session 视图
    - 侧边栏新增 `SessionList`（平铺 + 色点 + 标题 + 时间）
14. 新建 `frontend/src/components/session-list.tsx`：SessionItem（running: stage + 取消按钮；done: 再次生成按钮；点击切换 activeRunId）
15. `frontend/src/components/result-panel.tsx`：复用回看逻辑（从磁盘读回 md/html/transcript 后渲染）；运行中显示进度视图
16. 验证：`cd frontend && pnpm exec tsc --noEmit` + `pnpm build`

### 阶段 5：集成验收

17. 手动验收 AC1-AC8（见 prd.md）
18. `cargo check` + `tsc` + 测试全绿
19. 回归：现有单结果流程（hero 表单）行为不退化

## Validation Commands

```bash
cd src-tauri && cargo check
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm test        # 若存在；否则 vitest run
pnpm build                      # 根 workspace build（tsc + vite + cargo）
```

## Risky Files / Rollback Points

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `src-tauri/src/commands.rs` | run_external 签名/emit 变更 | 阶段 1 完成后即 checkpoint |
| `frontend/src/lib/sessions.ts` | 新存储层，契约错误影响面大 | 阶段 2 完成后 checkpoint |
| `frontend/src/App.tsx` | 大面积重构（单结果→多 session） | 阶段 4 前保留旧分支可对比 |
| `frontend/src/core/workflow/index.ts` | 缓存注入影响核心流程 | 阶段 3 单测覆盖后再进 UI |

## Follow-up Checks before task.py start

- [x] prd.md 已过收敛 pass（无重复事实、无未决问题）
- [x] design.md / implement.md 已评审（主人确认）
- [ ] 新命令与旧命令共存，`cargo check` 通过
- [ ] session 存储与 config 存储互不干扰
