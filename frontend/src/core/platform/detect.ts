import type { Platform } from "../types"

/**
 * 平台识别：B 站 / YouTube / 不支持。
 * 移植自 backend/src/services.rs::detect_platform。
 */
export function detectPlatform(url: string): Platform {
  const parsed = new URL(url)
  const host = parsed.hostname
  if (host.includes("bilibili.com")) {
    return "bilibili"
  }
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return "youtube"
  }
  throw new Error("暂不支持该链接，请输入 B 站或 YouTube 视频链接")
}
