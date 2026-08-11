# 日志落盘 sink（Phase 2）

## Goal

接通 `08-10-structured-error-logging`（Phase 0+1）铺好但未接线的诊断日志地基：把 `createNoopLogger` 的占位实现换成真正写文件的 JSONL sink，并在 prepare/generate/llm/whisper 的失败路径接入 `deps.logger.log(...)` 写入点，让 `AppError.context`（`stdoutTail`/`stderrTail`/HTTP `status`/`exitCode`）真正落盘（经 `buildLogEvent` 强制脱敏）。

解决用户实际痛点：生成失败时 UI 只剩一句 `err.message`（如「大模型调用失败」），`AppError.context` 被整体丢弃，无任何可查的诊断日志。

## User Value

- 生成失败时，`~/Library/Logs/com.siriusx.bilibili-summary/app.log`（JSONL）保留完整诊断事件：错误码 + trace_id + diagnostic_id + 脱敏后的 stdoutTail/stderrTail/HTTP status
- 失败 UI 显示诊断 ID，可凭 ID 在日志文件反查完整事件
- 开发者排障不再需要用户手动复制终端输出或重启复现

## Confirmed Facts（代码证据）

### Phase 0+1 已完成（前一 task，已 commit d891290，验收门全绿）
- `frontend/src/core/errors/`：`AppError` + `codes.ts` + `trace.ts`（`generateTraceId` / `deriveDiagnosticId`）+ `tailLines`
- `frontend/src/core/log/`：`levels.ts`（4 级过滤）/ `redact.ts`（双通路脱敏）/ `event.ts`（`buildLogEvent` 强制脱敏出口 + `Logger` 接口 + `createNoopLogger`）
- 四处报错点已 throw `AppError`：`whisper/download.ts`（4）、`whisper/index.ts`（3）、`llm/client.ts`（3）
- `SummarizeDeps.logger?: Logger` 已加（`core/types.ts:133`）

### 当前缺口（本 task 要修）
- **写入点零接入**：全代码库无任何 `deps.logger.log(...)` 调用（仅 `event.test.ts` 测试调用）。`AppError` 被构造后，`context` 在 `sessions.ts` catch 里整体丢弃——只取 `err.message` 存进 `modes[mode].error`
- **Logger 是 noop**：`createNoopLogger` 注释明写「Phase 2 才接落盘 sink」，`log()` 跑脱敏验证但不输出
- **UI 无诊断 ID**：`mode-result-tabs.tsx:270` 失败态显示 `entry.error || "生成失败"`，`SessionMeta` 无 `diagnosticId` 字段

### 落盘相关现状
- `src-tauri/src/commands.rs::write_text_file`：`std::fs::write`（覆盖写），不适合日志追加
- `resolve_output_dir`：走 `app_data_dir/output/{run_id}`；日志应走 `app_log_dir`（平台标准日志目录）
- `frontend/src/lib/tauri.ts`：桥接层用 `invoke` 包装命令，新增命令需在此加包装函数
- `frontend/src/lib/api.ts::tauriDeps`：注入 `SummarizeDeps` 的唯一出口，logger 在此注入

### 选型决策（advisor 推荐，本 task 采纳）
- **自写 JSONL 文件 sink，不引入 `tauri-plugin-log`**
  - 自写 sink 只需 `std::fs::OpenOptions::append`，零新 crate，完全绕开 Cargo 依赖
  - `tauri-plugin-log` 会把 `LogEvent` JSON 包进它自己的文本行格式，破坏 Phase 1 的结构化事件形状
  - `tauri-plugin-log` 唯一额外价值是捕获 Rust panic + webview console，本 task 不需要（Rust 侧零业务日志，panic 走系统崩溃报告即可）

## Requirements

### R1：`core/log/event.ts` 重构——抽出可注入 sink 的 `createLogger`
- 抽出 `createLogger(sink: (e: LogEvent) => void, threshold: LogLevel): Logger`
- `createNoopLogger(threshold)` 退化为 `createLogger(() => {}, threshold)` 的特例（保持向后兼容，现有测试不破坏）
- `log()` 内：`shouldLog` 过滤 → `buildLogEvent` 构造（脱敏在此发生）→ `sink(event)` 输出
- 序列化的是 `buildLogEvent` 的**返回值**（已脱敏），不是 raw fields

### R2：Rust 壳——`append_text_file` + `resolve_log_dir` 命令
- `append_text_file(path, contents, max_bytes, max_files)`：追加写 + 文件滚动（大小达 `max_bytes` 时重命名为 `.1`、`.2`… 最多 `max_files` 份，最老的删除）；滚动逻辑在命令内部完成避免 TOCTOU
- `resolve_log_dir()`：返回 `app_log_dir()`（macOS `~/Library/Logs/com.siriusx.bilibili-summary/`），确保目录存在
- 在 `lib.rs` 的 `invoke_handler!` 注册两个新命令
- **不新增 Cargo 依赖**（用 `std::fs::OpenOptions` + 既有的 `std::fs`）

