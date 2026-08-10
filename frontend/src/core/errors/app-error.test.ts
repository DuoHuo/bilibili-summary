import { describe, expect, it } from "vitest"
import { AppError, tailLines } from "./app-error"

describe("AppError", () => {
  it("message 包含人话文案 + 错误码 + 诊断 ID 三段", () => {
    const err = new AppError("WHISPER.YTDLP_DOWNLOAD_FAILED", { traceId: "trace-1" })
    expect(err.message).toContain("下载音频失败")
    expect(err.message).toContain("WHISPER.YTDLP_DOWNLOAD_FAILED")
    expect(err.message).toContain(err.diagnosticId)
  })

  it("字段正确：code / traceId / diagnosticId / context", () => {
    const context = { exitCode: 1, stdoutTail: "out", stderrTail: "err" }
    const err = new AppError("WHISPER.WAV_NOT_FOUND", { traceId: "trace-2", context })
    expect(err.code).toBe("WHISPER.WAV_NOT_FOUND")
    expect(err.traceId).toBe("trace-2")
    expect(err.diagnosticId).toHaveLength(8)
    expect(err.context).toEqual(context)
  })

  it("instanceof Error 且 instanceof AppError", () => {
    const err = new AppError("WHISPER.MP4_NOT_FOUND", { traceId: "trace-3" })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(AppError)
  })

  it("未知错误码兜底用 code 本身当消息，不 throw", () => {
    expect(() => new AppError("UNKNOWN.CODE", { traceId: "trace-4" })).not.toThrow()
    const err = new AppError("UNKNOWN.CODE", { traceId: "trace-4" })
    expect(err.message).toContain("UNKNOWN.CODE")
  })

  it("cause 透传", () => {
    const cause = new Error("underlying")
    const err = new AppError("WHISPER.YTDLP_DOWNLOAD_FAILED", { traceId: "trace-5", cause })
    expect(err.cause).toBe(cause)
  })
})

describe("tailLines", () => {
  it("undefined 输入返回 undefined", () => {
    expect(tailLines(undefined, 10)).toBeUndefined()
  })

  it("空字符串返回 undefined（不生成空字符串噪音）", () => {
    expect(tailLines("", 10)).toBeUndefined()
  })

  it("行数等于 maxLines 时原样返回", () => {
    const text = "a\nb\nc"
    expect(tailLines(text, 3)).toBe(text)
  })

  it("行数小于 maxLines 时原样返回", () => {
    const text = "a\nb"
    expect(tailLines(text, 10)).toBe(text)
  })

  it("行数大于 maxLines 时取末尾 N 行", () => {
    const text = "1\n2\n3\n4\n5"
    expect(tailLines(text, 2)).toBe("4\n5")
  })

  it("单行超长文本：只有一行时原样返回", () => {
    const longLine = "x".repeat(10000)
    expect(tailLines(longLine, 200)).toBe(longLine)
  })
})
