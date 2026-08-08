import type { HttpFetch, Transcript, TranscriptSegment } from "../types"
import { parseYoutubeSubtitlesXml } from "./parse"
import { formatTranscriptWithTimestamps } from "../transcript/format"

interface YoutubeOEmbed {
  title?: string | null
}

/**
 * 获取 YouTube 标题（oEmbed）。
 * 移植自 backend/src/services.rs::fetch_youtube_title。
 */
export async function fetchYoutubeTitle(http: HttpFetch, url: string): Promise<string> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
  const resp = await http(endpoint)
  if (!resp.ok) throw new Error("获取 YouTube 标题失败")
  const data = await resp.json<YoutubeOEmbed>()
  return data.title ?? "未命名视频"
}

/** 字幕语言优先级：中文 → 英文 */
const SUBTITLE_LANGUAGES = ["zh-Hans", "zh", "en"] as const

/**
 * 获取 YouTube 字幕：按语言优先级，先官方字幕后自动字幕（asr）。
 * 移植自 backend/src/services.rs::fetch_youtube_subtitles。
 */
export async function fetchYoutubeSubtitles(
  http: HttpFetch,
  videoId: string
): Promise<Transcript | null> {
  for (const language of SUBTITLE_LANGUAGES) {
    const manual = await fetchYoutubeSubtitlesByLanguage(http, videoId, language, false)
    if (manual) return wrap(manual)
    const asr = await fetchYoutubeSubtitlesByLanguage(http, videoId, language, true)
    if (asr) return wrap(asr)
  }
  return null
}

function wrap(segments: TranscriptSegment[]): Transcript {
  return {
    text: formatTranscriptWithTimestamps(segments),
    segments,
    source: "subtitle"
  }
}

async function fetchYoutubeSubtitlesByLanguage(
  http: HttpFetch,
  videoId: string,
  language: string,
  useAsr: boolean
): Promise<TranscriptSegment[] | null> {
  const asrSuffix = useAsr ? "&kind=asr" : ""
  const url = `https://video.google.com/timedtext?lang=${language}&v=${videoId}&fmt=srv3${asrSuffix}`
  const resp = await http(url)
  if (!resp.ok) return null
  const xml = await resp.text()
  const segments = parseYoutubeSubtitlesXml(xml)
  return segments.length > 0 ? segments : null
}
