import { parseBilibiliId, parseYoutubeId } from "../platform/parse"

/**
 * 生成音频/视频文件名：B 站用 BV 号，YouTube 用 `youtube-{id}`，否则时间戳。
 * 移植自 backend/src/services.rs::build_whisper_audio_name。
 */
export function buildWhisperAudioName(url: string): string {
  const bvid = parseBilibiliId(url)
  if (bvid) return bvid
  const ytId = parseYoutubeId(url)
  if (ytId) return `youtube-${ytId}`
  return `audio-${Date.now()}`
}
