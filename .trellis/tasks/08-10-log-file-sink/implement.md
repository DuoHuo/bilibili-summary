# 执行计划：日志落盘 sink（Phase 2）

参考 `design.md` 的模块划分。按顺序执行，每步都能独立跑通类型检查 + 相关单测。

## Step 1：`core/log/event.ts` 重构——抽出 `createLogger`（R1）

- `event.ts`：新增 `createLogger(sink: (e: LogEvent) => void, threshold: LogLevel = "INFO"): Logger`
  - `log()` 内：`shouldLog` 过滤 → `buildLogEvent` 构造（脱敏在此发生）→ `try { sink(evt) } catch {}`（sink 异常吞咽）
- `createNoopLogger` 退化为 `return createLogger(() => {}, threshold)`（保持原签名，行为不变）
- `core/log/index.ts`：新增 `export { createLogger }`
- 更新 `event.test.ts`：新增 `createLogger` 用例——注入 spy sink，断言 sink 收到 `buildLogEvent` 返回值（含 `ts/level/event/trace_id`），且 `api_key`/cookie 字段已脱敏；现有 `createNoopLogger` 用例保持不变

**验证**：`pnpm --filter ./frontend test core/log` — 现有用例 + 新增 createLogger 用例全绿

## Step 2：Rust 壳——`append_text_file` + `resolve_log_dir`（R2）

- `src-tauri/src/commands.rs`：
  - 新增 `resolve_log_dir(app: AppHandle) -> Result<String, String>`：`app.path().app_log_dir()` + `create_dir_all`
  - 新增 `append_text_file(path, contents, max_bytes, max_files) -> Result<(), String>`：`roll_if_needed` 后 `OpenOptions::append`
  - 新增私有 `roll_if_needed(path, max_bytes, max_files)`：达阈值时从最老档开始 rename 链，超 `max_files` 删除
  - 注意 `append_text_file` 需 `use std::io::Write`（`file.write_all`）
- `src-tauri/src/lib.rs`：`invoke_handler!` 注册 `commands::append_text_file`、`commands::resolve_log_dir`
- 单测（`commands.rs` 内 `#[cfg(test)] mod log_rotation_tests`）：
  - `roll_if_needed` 未达阈值不滚（写小内容后文件名不变）
  - 达阈值滚动：`.log` → `.log.1`，旧 `.log.1` → `.log.2`
  - `max_files` 边界：超出的最老档被删除
  - 用 `std::env::temp_dir()` 构造临时路径，测后清理

**验证**：`cd src-tauri && cargo test log_rotation` + `cargo check` — 新增单测通过，编译无新依赖

## Step 3：`frontend/src/lib/tauri.ts` + `logger.ts`（R3）

- `tauri.ts`：新增包装
  - `appendTextFile(path, contents, maxBytes, maxFiles): Promise<void>` → `invoke("append_text_file", { path, contents, maxBytes, maxFiles })`
  - `resolveLogDir(): Promise<string>` → `invoke("resolve_log_dir")`
- 新建 `frontend/src/lib/logger.ts`（见 design 模块三）：
  - 模块级 `logDir` / `buffer` / `flushTimer` / `flushing`
  - `fileSink(evt)`：WARN/ERROR 立即 `flushBuffer` + append；INFO/DEBUG 进 buffer，满阈值或定时 flush
  - `createFileLogger(): Promise<Logger>`：解析 logDir + 启动定时 flush + 返回 `createLogger((evt) => void fileSink(evt), "INFO")`
  - `flushLogs()`：清 timer + flushBuffer（可选，供关闭前调用）
- 单测 `logger.test.ts`：
  - sink 失败不抛错（mock appendTextFile reject，logger.log 不抛）
  - WARN/ERROR 路径触发立即 append（mock spy）
  - INFO 批量：满 BUFFER_FLUSH_THRESHOLD 才 flush（用 fake timer 或直接调 flushBuffer）

**验证**：`pnpm --filter ./frontend test logger` + `pnpm --filter ./frontend check` — 类型检查 + 新单测全绿

## Step 4：`lib/api.ts` 注入 logger（R4）