### R3：`frontend/src/lib/logger.ts`——文件 sink 包装
- `createFileLogger(): Promise<Logger>`：启动时 `resolveLogDir()` 拿到日志目录，构造 `createLogger(sink, "INFO")`
- sink：INFO/DEBUG 批量缓冲（定时或满 N 条 flush），WARN/ERROR 立即 `appendTextFile` 刷盘，避免每条一次 IPC
- 异常容错：sink 写入失败静默（日志不能反过来拖垮主流程）

### R4：`lib/api.ts::tauriDeps` 注入 logger
- `tauriDeps` 增加 `logger` 字段（启动期 `createFileLogger()` 异步解析，解析前用 `createNoopLogger()` 兜底）
- `runPrepare` / `runGenerate` 透传 deps.logger 给 `prepareTranscript` / `generateMode`

### R5：接入写入点——`sessions.ts` 三个 catch + `workflow/index.ts` 关键路径
- `runGenerateMode` catch：从捕获的 `AppError` 取 `{ code, message, context }`，`logger.log("ERROR", "llm.generate_failed", { trace_id: err.traceId, run_id, err: { code, message, context } })`
- `start` catch（prepare 失败）：`logger.log("ERROR", "whisper.prepare_failed", { trace_id, run_id, err })`
- `generate` 的重新准备数据源 catch：同构
- 非 `AppError` 的裸 Error：记录 `err: { code: "UNKNOWN", message }`
- 事件名遵循 `domain.action_result`（`buildLogEvent` 强制校验）

### R6：`SessionMeta` + 失败 UI 显示诊断 ID
- `SessionMeta` 新增可选 `diagnosticId?: string`
- `sessions.ts` catch 里 `patchSession(runId, { diagnosticId: err.diagnosticId })`（仅 `AppError` 有此字段）
- `mode-result-tabs.tsx` 失败态：`entry.error` 旁附诊断 ID（`entry.diagnosticId`，`ModeEntry` 同步加字段），供用户口述反查日志

### R7：测试
- `event.ts`：`createLogger(sink)` 的 sink 被调用且收到已脱敏事件；`createNoopLogger` 仍向后兼容
- `logger.ts`：sink 失败不抛错（容错）
- `sessions.ts` 的写入点接线靠既有 workflow 测试覆盖行为，不单独 mock logger（logger 可选，测试 fake 不传仍过）

## Acceptance Criteria

- [x] AC1：`createLogger(sink, threshold)` 可注入任意 sink；`createNoopLogger` 保持向后兼容，现有 `event.test.ts` 全绿
- [x] AC2：`append_text_file` 追加写 + 大小达阈值滚动（.1/.2/…/max_files，最老删除）；`resolve_log_dir` 返回平台日志目录且自动创建；Rust 单测覆盖滚动逻辑
- [x] AC3：`createFileLogger()` 返回的 Logger，WARN/ERROR 立即刷盘，INFO 批量；sink 异常不影响主流程
- [x] AC4：`tauriDeps` 注入 logger，`runPrepare`/`runGenerate` 透传；未解析完成前用 noop 兜底，不阻塞主流程
- [x] AC5：`sessions.ts` 三个 catch 写入结构化日志事件（含 trace_id/run_id/err.code/err.context）；非 AppError 走 `code: "UNKNOWN"`
- [x] AC6：端到端真实落盘已验证——`tauri dev` 触发失败后 `app.log` 出现 JSONL 行，含真实 `err.code: WHISPER.YTDLP_DOWNLOAD_FAILED` + 脱敏后 `stderrTail`（`ffprobe and ffmpeg not found`）；UI 失败态显示诊断 ID（`EFGHJKMN`）。诊断系统据此定位出 yt-dlp 后处理缺 ffmpeg/ffprobe 的真因（由后续 task 修复）
- [x] AC7：`pnpm --filter ./frontend check` + `pnpm --filter ./frontend test` + `cd src-tauri && cargo test` 全绿
- [x] AC8：不新增 Cargo 依赖；`Cargo.toml` 无变化（git diff 确认未改）

## Out of Scope

- 一键导出日志包 UI / 上报授权流程（后续任务）
- 按模块热调 DEBUG 级别 + TTL 自动过期（后续任务）
- Rust 侧 panic 捕获（走系统崩溃报告，不引入 panic-hook）
- `tauri-plugin-log` 选型（本 task 明确不用，见选型决策）
- `run_external` 长时下载 stdout/stderr 无界内存累积（既有设计问题，不修）
