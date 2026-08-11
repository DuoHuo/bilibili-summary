# 技术设计：日志落盘 sink（Phase 2）

## 边界

- 新增 1 个前端文件：`frontend/src/lib/logger.ts`
- 新增 1 个 Rust 命令文件区域：`src-tauri/src/commands.rs` 内新增 `append_text_file` + `resolve_log_dir` 两个命令（不新建文件）
- 修改 5 个既有文件：
  - `frontend/src/core/log/event.ts`（抽出 `createLogger`）
  - `frontend/src/core/log/index.ts`（导出 `createLogger`）
  - `frontend/src/lib/tauri.ts`（加 `appendTextFile` / `resolveLogDir` 包装）
  - `frontend/src/lib/api.ts`（`tauriDeps` 注入 logger）
  - `frontend/src/lib/sessions.ts`（三个 catch 写日志 + `SessionMeta.diagnosticId`）
  - `frontend/src/core/types.ts`（`SessionMeta` 加 `diagnosticId`、`ModeEntry` 加 `diagnosticId`）—— 见下「类型改动」
  - `frontend/src/components/mode-result-tabs.tsx`（失败态显示诊断 ID）
  - `src-tauri/src/lib.rs`（注册新命令）
- `Cargo.toml` 零改动（用 `std::fs`）
- 不涉及 UI 组件结构变更，不涉及 React 状态管理重构

## 模块一：`core/log/event.ts` 重构（R1）

```ts
export interface Logger {
  log(level: LogLevel, event: string, fields: Omit<LogEvent, "ts" | "level" | "event">): void
}

/** 可注入任意 sink 的 Logger 工厂；脱敏在 buildLogEvent 内强制发生，sink 收到的是已脱敏事件 */
export function createLogger(sink: (e: LogEvent) => void, threshold: LogLevel = "INFO"): Logger {
  return {
    log(level, event, fields) {
      if (!shouldLog(level, threshold)) return
      const evt = buildLogEvent(level, event, fields) // 强制脱敏 + 事件名校验
      try {
        sink(evt)
      } catch {
        // sink 异常不得拖垮主流程（日志是辅助通道）
      }
    }
  }
}

/** noop 兼容：保持原签名，退化为 sink=()=>{} 的特例；现有调用方与测试零改动 */
export function createNoopLogger(threshold: LogLevel = "INFO"): Logger {
  return createLogger(() => {}, threshold)
}
```

- 关键：`createLogger` 把 `buildLogEvent` 的返回值传给 sink —— sink 拿到的就是已脱敏、已校验的 `LogEvent`，不存在绕过脱敏的旁路（满足 core-guidelines 第 5 条）
- `createNoopLogger` 保持原签名与行为（构建事件验证形状但不输出），现有 `event.test.ts` 的 `createNoopLogger` 用例无需改动
- `index.ts` 同步导出 `createLogger`

## 模块二：Rust 壳——`append_text_file` + `resolve_log_dir`（R2）

### `resolve_log_dir`

```rust
#[tauri::command]
pub fn resolve_log_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}
```

- `app_log_dir()` 在 macOS 解析为 `~/Library/Logs/com.siriusx.bilibili-summary/`（与 `identifier` 对齐），Windows 为 `%LOCALAPPDATA%\...\logs`，Linux 为 `~/.local/share/...\logs`
- 与 `resolve_output_dir` 对称（后者走 `app_data_dir/output`）

### `append_text_file`（追加 + 滚动）