- `api.ts`：
  - `import { createFileLogger } from "./logger"` + `import { createNoopLogger } from "@/core/log"`（或 `createLogger`）
  - 模块级 `let loggerRef: Logger = createNoopLogger()`；`void createFileLogger().then((l) => { loggerRef = l })`
  - `tauriDeps` 不直接放 logger（静态对象捕获不到更新）；改为 `runPrepare`/`runGenerate` 内构造调用参数时用 `loggerRef` 透传——但 `runPrepare`/`runGenerate` 调 `prepareTranscript`/`generateMode` 时传的 deps 是 `tauriDeps`，需让 deps.logger 动态。
  - 方案：`tauriDeps` 用 getter 形式或每次构造 `scopedDeps` 时覆盖 `logger: loggerRef`。最简：把 `tauriDeps` 改为函数 `getTauriDeps()` 或在 `runPrepare`/`runGenerate` 里 `{ ...tauriDeps, logger: loggerRef }` 传给 core。选后者（改动最小，不动 tauriDeps 结构）。

**验证**：`pnpm --filter ./frontend check` — 类型检查全绿；既有 workflow 测试不传 logger 不受影响

## Step 5：`sessions.ts` 写入点接入（R5）+ 类型改动（R6）

- `core/types.ts`：
  - `ModeEntry` 新增 `diagnosticId?: string`
  - `SessionMeta` 新增 `diagnosticId?: string`
  - `isSessionMeta` 守卫放宽：`(record.diagnosticId === undefined || typeof record.diagnosticId === "string")`
- `lib/sessions.ts`：
  - `import { AppError, generateTraceId } from "@/core/errors"`
  - `import { loggerRef }` 或从某处拿到 logger——`sessions.ts` 不直接 import `api.ts`（会循环？）。检查：`api.ts` import `sessions`? 否，`sessions.ts` import `api`（`runPrepare`/`runGenerate`）。若 `sessions.ts` import `logger.ts`（不 import api）则无循环。**loggerRef 放 `logger.ts` 导出，`sessions.ts` 直接 import `loggerRef` from `./logger`**。调整 design：`logger.ts` 导出 `loggerRef`（模块级，createFileLogger 解析后更新），`sessions.ts` 与 `api.ts` 都 import 它。
  - `runGenerateMode` catch：加 `loggerRef.log("ERROR", "llm.generate_failed", { trace_id: appErr?.traceId ?? generateTraceId(), run_id, mode, err })` + `if (appErr) patchMode(..., { diagnosticId })`
  - `start` catch：加 `loggerRef.log("ERROR", "whisper.prepare_failed", {...})` + `patchSession(..., { diagnosticId })`
  - `generate` 重新准备 catch：加 `loggerRef.log("ERROR", "whisper.reprepare_failed", {...})`
- `components/mode-result-tabs.tsx`：失败态加诊断 ID 显示（`entry.diagnosticId`）

**验证**：`pnpm --filter ./frontend check` + `pnpm --filter ./frontend test` — 全量类型检查 + 全量测试（既有 164 测试不应回归；sessions 测试若 mock logger 则不受影响，因为 loggerRef 初始 noop）

## Step 6：全量回归 + 手动验证

- `pnpm --filter ./frontend check`（tsc + cargo check）
- `pnpm --filter ./frontend test`（前端全量）
- `cd src-tauri && cargo test`（Rust 全量，含新增 log_rotation）
- 手动验证（`tauri dev`）：
  - 触发一次 LLM 失败（配错 baseUrl）：失败 UI 显示诊断 ID；`~/Library/Logs/com.siriusx.bilibili-summary/app.log` 出现一条 JSONL，含 `err.code`/`err.context.status`/`trace_id`
  - 触发一次 yt-dlp 失败（无效链接）：日志含 `err.context.stderrTail`（脱敏后）
  - INFO 批量：正常生成流程的进度 INFO 事件 5s 后批量落盘
- 人工确认改动文件列表不含 `Cargo.toml`（AC8）

## 回滚点

- Step 1（event.ts 重构）独立，若 `event.test.ts` 回归可单独回滚（恢复 createNoopLogger 原实现）
- Step 2（Rust 命令）独立，若 cargo test 失败可单独回滚（删两个命令 + lib.rs 注册行）
- Step 3（logger.ts）依赖 Step 1（createLogger）+ Step 2（tauri 包装）；出问题可回滚 logger.ts，core 层不受影响
- Step 4-5（注入 + 写入点）依赖 Step 3；出问题可回滚到 noop（loggerRef 保持 noop，主流程不受影响，只是无日志落盘）
- Step 6 是集成验证，无新代码，只跑门
