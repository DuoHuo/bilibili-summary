# Session 日志 Tab：实时运行情况

## Goal

在 session 页结果区添加第五个 Tab「日志」，实时展示**本轮 session** 的完整运行情况（进度阶段 + 成功 + 失败诊断），让用户无需翻日志文件即可掌握任务实时状态。

## Background

- `08-10-log-file-sink` 已建立结构化日志落盘（JSONL `app.log`），但只在**失败**时写 ERROR，且 UI 只能通过诊断 ID 反查文件。
- 进度信息走 `onProgress` → Tauri event `summary://progress`，**不进日志通道**——日志文件里 happy path 是空的。
- `core/workflow/index.ts` 只用 `onProgress?.("stage")`，**完全不调 logger**；所有日志记录在 `lib/sessions.ts` catch 层（4 处 ERROR，均带 `run_id`）。
- logger.ts 是模块级单例 + 仅文件 sink，**无内存订阅机制**，UI 无法实时拿数据。

## Requirements

### R1：logger.ts 增加内存 sink + 订阅
- 新增 `getBufferedLogs()` / `subscribeLogs(cb)` 导出，内存 ring buffer（cap 2000）
- composite sink：内存 push（同步，即时 UI）→ 通知订阅者（各自 try/catch 隔离）→ 文件 sink（异步 fire-and-forget）
- `createFileLogger` threshold 降为 DEBUG；`fileSinkAsync` 入口加 `shouldLog(evt.level, "INFO")` 过滤——UI 看全量 DEBUG，`app.log` 行为/体量不变
- 每个订阅者独立 try/catch（createLogger 的 sink 级 try/catch 会因一个抛错饿死其余）

### R2：sessions.ts 进度接入日志通道
- 4 个 `onProgress` 回调处，在现有 `setSessions` 旁补 `loggerRef.log("INFO", "session.stage_changed", { trace_id, run_id, stage })`
- 补成功事件（否则 happy path 日志 Tab 空）：
  - `session.prepare_succeeded`（start/reprepare 成功转 ready 后）
  - `llm.generate_succeeded`（runGenerateMode patchMode done 后）
- 这些 INFO 事件**会写入 app.log**（可接受且有用——日志文件也变完整）

### R3：mode-result-tabs.tsx 加日志 Tab
- Tab 类型拓宽为 `TabValue = PromptMode | "log"`；`TAB_ORDER` 末尾追加 `"log"`
- 日志 Tab 独立 `TabsContent`，**不走 ModeBody**（其 preparing/error 早返回会吞掉日志视图——正是最需要看日志的时候）
- `TabsList` 渲染 log trigger 时无 spinner/状态点（session.modes["log"] 不存在）
- `activeMode` state 改为 `TabValue`；`readModeOutput` effect 加 `activeMode !== "log"` 守卫

### R4：SessionLogPanel 组件（新建 `components/session-log-panel.tsx`）
- 启动从 `getBufferedLogs().filter(e => e.run_id === runId)` 播种，`subscribeLogs` 增量订阅（useEffect + cleanup）
- 等宽行：`ts`(HH:mm:ss) · level 徽章 · `event` · 折叠 `err.code`/`message`；点击展开完整 `err.context` JSON
- 新事件自动滚到底；用户上滚时暂停（`scrollHeight - scrollTop - clientHeight > threshold` 判定）
- 渲染行数 cap 500
- 底部：「复制全部」(JSONL) + 「打开日志文件」(`openPath(logDir)`，复用 `handleOpenOutput` 的动态 import 模式)
- 空状态："本轮暂无日志"（历史 session ring buffer 为空时，提示去日志文件查看）

### R5：测试
- `lib/logger.test.ts` 扩展：
  - subscribeLogs 在 `loggerRef.log` 后同步收到事件
  - unsubscribe 停止投递
  - 抛错的订阅者不影响第二个订阅者收到
  - ring cap 超过 RING_CAP 丢最老
  - DEBUG 事件到达订阅者但**不触发** appendMock（文件 sink 过滤）

## Acceptance Criteria

- [x] AC1：Session 页出现第五个 Tab「日志」，位于「自定义」之后
- [x] AC2：日志 Tab 在 preparing / error / ready 任意状态下均可打开并显示内容（手动验证：error 状态下显示 WHISPER.EMPTY_RESULT 事件）
- [x] AC3：运行中新日志实时追加并自动滚动；用户上滚后暂停自动滚动（手动验证：dev 运行中日志 Tab 实时显示 stage 流转）
- [x] AC4：仅显示当前 run_id 的事件；ERROR 事件显示 err.code 与可展开 context
- [x] AC5：DEBUG 级事件 UI 可见但不写入 app.log（logger.test.ts 覆盖）
- [x] AC6：提供「复制全部」与「打开日志文件」入口
- [x] AC7：`core/` 目录零改动；`tsc --noEmit` + `vitest` 180 测试全绿

## Known Limitations (v1)

- ring buffer 是内存态：从侧边栏打开**历史** session，日志 Tab 为空（SessionMeta 持久化但 ring buffer 不持久）。空状态文案提示"历史任务日志请打开日志文件查看"并提供按钮。不建文件回放路径，等用户明确需要再加。

## Out of Scope

- 历史 session 日志回放（读 app.log 按 run_id 过滤）
- 日志过滤/搜索 UI（v1 全量展示）
- core 层加 INFO 日志（保持 core 纯，进度日志在 lib/sessions.ts 层记）
