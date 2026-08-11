import type { SummarizeDeps, Transcript, TranscriptSegment } from "../types"
import { AppError, generateTraceId } from "../errors"
import { formatTranscriptWithTimestamps } from "../transcript/format"
import { downloadAudioWithYtdlp } from "./download"

/** `zh-cn` → whisper.cpp 的 `zh` 语言码 */
export function mapSttLanguage(language: "zh-cn" | "en"): string {
  return language === "zh-cn" ? "zh" : "en"
}

interface WhisperTranscriptionItem {
  offsets?: { from?: number; to?: number }
  text?: string | null
}
interface WhisperSegmentItem {
  start?: number
  end?: number
  text?: string | null
}
/** whisper.cpp -oj 新版输出 transcription（offsets 毫秒）；旧版输出 segments（start/end 秒）。解析兼容两者 */
interface WhisperJson {
  transcription?: WhisperTranscriptionItem[] | null
  segments?: WhisperSegmentItem[] | null
}

/**
 * 调用 whisper.cpp CLI（whisper-cli）转写 wav，解析 JSON 输出。
 * 替代旧 web 版的 whisper-rs 内嵌推理（backend/src/services.rs::transcribe_audio_segments）。
 */
export async function transcribeWithWhisperCli(
  deps: Pick<SummarizeDeps, "runner" | "readFile" | "onProgress">,
  wavPath: string,
  language: string,
  modelPath: string,
  traceId: string = generateTraceId()
): Promise<TranscriptSegment[]> {
  const base = wavPath.replace(/\.wav$/, "")
  const result = await deps.runner(
    "whisper-cli",
    ["-m", modelPath, "-f", wavPath, "-l", language, "-oj", "-of", base],
    { onLine: (line) => deps.onProgress?.("whisper", line) }
  )
  if (result.exitCode !== 0) {
    throw new AppError("WHISPER.TRANSCRIBE_FAILED", { traceId, context: { exitCode: result.exitCode } })
  }

  let data: WhisperJson
  try {
    data = JSON.parse(await deps.readFile(`${base}.json`)) as WhisperJson
  } catch (cause) {
    throw new AppError("WHISPER.PARSE_RESULT_FAILED", { traceId, cause })
  }

  const segments: TranscriptSegment[] = []
  // 新版 transcription（offsets 毫秒）优先，旧版 segments（秒）兼容
  const items: Array<WhisperTranscriptionItem | WhisperSegmentItem> = data.transcription ?? data.segments ?? []
  for (const item of items) {
    const text = item.text?.trim()
    if (!text) continue
    if ("offsets" in item && item.offsets) {
      segments.push({
        start: (item.offsets.from ?? 0) / 1000,
        end: (item.offsets.to ?? item.offsets.from ?? 0) / 1000,
        text
      })
    } else {
      const seg = item as WhisperSegmentItem
      segments.push({ start: seg.start ?? 0, end: seg.end ?? seg.start ?? 0, text })
    }
  }
  return segments
}

/**
 * Whisper 转写编排：下载音频 → whisper-cli 转写 → Transcript。
 * 移植自 backend/src/services.rs::transcribe_with_whisper。
 */
export async function transcribeWithWhisper(
  deps: Pick<SummarizeDeps, "runner" | "readFile" | "isFile" | "writeFile" | "resolveModelPath" | "onProgress">,
  url: string,
  cookie: string | null,
  language: "zh-cn" | "en",
  resourcesDir: string
): Promise<Transcript> {
  // resourcesDir 即音频缓存目录：命中复用，未命中下载后自然入缓存。
  const traceId = generateTraceId()
  const wavPath = await downloadAudioWithYtdlp(deps, url, cookie, resourcesDir, resourcesDir)
  const modelPath = await deps.resolveModelPath()
  const segments = await transcribeWithWhisperCli(
    deps,
    wavPath,
    mapSttLanguage(language),
    modelPath,
    traceId
  )
  if (segments.length === 0) {
    throw new AppError("WHISPER.EMPTY_RESULT", { traceId })
  }
  return {
    text: formatTranscriptWithTimestamps(segments),
    segments,
    source: "whisper"
  }
}
