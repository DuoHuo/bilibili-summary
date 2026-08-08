import type { TranscriptSegment } from "../types"

/** 移植自 backend/src/utils.rs::format_timestamp。秒数四舍五入为 mm:ss。 */
export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remaining = totalSeconds % 60
  return `${pad2(minutes)}:${pad2(remaining)}`
}

/** 移植自 backend/src/utils.rs::format_transcript_with_timestamps。 */
export function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}-${formatTimestamp(segment.end)}] ${segment.text}`
    )
    .join("\n")
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0")
}
