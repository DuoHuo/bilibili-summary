/**
 * 双通路脱敏中间件，函数级隔离，互不依赖：
 * - `redactSensitiveKeys`：结构化字段，键名命中即整体替换
 * - `redactFreeText`：自由文本值匹配（键名规则拦不住的场景，如 stdoutTail/stderrTail）
 */

const SENSITIVE_KEYS = new Set(["api_key", "apiKey", "cookie", "base_url", "baseUrl"])
const REDACTED = "[REDACTED]"

/** 通路一：结构化字段，递归遍历，键名命中即整体替换 */
export function redactSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SENSITIVE_KEYS.has(k) ? [k, REDACTED] : [k, redactSensitiveKeys(v)]
      )
    )
  }
  return value
}

/**
 * 通路二：自由文本值匹配。
 * 至少覆盖 URL 查询串中 token|key|sign|sessdata|bili_jct 参数的值、SESSDATA=... 片段。
 */
const FREE_TEXT_PATTERNS: RegExp[] = [
  /([?&](?:token|key|sign|sessdata|bili_jct)=)[^&\s]+/gi,
  // 负向先行断言避免与上一条查询串规则重叠匹配（如 ?sessdata= 先被上一条脱敏后，不应再被本条重复匹配）
  /(?<![?&])(\bSESSDATA=)[^;\s]+/gi
]

export function redactFreeText(text: string): string {
  return FREE_TEXT_PATTERNS.reduce(
    (acc, pattern) =>
      acc.replace(pattern, (...args: unknown[]) => {
        // 有捕获组时 args[1] 是前缀字符串；无捕获组时 args[1] 是匹配偏移量（数字），此时整体替换
        const prefix = args[1]
        return typeof prefix === "string" ? `${prefix}${REDACTED}` : REDACTED
      }),
    text
  )
}
