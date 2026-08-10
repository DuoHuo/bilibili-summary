import { ERROR_MESSAGES } from "./codes"
import { deriveDiagnosticId } from "./trace"

export interface AppErrorContext {
  exitCode?: number
  stdoutTail?: string
  stderrTail?: string
  [key: string]: unknown
}

export interface AppErrorOptions {
  traceId: string
  context?: AppErrorContext
  cause?: unknown
}

/**
 * 结构化错误：错误码 + 人话消息 + trace_id + diagnostic_id + 可选 context。
 * `message`（用户可见部分）= 人话文案 + 错误码 + 诊断 ID 三段自包含，
 * 因为上层包装层（如 lib/api.ts::SummarizeError）只透传 message，其余字段会丢失。
 * `context` 携带未脱敏的原始诊断信息（如 stdoutTail/stderrTail），脱敏推迟到
 * 写入日志事件时（core/log/ 的职责），两者职责分离。
 */
export class AppError extends Error {
  readonly code: string
  readonly traceId: string
  readonly diagnosticId: string
  readonly context?: AppErrorContext

  constructor(code: string, opts: AppErrorOptions) {
    const humanMessage = ERROR_MESSAGES[code] ?? code
    const diagnosticId = deriveDiagnosticId(opts.traceId)
    super(`${humanMessage}（错误码 ${code}，诊断 ID ${diagnosticId}）`)
    this.name = "AppError"
    this.code = code
    this.traceId = opts.traceId
    this.diagnosticId = diagnosticId
    this.context = opts.context
    if (opts.cause !== undefined) this.cause = opts.cause
  }
}

/** 取文本末 N 行；空/undefined 输入返回 undefined（不生成空字符串噪音） */
export function tailLines(text: string | undefined, maxLines: number): string | undefined {
  if (!text) return undefined
  const lines = text.split("\n")
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join("\n")
}