```rust
#[tauri::command]
pub fn append_text_file(path: String, contents: String, max_bytes: i64, max_files: i64) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    // 追加前检查大小：超阈值则滚动（rename .log → .log.1 → .log.2 …，max_files 之外的最老删除）
    roll_if_needed(path, max_bytes, max_files)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("打开日志文件失败: {e}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("写入日志失败: {e}"))?;
    Ok(())
}

fn roll_if_needed(path: &Path, max_bytes: i64, max_files: i64) -> Result<(), String> {
    if max_bytes <= 0 || max_files <= 0 { return Ok(()) } // 不限制
    let len = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
    if len < max_bytes { return Ok(()) }
    // 从最老的开始删：.log.{max_files-1} 删除，.log.{max_files-2} → .log.{max_files-1}，… .log.1 → .log.2，.log → .log.1
    for i in (1..max_files).rev() {
        let cur = path.with_extension(format!("log.{}", i));
        let nxt = path.with_extension(format!("log.{}", i + 1));
        if cur.exists() {
            if i + 1 >= max_files {
                let _ = std::fs::remove_file(&cur); // 最老档删除
            } else {
                let _ = std::fs::rename(&cur, &nxt);
            }
        }
    }
    // 当前 .log → .log.1
    if path.exists() {
        let first = path.with_extension("log.1");
        let _ = std::fs::rename(path, &first);
    }
    Ok(())
}
```

- 滚动逻辑全部在命令内部完成（前端只管 append，不感知滚动），避免前端跨进程 TOCTOU
- `max_bytes` / `max_files` 由前端传入（默认 1MB × 7），命令做兜底校验（≤0 视为不限制）
- 单测覆盖：未达阈值不滚、达阈值滚动链、max_files 边界删除最老

### `lib.rs` 注册

```rust
.invoke_handler(tauri::generate_handler![
    // ...既有命令...
    commands::append_text_file,
    commands::resolve_log_dir,
])
```

## 模块三：`frontend/src/lib/logger.ts`（R3）

```ts
import { createLogger, type LogEvent, type Logger } from "@/core/log"
import { appendTextFile, resolveLogDir } from "./tauri"

let logDir: string | null = null
let buffer: LogEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
const FLUSH_INTERVAL_MS = 5000
const BUFFER_FLUSH_THRESHOLD = 20

/** 文件 sink：WARN/ERROR 立即刷盘；INFO/DEBUG 进缓冲，定时或满阈值批量 append */
async function fileSink(evt: LogEvent): Promise<void> {
  const line = JSON.stringify(evt) + "\n"
  if (evt.level === "WARN" || evt.level === "ERROR") {
    await flushBuffer() // 先把缓冲刷掉保序
    if (logDir) await appendTextFile(`${logDir}/app.log`, line, 1_000_000, 7).catch(() => {})
    return
  }
  buffer.push(evt)
  if (buffer.length >= BUFFER_FLUSH_THRESHOLD) await flushBuffer()
}

let flushing = false
async function flushBuffer(): Promise<void> {
  if (flushing || buffer.length === 0 || !logDir) return
  flushing = true
  const batch = buffer.splice(0)
  const payload = batch.map((e) => JSON.stringify(e)).join("\n") + "\n"
  await appendTextFile(`${logDir}/app.log`, payload, 1_000_000, 7).catch(() => {})
  flushing = false
}

/** 启动期解析日志目录并启动定时 flush；返回 Logger（解析完成前内部用 noop 兜底） */
export async function createFileLogger(): Promise<Logger> {
  try {
    logDir = await resolveLogDir()
  } catch {
    logDir = null // 解析失败：sink 写入时静默跳过
  }
  if (flushTimer === null) {
    flushTimer = setInterval(() => void flushBuffer(), FLUSH_INTERVAL_MS)
  }
  // 注意：fileSink 是 async，createLogger 期望同步 sink；包装成 fire-and-forget
  return createLogger((evt) => void fileSink(evt), "INFO")
}

/** 应用关闭前调用（可选）：刷掉残余缓冲 */
export async function flushLogs(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
  await flushBuffer()
}
```

