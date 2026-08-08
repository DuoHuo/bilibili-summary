import type { TranscriptSegment } from "../types"

/** 移植自 backend/src/services.rs::TIMESTAMP_MERGE_THRESHOLD_SECS */
export const TIMESTAMP_MERGE_THRESHOLD_SECS = 15.0

/**
 * Timestamp 模式：贪心合并相邻 segment 直到累计时长达到阈值。
 * 移植自 backend/src/services.rs::merge_transcript_segments。
 */
export function mergeTranscriptSegments(
  segments: TranscriptSegment[],
  targetDurationSecs: number
): TranscriptSegment[] {
  if (segments.length === 0) return []
  const chunks: TranscriptSegment[] = []
  let cur: TranscriptSegment = { ...segments[0] }
  for (const next of segments.slice(1)) {
    if (next.end - cur.start < targetDurationSecs) {
      cur.text = `${cur.text} ${next.text}`
      cur.end = next.end
    } else {
      chunks.push(cur)
      cur = { ...next }
    }
  }
  chunks.push(cur)
  return chunks
}
