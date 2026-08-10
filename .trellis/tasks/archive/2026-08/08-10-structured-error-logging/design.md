# 技术设计：结构化错误与诊断日志基础设施（Phase 0 + Phase 1）

## 边界

- 新增两个纯逻辑模块：`frontend/src/core/errors/`、`frontend/src/core/log/`
- 修改三个既有文件：`frontend/src/core/whisper/download.ts`（四处报错点）、`frontend/src/core/llm/client.ts`（三处报错点）、`frontend/src/core/whisper/index.ts`（三处报错点）
- `SummarizeDeps` 仅新增一个**可选**字段 `logger?:`，`ExternalRunner` / Rust 侧（`commands.rs`）**零改动**
- 不涉及 UI 层、不涉及持久化、不涉及 Rust

## 模块一：`core/errors/`

```
core/errors/
  codes.ts     错误码注册表：code → 人话文案模板
  trace.ts     trace_id 生成 + diagnostic_id 派生
  app-error.ts AppError 类 + tailLines 纯函数
  index.ts     re-export
```

### `trace.ts`

```ts
export function generateTraceId(): string {
  return crypto.randomUUID()
}

/** base32（Crockford，剔除易混字符 0/O/1/I/L）前 8 位，供用户口述/复制 */
export function deriveDiagnosticId(traceId: string): string {
  // 对 traceId 做简单 hash → 映射到 Crockford base32 字母表，取前 8 位
}
```

- Crockford base32 字母表：`0123456789ABCDEFGHJKMNPQRSTVWXYZ`（已天然剔除 `I/L/O/U`，本任务额外确认不含易混淆字符即可，不必重新发明字母表）
- 派生函数是纯函数：同一 `traceId` 永远得到同一个 `diagnostic_id`，天然支持"用户报诊断 ID → 反查 trace_id → 反查日志"（反查本身不在本任务范围，只需保证派生关系确定即可）

### `app-error.ts`

```ts
export interface AppErrorContext {
  exitCode?: number
  stdoutTail?: string
  stderrTail?: string
  [key: string]: unknown
}

export class AppError extends Error {
  readonly code: string
  readonly traceId: string
  readonly diagnosticId: string
  readonly context?: AppErrorContext

  constructor(code: string, opts: { traceId: string; context?: AppErrorContext; cause?: unknown }) {
    const humanMessage = ERROR_MESSAGES[code] ?? code
    super(`${humanMessage}（错误码 ${code}，诊断 ID ${deriveDiagnosticId(opts.traceId)}）`)
    this.name = "AppError"
    this.code = code
    this.traceId = opts.traceId
    this.diagnosticId = deriveDiagnosticId(opts.traceId)
    this.context = opts.context
    if (opts.cause) this.cause = opts.cause
  }
}

/** 取文本末 N 行；空/undefined 输入返回 undefined（不生成空字符串噪音） */
export function tailLines(text: string | undefined, maxLines: number): string | undefined {
  if (!text) return undefined
  const lines = text.split("\n")
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join("\n")
}
```

- `AppError.message`（`Error.message`，用户会看到的那句话）= 人话文案 + 错误码 + 诊断 ID，满足 PRD AC1
- `context.stdoutTail` / `context.stderrTail` 是**未脱敏**的原始尾部；脱敏发生在写入日志事件时（`core/log/` 的职责），不在 `AppError` 构造时做——`AppError` 是错误值对象，日志事件是它的一个消费者，两者职责分离，符合 SOLID-S

### `codes.ts`

