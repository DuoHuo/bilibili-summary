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

/**
 * 可注入任意 sink 的 Logger 工厂；脱敏在 buildLogEvent 内强制发生，
 * sink 收到的是已脱敏、已校验的 LogEvent —— 不存在绕过脱敏的旁路。
 * sink 异常被吞咽（日志是辅助通道，不得拖垮主流程）；事件名/形状不合规则在 buildLogEvent 阶段抛错（编程错误，不吞）。
 */
export function createLogger(sink: (e: LogEvent) => void, threshold: LogLevel = "INFO"): Logger {
  return {
    log(level, event, fields) {
      if (!shouldLog(level, threshold)) return
      const evt = buildLogEvent(level, event, fields) // 强制脱敏 + 事件名校验（不合规则抛错，不吞）
      try {
        sink(evt)
      } catch {
        // sink 写入失败静默（日志不得反噬主流程）
      }
    }
  }
}

/** noop 兼容：退化为 sink=()=>{} 的特例；保持原签名与行为，现有调用方与测试零改动 */
export function createNoopLogger(threshold: LogLevel = "INFO"): Logger {
  return createLogger(() => {}, threshold)
}
