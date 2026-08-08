import { describe, expect, it } from "vitest"
import { buildOutputMarkdown, formatTranscriptSource, stripMarkdownTitle } from "./markdown"

describe("stripMarkdownTitle", () => {
  it("剥离首行标题与后续空行", () => {
    expect(stripMarkdownTitle("# 标题\n\n正文")).toBe("正文")
  })

  it("标题后无空行则直接接正文", () => {
    expect(stripMarkdownTitle("# 标题\n正文")).toBe("正文")
  })

  it("无标题则原样返回并 trim", () => {
    expect(stripMarkdownTitle("  \n正文  \n")).toBe("正文")
  })
})

describe("buildOutputMarkdown", () => {
  const base = {
    title: "示例视频",
    summary: "## 核心论点\n一句话",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    time: "2026-08-08 12:00:00",
    transcriptSource: "subtitle" as const,
    transcriptSegments: [
      { start: 0.5, end: 3.2, text: "大家好" },
      { start: 3.5, end: 6.8, text: "欢迎收看" }
    ]
  }

  it("summary 模式不含字幕小节", () => {
    const md = buildOutputMarkdown({ ...base, mode: "summary" })
    expect(md).toContain("# 示例视频")
    expect(md).not.toContain("## 摘要")
    expect(md).toContain("## 视频信息")
    expect(md).toContain("- 视频地址: https://www.bilibili.com/video/BV1xx411c7mD")
    expect(md).toContain("- 生成时间: 2026-08-08 12:00:00")
    expect(md).not.toContain("## 字幕内容")
  })

  it("timestamp 模式追加字幕来源，不重复输出字幕内容", () => {
    const md = buildOutputMarkdown({ ...base, mode: "timestamp" })
    expect(md).toContain("## 字幕来源\n\n官方字幕")
    expect(md).not.toContain("## 字幕内容")
  })
})

describe("formatTranscriptSource", () => {
  it("subtitle → 官方字幕", () => {
    expect(formatTranscriptSource("subtitle")).toBe("官方字幕")
  })
  it("whisper → Whisper 转录", () => {
    expect(formatTranscriptSource("whisper")).toBe("Whisper 转录")
  })
  it("null → 未知", () => {
    expect(formatTranscriptSource(null)).toBe("未知")
  })
})