```ts
export const ERROR_MESSAGES: Record<string, string> = {
  "WHISPER.YTDLP_DOWNLOAD_FAILED": "下载音频失败，请检查网络或视频链接是否有效",
  "WHISPER.WAV_NOT_FOUND": "音频转换未生成预期文件，请重试",
  "WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED": "下载视频失败，请检查网络或视频链接是否有效",
  "WHISPER.MP4_NOT_FOUND": "视频下载未生成预期文件，请重试",
  // Phase 0b：大模型调用（core/llm/client.ts）
  "LLM.CALL_FAILED": "大模型调用失败，请检查 API Key/Base URL/网络",
  "LLM.INVALID_ENDPOINT": "自定义端点配置无效，请检查 Base URL",
  "LLM.PARSE_RESPONSE_FAILED": "解析大模型响应失败，请稍后重试",
  // Phase 0b：语音转写（core/whisper/index.ts，与 yt-dlp 下载同属 whisper 领域但错误码段不同，不与下载阶段混淆）
  "WHISPER.TRANSCRIBE_FAILED": "语音转写失败，请检查音频文件或模型配置",
  "WHISPER.PARSE_RESULT_FAILED": "解析语音转写结果失败，请重试",
  "WHISPER.EMPTY_RESULT": "语音转写结果为空，请确认音频内容有效",
}
```

- 错误码命名 `DOMAIN.REASON`，与 `core/log/` 的 `domain.action_result` 事件命名风格保持一致但作用不同（错误码是稳定标识符，事件名是日志分类），不合并两者，避免"一个字符串挑两个职责"

## 模块二：`core/log/`

```
core/log/
  levels.ts    LogLevel 类型 + 过滤纯函数
  redact.ts    双通路脱敏中间件
  event.ts     buildLogEvent（组包 + 强制脱敏出口）+ Logger 接口 + createNoopLogger
  index.ts     re-export
```

### `levels.ts`

```ts
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** level 是否应在 threshold 下输出（threshold 及以上级别放行） */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold)
}
```

### `redact.ts`

两条通路，函数级隔离，互不依赖：

```ts
const SENSITIVE_KEYS = new Set(["api_key", "apiKey", "cookie", "base_url", "baseUrl"])
const REDACTED = "[REDACTED]"

/** 通路一：结构化字段，递归遍历，键名命中即整体替换 */
export function redactSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        SENSITIVE_KEYS.has(k) ? [k, REDACTED] : [k, redactSensitiveKeys(v)]
      )
    )
  }
  return value
}

/** 通路二：自由文本值匹配（URL 查询串 token/key/sign/sessdata/bili_jct 参数值 + SESSDATA=... 片段） */
const FREE_TEXT_PATTERNS: RegExp[] = [
  /([?&](?:token|key|sign|sessdata|bili_jct)=)[^&\s]+/gi,
  /\bSESSDATA=[^;\s]+/gi,
]

export function redactFreeText(text: string): string {
  return FREE_TEXT_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, (_match, prefix) => (prefix ? `${prefix}${REDACTED}` : REDACTED)),
    text
  )
}
```

- `redactSensitiveKeys` 处理事件里已知的结构化字段（如 `context` 对象本身）
- `redactFreeText` 额外应用在**所有字符串类字段**上（包括已经过 `redactSensitiveKeys` 之后剩下的字符串值、以及 `stdoutTail`/`stderrTail`），双通路串联而非二选一
- 单测覆盖：命中（各 4 种键名 + 两类自由文本模式）与未命中（正常字段如 `code`/`event`/`exitCode` 不受影响）

### `event.ts`

