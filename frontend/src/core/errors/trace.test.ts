import { describe, expect, it } from "vitest"
import { deriveDiagnosticId, generateTraceId } from "./trace"

const CROCKFORD_CHARS = new Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ".split(""))

describe("generateTraceId", () => {
  it("生成非空字符串", () => {
    expect(generateTraceId().length).toBeGreaterThan(0)
  })

  it("多次调用结果不同", () => {
    const a = generateTraceId()
    const b = generateTraceId()
    expect(a).not.toBe(b)
  })
})

describe("deriveDiagnosticId", () => {
  it("同一 traceId 两次调用结果一致", () => {
    const traceId = "fixed-trace-id-1"
    expect(deriveDiagnosticId(traceId)).toBe(deriveDiagnosticId(traceId))
  })

  it("不同 traceId 大概率不同", () => {
    const a = deriveDiagnosticId("trace-a")
    const b = deriveDiagnosticId("trace-b")
    expect(a).not.toBe(b)
  })

  it("长度固定为 8", () => {
    expect(deriveDiagnosticId(generateTraceId())).toHaveLength(8)
  })

  it("输出只含 Crockford 字母表字符（无易混字符 0/O/1/I/L 之外的额外规则）", () => {
    const id = deriveDiagnosticId(generateTraceId())
    for (const char of id) {
      expect(CROCKFORD_CHARS.has(char)).toBe(true)
    }
  })
})
