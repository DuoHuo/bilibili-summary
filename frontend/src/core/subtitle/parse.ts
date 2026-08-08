import type { TranscriptSegment } from "../types"

/**
 * 解析 YouTube timedtext XML（fmt=srv3：`<p t="毫秒" d="毫秒">text</p>`）。
 * 移植自 backend/src/utils.rs::parse_youtube_subtitles_xml。
 */
export function parseYoutubeSubtitlesXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  const pTag = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  for (const match of xml.matchAll(pTag)) {
    const attrs = match[1] ?? ""
    const rawText = match[2] ?? ""
    const t = /t="([^"]*)"/.exec(attrs)?.[1]
    const d = /d="([^"]*)"/.exec(attrs)?.[1]
    const start = t ? parseFloat(t) / 1000 : 0
    const duration = d ? parseFloat(d) / 1000 : 0
    const text = rawText.replace(/\n/g, " ").replace(/\r/g, " ").trim()
    if (!text) continue
    const end = duration > 0 ? start + duration : start
    segments.push({ start, end, text })
  }
  return segments
}