- `createLogger` 的 sink 是同步签名 `(e) => void`，文件 sink 是 async —— 用 `void fileSink(evt)` fire-and-forget，sink 内部自己做错误吞咽（`createLogger` 也有 try/catch 兜底）
- INFO 批量：5s 定时 + 20 条阈值，避免每条一次 IPC（解决 advisor 指出的 IPC 频繁问题）
- WARN/ERROR 立即刷：先 flush 缓冲保序，再单独 append 该条
- 所有 `appendTextFile` 调用 `.catch(() => {})`：日志失败绝不拖垮主流程

## 模块四：`lib/api.ts::tauriDeps` 注入（R4）

```ts
// 现状：tauriDeps 是静态对象。改造为：logger 字段启动期异步填充
let loggerRef: Logger = createNoopLogger() // 兜底
void createFileLogger().then((l) => { loggerRef = l })

const tauriDeps: SummarizeDeps = {
  http: tauriHttpFetch,
  runner: tauriRunner,
  // ...既有
  logger: createNoopLogger(), // 初始 noop；下方 runPrepare/runGenerate 用 loggerRef 透传最新值
}
```

- 实际透传策略：`runPrepare`/`runGenerate` 构造 `scopedDeps` 时用 `loggerRef` 当前值（而非闭包捕获静态 deps.logger），这样 logger 解析完成后新调用立即用上文件 sink
- 解析前用 noop 兜底：不阻塞启动，不影响既有测试（测试用 fake deps 不传 logger，走 `createNoopLogger` 默认）

## 模块五：写入点接入（R5）——`sessions.ts` 三个 catch

### `runGenerateMode` catch（最关键，解决"大模型调用失败"无诊断）

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  patchMode(target.run_id, mode, { status: "error", error: message, finishedAt: Date.now() })
  // 新增：结构化日志写入
  const appErr = err instanceof AppError ? err : null
  loggerRef.log("ERROR", "llm.generate_failed", {
    trace_id: appErr?.traceId ?? generateTraceId(),
    run_id: target.run_id,
    mode,
    err: appErr
      ? { code: appErr.code, message: appErr.message, context: appErr.context }
      : { code: "UNKNOWN", message }
  })
  // diagnosticId 落到 mode entry，供 UI 反查
  if (appErr) patchMode(target.run_id, mode, { diagnosticId: appErr.diagnosticId })
}
```

### `start` catch（prepare 阶段失败）

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  patchSession(runId, { status: "error", finishedAt: Date.now(), stage: null, error: message })
  const appErr = err instanceof AppError ? err : null
  loggerRef.log("ERROR", "whisper.prepare_failed", {
    trace_id: appErr?.traceId ?? generateTraceId(),
    run_id: runId,
    err: appErr ? { code: appErr.code, message, context: appErr.context } : { code: "UNKNOWN", message }
  })
  if (appErr) patchSession(runId, { diagnosticId: appErr.diagnosticId })
}
```

### `generate` 重新准备数据源 catch

```ts
// 同构：event = "whisper.reprepare_failed"，附 run_id + mode + err
```

- `loggerRef`：模块级引用，跟随 `api.ts` 的 logger 解析（或从 deps 透传；`useSessionManager` 的 config 闭包不含 logger，故用模块级 ref 最简）
- 事件名 `domain.action_result`：`llm.generate_failed` / `whisper.prepare_failed` / `whisper.reprepare_failed`，均经 `buildLogEvent` 校验
- 非 `AppError`：`code: "UNKNOWN"`，trace_id 现场生成（保证事件必有 trace_id）

## 模块六：类型改动（R6）

### `core/types.ts`

```ts
export interface ModeEntry {
  status: ModeStatus
  error?: string
  finishedAt?: number | null
  diagnosticId?: string  // 新增：失败时附诊断 ID，供 UI 反查日志
}
```

- `SessionMeta.diagnosticId?` 放在哪：`SessionMeta` 已有 `error?: string`（session 级），新增 `diagnosticId?: string` 与之并列
- `isSessionMeta` 守卫同步放宽：`record.diagnosticId === undefined || typeof record.diagnosticId === "string"`

