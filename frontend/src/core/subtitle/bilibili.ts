import type { HttpFetch, Transcript, TranscriptSegment } from "../types"
import { formatTranscriptWithTimestamps } from "../transcript/format"

/** B 站 API 常用请求头（对齐 Rust reqwest 的行为，并提高成功率） */
export const BILI_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com/"
}

interface BiliViewResponse {
  code: number
  data?: { bvid?: string; cid?: number; title?: string | null } | null
}

interface BiliSubtitleIndexResponse {
  code: number
  data?: {
    subtitle?: {
      subtitles?: Array<{ subtitle_url?: string | null }> | null
      ai_subtitle?: { subtitle_url?: string | null } | null
    } | null
  } | null
}

interface BiliSubtitleBody {
  body?: Array<{ from?: number; to?: number; content?: string | null }> | null
}

/**
 * 获取 B 站元信息（标题 + cid）。
 * 移植自 backend/src/services.rs::fetch_bilibili_meta。
 */
export async function fetchBilibiliMeta(
  http: HttpFetch,
  bvid: string
): Promise<{ title: string; cid: number }> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
  const resp = await http(url, { headers: BILI_HEADERS })
  if (!resp.ok) throw new Error("获取视频信息失败")

  const payload = await resp.json<BiliViewResponse>()
  const info = payload.data
  if (!info) throw new Error("视频信息为空")

  const title = info.title ?? "未命名视频"
  if (info.cid === undefined) throw new Error("视频 CID 不存在")
  return { title, cid: info.cid }
}

/**
 * 获取 B 站字幕（支持会员 cookie），无字幕返回 null。
 * 移植自 backend/src/services.rs::fetch_bilibili_subtitles。
 */
export async function fetchBilibiliSubtitles(
  http: HttpFetch,
  bvid: string,
  cid: number,
  cookie: string | null
): Promise<Transcript | null> {
  const indexUrl = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`
  const headers: Record<string, string> = { ...BILI_HEADERS }
  if (cookie) headers.Cookie = cookie

  const indexResp = await http(indexUrl, { headers })
  if (!indexResp.ok) throw new Error("获取字幕索引失败")
  const indexPayload = await indexResp.json<BiliSubtitleIndexResponse>()

  const group = indexPayload.data?.subtitle ?? null
  const candidates = [...(group?.subtitles ?? [])]
  if (candidates.length === 0 && group?.ai_subtitle) {
    candidates.push(group.ai_subtitle)
  }
  if (candidates.length === 0) return null

  const subtitleUrl = candidates.find((item) => item.subtitle_url)?.subtitle_url
  if (!subtitleUrl) throw new Error("字幕链接不存在")
  const resolvedUrl = subtitleUrl.startsWith("//") ? `https:${subtitleUrl}` : subtitleUrl

  const bodyResp = await http(resolvedUrl, { headers })
  if (!bodyResp.ok) throw new Error("获取字幕内容失败")
  const body = await bodyResp.json<BiliSubtitleBody>()

  const segments: TranscriptSegment[] = []
  for (const item of body.body ?? []) {
    const text = item.content?.trim()
    if (!text) continue
    const from = item.from ?? 0
    segments.push({ start: from, end: item.to ?? from, text })
  }
  if (segments.length === 0) return null

  segments.sort((a, b) => a.start - b.start)
  return {
    text: formatTranscriptWithTimestamps(segments),
    segments,
    source: "subtitle"
  }
}
