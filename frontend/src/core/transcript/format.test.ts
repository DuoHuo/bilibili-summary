import { describe, expect, it } from "vitest"
import { formatTimestamp, formatTranscriptWithTimestamps } from "./format"

describe("formatTimestamp", () => {
  it("零秒", () => {
    expect(formatTimestamp(0)).toBe("00:00")
  })

  it("四舍五入", () => {
    expect(formatTimestamp(61.4)).toBe("01:01")
    expect(formatTimestamp(59.6)).toBe("01:00")
  })

  it("超过一小时", () => {
    expect(formatTimestamp(3661)).toBe("61:01")
  })

  it("负数归零", () => {
    expect(formatTimestamp(-5)).toBe("00:00")
  })
})

describe("formatTranscriptWithTimestamps", () => {
  it("拼接时间戳与文本", () => {
    const segments = [
      { start: 0.5, end: 3.2, text: "大家好" },
      { start: 3.5, end: 6.8, text: "欢迎收看" }
    ]
    expect(formatTranscriptWithTimestamps(segments)).toBe(
      "[00:01-00:03] 大家好\n[00:04-00:07] 欢迎收看"
    )
  })

  it("空数组返回空串", () => {
    expect(formatTranscriptWithTimestamps([])).toBe("")
  })
})
