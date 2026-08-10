import type { SummarizeDeps, Transcript, TranscriptSegment } from "../types"
import { AppError, generateTraceId } from "../errors"
import { formatTranscriptWithTimestamps } from "../transcript/format"
import { downloadAudioWithYtdlp } from "./download"

/** `zh-cn` → whisper.cpp 的 `zh` 语言码 */
export function mapSttLanguage(language: "zh-cn" | "en"): string {
  return language === "zh-cn" ? "zh" : "en"
}

interface WhisperJson {
  segments?: Array<{ start?: number; end?: number; text?: string | null }> | null
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
  for (const item of data.segments ?? []) {
    const text = item.text?.trim()
    if (!text) continue
    segments.push({ start: item.start ?? 0, end: item.end ?? item.start ?? 0, text })
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
