/**
 * URL 解析：提取 B 站 BV 号 / YouTube 视频 ID。
 * 移植自 backend/src/services.rs::parse_bilibili_id / parse_youtube_id。
 */

export function parseBilibiliId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const bv = segments.find((segment) => segment.startsWith("BV"))
    return bv ?? null
  } catch {
    return null
  }
}

export function parseYoutubeId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null
    }
    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments[0] === "watch") {
      return parsed.searchParams.get("v")
    }
    if (segments[0] === "shorts") {
      return segments[1] ?? null
    }
    return null
  } catch {
    return null
  }
}
