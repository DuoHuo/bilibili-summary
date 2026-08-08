import type { TranscriptSegment, TranscriptSource } from "../types"
import { formatTranscriptWithTimestamps } from "../transcript/format"

/**
 * 剥离 Markdown 首行 `# 标题` 及其后的空行。
 * 移植自 backend/src/summarize.rs::strip_markdown_title。
 */
export function stripMarkdownTitle(markdown: string): string {
  const lines = markdown.split("\n")
  const result: string[] = []
  let skippedTitle = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!skippedTitle && line.trimStart().startsWith("# ")) {
      skippedTitle = true
      // 跳过标题后紧跟的空行
      const next = lines[index + 1]
      if (next !== undefined && next.trim() !== "") {
        result.push(next)
        index++
      }
      continue
    }
    result.push(line)
  }
  return result.join("\n").trim()
}

/**
 * 组装输出 Markdown。timestamp 模式追加字幕来源与字幕内容。
 * 移植自 backend/src/summarize.rs::build_output_markdown。
 */
export function buildOutputMarkdown(input: {
  mode: string
  title: string
  summary: string
  url: string
  time: string
  transcriptSource: TranscriptSource
  transcriptSegments: TranscriptSegment[]
}): string {
  const summary = stripMarkdownTitle(input.summary)
  let markdown =
    `# ${input.title}\n\n## 摘要\n\n${summary}\n\n## 视频信息\n\n` +
    `- 视频地址: ${input.url}\n- 生成时间: ${input.time}`

  if (input.mode === "timestamp") {
    const formatted = formatTranscriptWithTimestamps(input.transcriptSegments)
    markdown += `\n\n## 字幕来源\n\n${formatTranscriptSource(input.transcriptSource)}\n\n## 字幕内容\n\n${formatted}`
  }

  return markdown
}

/** 移植自 backend/src/services.rs::format_transcript_source */
export function formatTranscriptSource(source: TranscriptSource): string {
  switch (source) {
    case "subtitle":
      return "官方字幕"
    case "whisper":
      return "Whisper 转录"
    default:
      return "未知"
  }
}