```ts
export interface LogEvent {
  ts: string        // ISO 8601
  level: LogLevel
  event: string      // domain.action_result
  trace_id: string
  err?: { code: string; message: string; context?: unknown }
  [key: string]: unknown  // 允许附加字段，如 run_id
}

export interface Logger {
  log(level: LogLevel, event: string, fields: Omit<LogEvent, "ts" | "level" | "event">): void
}

/** 事件名必须匹配 domain.action_result（小写字母/数字/下划线，两段以上，点分隔） */
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

export function buildLogEvent(
  level: LogLevel,
  event: string,
  fields: Omit<LogEvent, "ts" | "level" | "event">
): LogEvent {
  if (!EVENT_NAME_PATTERN.test(event)) {
    throw new Error(`日志事件名不合规范（需 domain.action_result 形式）: ${event}`)
  }
  const raw: LogEvent = { ts: new Date().toISOString(), level, event, ...fields }
  const structurallyRedacted = redactSensitiveKeys(raw) as LogEvent
  return deepRedactStrings(structurallyRedacted, redactFreeText) // 对所有字符串字段再跑一遍自由文本正则
}

/** 默认 noop 实现：level 过滤 + 直接构造但不输出（Phase 2 才接落盘 sink） */
export function createNoopLogger(threshold: LogLevel = "INFO"): Logger {
  return {
    log(level, event, fields) {
      if (!shouldLog(level, threshold)) return
      buildLogEvent(level, event, fields) // 强制走脱敏路径，即使当前是 noop，也验证事件形状合规
    },
  }
}
```

- `buildLogEvent` 是唯一的事件构造出口，脱敏在这里**强制**应用，调用方拿不到"跳过脱敏"的旁路 —— 满足 PRD "别靠自觉，用中间件自动拦截"
- `createNoopLogger` 目前不做任何 I/O（Phase 2 才接文件 sink），但仍然跑通级别过滤 + 事件校验 + 脱敏，这样 Phase 2 接入真实 sink 时行为不会因为"之前从没跑过这条路径"而意外暴露脱敏漏洞

## `SummarizeDeps` 改动（Phase 1）

```ts
// core/types.ts
export interface SummarizeDeps {
  http: HttpFetch
  runner: ExternalRunner
  // ...既有字段
  logger?: Logger   // 新增，可选
}
```

- 唯一改动：新增一行可选字段。不改变任何既有字段的类型或可选性
- 现有测试 fake（如 `whisper/download.test.ts::makeDeps`）不传 `logger` 字段，`Partial<SummarizeDeps>` / 手写对象结构不受影响，编译期不会报错（可选字段缺省即 `undefined`）
- `runSummarize`（`workflow/index.ts`）内部：若 `deps.logger` 未提供，用 `createNoopLogger()` 兜底，调用点不需要判空

## 数据流：一次失败的 yt-dlp 下载

```
downloadAudioWithYtdlp(deps, url, cookie, outputDir)
  1. const traceId = generateTraceId()
  2. const result = await deps.runner("yt-dlp", [...], {...})   // 既有调用，签名不变
  3. if (result.exitCode !== 0) {
       throw new AppError("WHISPER.YTDLP_DOWNLOAD_FAILED", {
         traceId,
         context: {
           exitCode: result.exitCode,
           stdoutTail: tailLines(result.stdout, 200),
           stderrTail: tailLines(result.stderr, 200),
         },
       })
     }
  4. 调用方（workflow/index.ts 或更上层 UI 错误边界）捕获 AppError：
     - 展示 error.message（人话 + 错误码 + 诊断 ID）给用户
     - 若有 deps.logger：logger.log("ERROR", "whisper.download_failed", { trace_id: traceId, err: { code, message, context } })
       —— 脱敏在 buildLogEvent 内强制执行，stdoutTail/stderrTail 里的 token/sessdata 在此被替换
```

- 本任务**不**要求 `downloadAudioWithYtdlp` 自己调用 `deps.logger`——PRD 的 Phase 0 只要求 `AppError` 携带正确信息；日志事件的实际写入点（谁在何处调 `logger.log`）留给调用方或后续任务决定，避免在 Phase 0/1 就把"日志写入时机"这个更大的架构问题一并解决。design 只需保证 `AppError` → `LogEvent` 的转换路径存在且脱敏正确，AC2/AC5 的单测直接覆盖这条转换，不依赖真的接入 workflow

## Phase 0b 数据流：非子进程调用失败（LLM / Whisper CLI 解析）

