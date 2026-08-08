import type { SummarizeDeps } from "../types"
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

/** 用 yt-dlp 下载音频并转为 16k 单声道 wav。移植自 download_audio_with_ytdlp。 */
export async function downloadAudioWithYtdlp(
  deps: Pick<SummarizeDeps, "runner" | "isFile" | "writeFile" | "onProgress">,
  url: string,
  cookie: string | null,
  outputDir: string
): Promise<string> {
  const outputName = buildWhisperAudioName(url)
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
    throw new Error("下载音频失败，请检查 yt-dlp 输出")
  }

  const wavPath = `${outputDir}/${outputName}.wav`
  if (await deps.isFile(wavPath)) return wavPath
  throw new Error("下载音频失败，未找到 wav 文件")
}

/** 用 yt-dlp 下载视频（截图用）。移植自 download_video_with_ytdlp。 */
export async function downloadVideoWithYtdlp(
  deps: Pick<SummarizeDeps, "runner" | "isFile" | "writeFile" | "onProgress">,
  url: string,
  cookie: string | null,
  outputDir: string
): Promise<string> {
  const outputName = buildWhisperAudioName(url)
  const outputTemplate = `${outputDir}/${outputName}.%(ext)s`
  const cookieArgs = await resolveCookieArgs(deps, url, cookie, outputDir)

  const result = await deps.runner(
    "yt-dlp",
    ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4", "-o", outputTemplate, ...cookieArgs, url],
    { cwd: outputDir, stage: "whisper", onLine: (line) => deps.onProgress?.("whisper", line) }
  )
  if (result.exitCode !== 0) {
    throw new Error("下载视频失败，请检查 yt-dlp 输出")
  }

  const mp4Path = `${outputDir}/${outputName}.mp4`
  if (await deps.isFile(mp4Path)) return mp4Path
  throw new Error("下载视频失败，未找到 mp4 文件")
}
