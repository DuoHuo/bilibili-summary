import type { TranscriptSegment, TranscriptSource } from "../types"

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
  // 不套固定「## 摘要」标题：LLM 内容直接跟在主标题下（不同模式内容形态各异）
  let markdown =
    `# ${input.title}

${summary}

## 视频信息

` +
    `- 视频地址: ${input.url}\n- 生成时间: ${input.time}`

  if (input.mode === "timestamp") {
    // 正文已是合并后的时间戳字幕，不再重复输出「字幕内容」；仅保留来源标注
    markdown += `\n\n## 字幕来源\n\n${formatTranscriptSource(input.transcriptSource)}`
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
