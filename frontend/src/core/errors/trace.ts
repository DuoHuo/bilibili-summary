/**
 * trace_id 生成 + diagnostic_id 派生。
 * trace_id 在每次可诊断操作入口独立生成；diagnostic_id 由 trace_id 确定性派生，
 * 供用户口述/复制，天然可反查（同一 trace_id 永远得到同一个 diagnostic_id）。
 */

/** Crockford base32 字母表：天然剔除 I/L/O/U，无需重新发明字母表 */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const DIAGNOSTIC_ID_LENGTH = 8

export function generateTraceId(): string {
  return crypto.randomUUID()
}

/** 对输入字符串做简单确定性哈希（非密码学强度，仅要求同输入同输出） */
function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * 对 traceId 做确定性映射 → Crockford base32 字母表前 8 位。
 * 同一 traceId 永远得到同一个 diagnosticId。
 */
export function deriveDiagnosticId(traceId: string): string {
  let result = ""
  for (let i = 0; i < DIAGNOSTIC_ID_LENGTH; i++) {
    const hash = hashString(`${traceId}:${i}`)
    result += CROCKFORD_ALPHABET[hash % CROCKFORD_ALPHABET.length]
  }
  return result
}
