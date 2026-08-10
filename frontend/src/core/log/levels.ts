export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** level 是否应在 threshold 下输出（threshold 及以上级别放行） */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold)
}