### `mode-result-tabs.tsx` 失败态（约 `:270`）

```tsx
if (entry?.status === "error") {
  return (
    <div className="raised-card p-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-error">{entry.error || "生成失败"}</p>
        {entry.diagnosticId && (
          <p className="text-xs text-muted-soft">诊断 ID：{entry.diagnosticId}</p>
        )}
        <Button variant="secondary" size="sm" onClick={onGenerate}>重试</Button>
      </div>
    </div>
  )
}
```

## 数据流：一次 LLM 调用失败

```
callLlm(baseUrl=空 或 resp.ok=false)
  → throw AppError("LLM.CALL_FAILED", { traceId, context: { status } })
  → runGenerateMode catch 捕获
  → patchMode(runId, mode, { status: "error", error: msg, diagnosticId })  // UI 看到诊断 ID
  → loggerRef.log("ERROR", "llm.generate_failed", { trace_id, run_id, mode, err: { code, message, context } })
  → createLogger sink = fileSink
  → buildLogEvent 强制脱敏（context 里的 status 非敏感，保留；若 context 含 cookie/api_key 则键名脱敏）
  → WARN/ERROR 立即 appendTextFile(app.log, JSONL, 1MB, 7)
  → ~/Library/Logs/com.siriusx.bilibili-summary/app.log 多一行 JSONL
```

## 关键设计取舍

| 决策 | 理由 |
|---|---|
| 自写 JSONL sink，不用 `tauri-plugin-log` | 零新 crate；保持 LogEvent 结构化形状；plugin 会包一层文本行破坏 JSONL |
| 滚动逻辑在 Rust 命令内，不在前端 | 避免跨进程 TOCTOU；前端只管 append，命令做 `roll_if_needed` |
| INFO 批量 + WARN/ERROR 立即刷 | 平衡 IPC 频率与诊断及时性；错误事件必须第一时间落盘 |
| sink 异常静默吞咽 | 日志是辅助通道，写入失败不得影响主业务流程（`createLogger` 内 try/catch + sink 内 `.catch(()=>{})` 双重保险） |
| `loggerRef` 模块级引用 | `useSessionManager` 的 config 闭包不含 logger，模块级 ref 最简；logger 解析后新调用自动用最新值 |
| `diagnosticId` 落到 `ModeEntry` 而非 `SessionMeta` | 失败是 mode 级（一次 session 多模式，可能某模式失败某成功）；session 级 prepare 失败也落 `SessionMeta.diagnosticId` |
| `createNoopLogger` 保持原签名 | 向后兼容：现有 `event.test.ts` 的 noop 用例零改动；退化实现 = `createLogger(()=>{}, threshold)` |

## 兼容性 / 回归风险

- `event.ts` 重构：`createLogger` 抽出，`createNoopLogger` 退化实现，`event.test.ts` 现有断言（noop 不输出、按阈值过滤、事件名校验）全部保持通过
- `tauriDeps` 注入 logger：`SummarizeDeps.logger` 本就是可选字段（Phase 1 已加），现有测试 fake 不传 logger 走 `createNoopLogger` 默认，编译/测试不受影响
- `sessions.ts` catch 新增日志写入：纯追加逻辑，不改变既有 `patchMode`/`patchSession` 行为；`diagnosticId` 为可选字段，`isSessionMeta` 守卫放宽后旧记录（无此字段）照常通过
- `ModeEntry.diagnosticId` 新增可选字段：`session-list.tsx` 不读它，无影响；`mode-result-tabs.tsx` 仅失败态读取
- Rust：`append_text_file` / `resolve_log_dir` 是纯新增命令，不影响既有命令；`Cargo.toml` 零改动（用 `std::fs` + `std::io::Write`，已由 `std` 提供）
- 滚动逻辑单测：`roll_if_needed` 用 tempdir 覆盖未达阈值/达阈值滚动/max_files 边界
