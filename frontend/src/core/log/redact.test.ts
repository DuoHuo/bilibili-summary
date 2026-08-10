import { describe, expect, it } from "vitest"
import { redactFreeText, redactSensitiveKeys } from "./redact"

describe("redactSensitiveKeys", () => {
  it.each(["api_key", "apiKey", "cookie", "base_url", "baseUrl"])("命中键名 %s 时整体替换", (key) => {
    const input = { [key]: "secret-value", other: "keep" }
    const result = redactSensitiveKeys(input) as Record<string, unknown>
    expect(result[key]).toBe("[REDACTED]")
    expect(result.other).toBe("keep")
  })

  it("嵌套对象内的敏感键名也被替换", () => {
    const input = { outer: { api_key: "secret", nested: { cookie: "SESSDATA=abc" } } }
    const result = redactSensitiveKeys(input) as any
    expect(result.outer.api_key).toBe("[REDACTED]")
    expect(result.outer.nested.cookie).toBe("[REDACTED]")
  })

  it("数组场景：数组内对象元素也递归处理", () => {
    const input = { list: [{ api_key: "secret1" }, { api_key: "secret2" }] }
    const result = redactSensitiveKeys(input) as any
    expect(result.list[0].api_key).toBe("[REDACTED]")
    expect(result.list[1].api_key).toBe("[REDACTED]")
  })

  it("未命中字段不受影响", () => {
    const input = { code: "WHISPER.YTDLP_DOWNLOAD_FAILED", event: "whisper.download_failed", exitCode: 1 }
    expect(redactSensitiveKeys(input)).toEqual(input)
  })

  it("原始值（非对象/数组）原样返回", () => {
    expect(redactSensitiveKeys("plain-string")).toBe("plain-string")
    expect(redactSensitiveKeys(42)).toBe(42)
    expect(redactSensitiveKeys(null)).toBe(null)
  })
})

describe("redactFreeText", () => {
  it("命中 URL 查询串 token 参数值", () => {
    const text = "https://example.com/path?token=abc123&other=1"
    expect(redactFreeText(text)).toBe("https://example.com/path?token=[REDACTED]&other=1")
  })

  it("命中 URL 查询串 key/sign/sessdata/bili_jct 参数值", () => {
    expect(redactFreeText("?key=secret1")).toBe("?key=[REDACTED]")
    expect(redactFreeText("&sign=secret2")).toBe("&sign=[REDACTED]")
    expect(redactFreeText("?sessdata=secret3")).toBe("?sessdata=[REDACTED]")
    expect(redactFreeText("&bili_jct=secret4")).toBe("&bili_jct=[REDACTED]")
  })

  it("命中 SESSDATA=... 片段", () => {
    const text = "Cookie: SESSDATA=abcdef123456; other=value"
    expect(redactFreeText(text)).toBe("Cookie: SESSDATA=[REDACTED]; other=value")
  })

  it("未命中普通文本不受影响", () => {
    const text = "下载音频失败，请检查网络或视频链接是否有效"
    expect(redactFreeText(text)).toBe(text)
  })

  it("大小写不敏感匹配", () => {
    expect(redactFreeText("?TOKEN=abc")).toBe("?TOKEN=[REDACTED]")
  })
})
