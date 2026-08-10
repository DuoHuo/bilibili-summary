import type { SummarizeDeps } from "../types"
import { AppError, generateTraceId, tailLines } from "../errors"
import { buildWhisperAudioName } from "./audio"
import { buildNetscapeCookieContent } from "./cookies"

/**
 * 解析 cookie 为 yt-dlp `--cookies` 参数：
 * - 已有文件路径 → 原样使用
 * - `key=value; ...` 串 → 写入 Netscape cookies.txt
 * 移植自 backend/src/services.rs::prepare_ytdlp_cookies。
 */
async function resolveCookieArgs(
  deps: Pick<SummarizeDeps, "isFile" | "writeFile">,
  url: string,
  cookie: string | null,
  outputDir: string
): Promise<string[]> {
  const value = cookie?.trim()
  if (!value) return []

  if (await deps.isFile(value)) {
    return ["--cookies", value]
  }

  if (!value.includes("=")) {
    throw new Error(`cookie 字段既不是已存在的文件，也不是有效的 cookie 字符串: ${value}`)
  }

  const cookiePath = `${outputDir}/cookies.txt`
  await deps.writeFile(cookiePath, buildNetscapeCookieContent(url, value))
  return ["--cookies", cookiePath]
}

/** 用 yt-dlp 下载音频并转为 16k 单声道 wav。移植自 download_audio_with_ytdlp。
 * 若提供 cacheDir：`{cacheDir}/{key}.wav` 已存在则直接复用（跳过下载）。
 * 未提供 cacheDir 时行为与旧版一致（兼容测试契约）。 */
export async function downloadAudioWithYtdlp(
  deps: Pick<SummarizeDeps, "runner" | "isFile" | "writeFile" | "onProgress">,
  url: string,
  cookie: string | null,
  outputDir: string,
  cacheDir?: string
): Promise<string> {
  const outputName = buildWhisperAudioName(url)
  // 缓存命中：同一视频（同 key）的 wav 已存在，直接复用。
  const cachePath = cacheDir ? `${cacheDir}/${outputName}.wav` : null
  if (cachePath && (await deps.isFile(cachePath))) {
    deps.onProgress?.("whisper", `复用缓存音频 ${outputName}.wav`)
    return cachePath
  }

  const traceId = generateTraceId()
  const outputTemplate = `${outputDir}/${outputName}.%(ext)s`
  const cookieArgs = await resolveCookieArgs(deps, url, cookie, outputDir)

  const result = await deps.runner(
    "yt-dlp",
    [
      "-x",
      "--audio-format",
      "wav",
      "--audio-quality",
      "0",
      "--postprocessor-args",
      "-ar 16000 -ac 1",
      "-o",
      outputTemplate,
      ...cookieArgs,
      url
    ],
    { cwd: outputDir, stage: "whisper", onLine: (line) => deps.onProgress?.("whisper", line) }
  )
  if (result.exitCode !== 0) {
    throw new AppError("WHISPER.YTDLP_DOWNLOAD_FAILED", {
      traceId,
      context: {
        exitCode: result.exitCode,
        stdoutTail: tailLines(result.stdout, 200),
        stderrTail: tailLines(result.stderr, 200)
      }
    })
  }

  const wavPath = `${outputDir}/${outputName}.wav`
  if (await deps.isFile(wavPath)) return wavPath
  throw new AppError("WHISPER.WAV_NOT_FOUND", { traceId })
}

/** 用 yt-dlp 下载视频（截图用）。移植自 download_video_with_ytdlp。 */
export async function downloadVideoWithYtdlp(
  deps: Pick<SummarizeDeps, "runner" | "isFile" | "writeFile" | "onProgress">,
  url: string,
  cookie: string | null,
  outputDir: string
): Promise<string> {
  const traceId = generateTraceId()
  const outputName = buildWhisperAudioName(url)
  const outputTemplate = `${outputDir}/${outputName}.%(ext)s`
  const cookieArgs = await resolveCookieArgs(deps, url, cookie, outputDir)

  const result = await deps.runner(
    "yt-dlp",
    ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4", "-o", outputTemplate, ...cookieArgs, url],
    { cwd: outputDir, stage: "whisper", onLine: (line) => deps.onProgress?.("whisper", line) }
  )
  if (result.exitCode !== 0) {
    throw new AppError("WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED", {
      traceId,
      context: {
        exitCode: result.exitCode,
        stdoutTail: tailLines(result.stdout, 200),
        stderrTail: tailLines(result.stderr, 200)
      }
    })
  }

  const mp4Path = `${outputDir}/${outputName}.mp4`
  if (await deps.isFile(mp4Path)) return mp4Path
  throw new AppError("WHISPER.MP4_NOT_FOUND", { traceId })
}