与 yt-dlp 下载不同，这 6 处失败不涉及 `ExternalRunResult.stdout/stderr`（`callLlm` 是 HTTP 调用，`transcribeWithWhisperCli` 的失败分支是 exitCode 非零或本地文件解析失败），因此不需要 `tailLines`，只需生成 `traceId` 并 throw `AppError`：

```ts
// core/llm/client.ts::callLlm
export async function callLlm(...): Promise<string> {
  const traceId = generateTraceId()
  const { endpoint, defaultModel } = resolveEndpoint(baseUrl)  // 已有的 "自定义端点不能为空" 分支 → AppError("LLM.INVALID_ENDPOINT", { traceId })
  // ...
  if (!resp.ok) throw new AppError("LLM.CALL_FAILED", { traceId, context: { status: resp.status } })
  // ...
  try { data = JSON.parse(text) } catch { throw new AppError("LLM.PARSE_RESPONSE_FAILED", { traceId }) }
}

// core/whisper/index.ts::transcribeWithWhisperCli / transcribeWithWhisper
if (result.exitCode !== 0) throw new AppError("WHISPER.TRANSCRIBE_FAILED", { traceId, context: { exitCode: result.exitCode } })
// JSON.parse 失败 → AppError("WHISPER.PARSE_RESULT_FAILED", { traceId })
// segments.length === 0 → AppError("WHISPER.EMPTY_RESULT", { traceId })
```

- `resolveEndpoint` 是同步纯函数，被 `callLlm` 与 `llmProbe.ts` 共用；本次只改 `callLlm` 内部对 `resolveEndpoint` 抛出的 `Error("自定义端点不能为空")` 场景做 catch-and-rethrow 为 `AppError`（或直接在 `resolveEndpoint` 内改造并让 `llmProbe.ts` 的既有 catch 分支保持兼容——`llmProbe.ts:29` 已经用 `err instanceof Error ? err.message : ...` 兜底，`AppError extends Error`，`.message` 依旧可读，不破坏现有调用方）。
- 6 处均无 `stdoutTail`/`stderrTail`，`context` 仅按需携带业务字段（如 HTTP `status`），符合 R5e。
## 关键设计取舍

| 决策 | 理由 |
|---|---|
| 不做环形缓冲，直接对 `result.stdout/stderr` 取尾部 | Rust 侧已全量无损收集（见 PRD Confirmed Facts 验证），环形缓冲是解决"流式丢弃"问题的方案，此处不存在该问题 |
| `ExternalRunner` / `commands.rs` 零改动 | 现有签名已足够；改动会牵连 Rust 编译 + tauriRunner 桥接层，超出本任务收益 |
| diagnostic_id 从 trace_id 派生而非独立生成 | 避免维护一张 ID 映射表；纯函数派生即可反查 |
| 脱敏出口设在 `buildLogEvent` 而非分散在各调用点 | "调用方无法绕过"是 PRD 硬性要求，唯一构造入口是唯一能强制的位置 |
| `AppError` 携带未脱敏原文，脱敏推迟到日志事件构造时 | 错误值对象与日志表示分离（SRP）；`AppError.message`（用户可见部分）本就不包含 stdout/stderr 原文，只有 `context` 字段包含，而 `context` 只在写日志时才会被序列化外泄 |
| 错误码与日志事件名分开两套字符串 | 错误码是跨版本稳定的错误分类标识；事件名是日志领域的分类维度；合并会让两者的演进耦合 |

## 兼容性 / 回归风险

- `downloadAudioWithYtdlp` / `downloadVideoWithYtdlp` 的返回值类型、成功路径行为完全不变，只改 `exitCode !== 0` 分支的 throw 内容 → 现有成功路径测试无需改动
- 现有测试若断言 `.toThrow("下载音频失败，请检查 yt-dlp 输出")` 这类精确字符串匹配会失败，需要在 implement 阶段同步更新为匹配 `AppError` 的错误码或 `instanceof AppError`（预期改动点，已知有 `download.test.ts`）
