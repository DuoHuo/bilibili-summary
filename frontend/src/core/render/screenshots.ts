import type { SummarizeDeps } from "../types"

/**
 * 用 ffmpeg 在指定时间戳截图。移植自 backend/src/services.rs::generate_screenshot。
 */
export async function generateScreenshot(
  deps: Pick<SummarizeDeps, "runner" | "onProgress">,
  videoPath: string,
  outputDir: string,
  timestamp: number,
  index: number
): Promise<string> {
  const filename = `screenshot_${String(index).padStart(3, "0")}_${timestamp}.jpg`
  const outputPath = `${outputDir}/${filename}`
  const result = await deps.runner(
    "ffmpeg",
    ["-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath, "-y"],
    { stage: "render", onLine: (line) => deps.onProgress?.("render", line) }
  )
  if (result.exitCode !== 0) {
    throw new Error("截图失败，请检查 ffmpeg 输出")
  }
  return outputPath
}
