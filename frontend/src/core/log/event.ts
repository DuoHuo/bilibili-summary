import type { LogLevel } from "./levels"
import { shouldLog } from "./levels"
import { redactFreeText, redactSensitiveKeys } from "./redact"

export interface LogEvent {
  ts: string // ISO 8601
  level: LogLevel
  event: string // domain.action_result
  trace_id: string
  err?: { code: string; message: string; context?: unknown }
  [key: string]: unknown // 允许附加字段，如 run_id
}

export interface Logger {
  log(level: LogLevel, event: string, fields: Omit<LogEvent, "ts" | "level" | "event">): void
}

/** 事件名必须匹配 domain.action_result（小写字母/数字/下划线，两段以上，点分隔） */
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/** 递归遍历，对所有字符串类字段应用自由文本正则脱敏 */
function deepMapStrings(value: unknown, mapper: (text: string) => string): unknown {
  if (typeof value === "string") return mapper(value)
  if (Array.isArray(value)) return value.map((item) => deepMapStrings(item, mapper))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepMapStrings(v, mapper)])
    )
  }
  return value
}

/**
 * 唯一的事件构造出口，脱敏在这里强制应用，调用方无法绕过。
 * 结构化键名通路（api_key/cookie/base_url 等）+ 自由文本正则通路（token/sessdata 值）串联执行。
 */
export function buildLogEvent(
  level: LogLevel,
  event: string,
  fields: Omit<LogEvent, "ts" | "level" | "event">
): LogEvent {
  if (!EVENT_NAME_PATTERN.test(event)) {
    throw new Error(`日志事件名不合规范（需 domain.action_result 形式）: ${event}`)
  }
  const raw = { ts: new Date().toISOString(), level, event, ...fields } as LogEvent
  const structurallyRedacted = redactSensitiveKeys(raw) as LogEvent
  return deepMapStrings(structurallyRedacted, redactFreeText) as LogEvent
}

/** 默认 noop 实现：level 过滤 + 直接构造但不输出（Phase 2 才接落盘 sink） */
export function createNoopLogger(threshold: LogLevel = "INFO"): Logger {
  return {
    log(level, event, fields) {
      if (!shouldLog(level, threshold)) return
      buildLogEvent(level, event, fields) // 强制走脱敏路径，即使当前是 noop，也验证事件形状合规
    }
  }
}
