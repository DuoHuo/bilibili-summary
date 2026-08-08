import type { PromptMode } from "@/lib/prompts"
import type {
  GenerateRequest,
  PrepareRequest,
  Stage,
  SummarizeDeps,
  SummarizeOutput,
  Transcript,
  TranscriptSegment,
  TranscriptSource
} from "../types"
import { detectPlatform } from "../platform/detect"
import { parseBilibiliId, parseYoutubeId } from "../platform/parse"
import { fetchBilibiliMeta, fetchBilibiliSubtitles } from "../subtitle/bilibili"
import { fetchYoutubeSubtitles, fetchYoutubeTitle } from "../subtitle/youtube"
import { formatTranscriptWithTimestamps } from "../transcript/format"
import { mergeTranscriptSegments, TIMESTAMP_MERGE_THRESHOLD_SECS } from "../transcript/merge"
import { buildPrompt } from "../llm/prompt"
import { callLlm } from "../llm/client"
import { transcribeWithWhisper } from "../whisper"
import { downloadVideoWithYtdlp } from "../whisper/download"
import { buildOutputMarkdown } from "../render/markdown"
import { extractScreenshotMarkers } from "../render/markers"
import { generateScreenshot } from "../render/screenshots"

export type { PromptMode, Stage, SummarizeDeps, SummarizeOutput, PrepareRequest, GenerateRequest }

/** run_id：UUID v4（对齐 backend 的 Uuid::new_v4） */
function generateRunId(): string {
  return crypto.randomUUID()
}

/** `YYYY-MM-DD HH:mm:ss`，对齐 chrono Local::now().format */
function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatTimestampSummary(segments: TranscriptSegment[]): string {
  const pad2 = (n: number) => n.toString().padStart(2, "0")
  return segments
    .map((s) => {
      const start = Math.floor(s.start)
      const end = Math.floor(s.end)
      return `[${pad2(Math.floor(start / 60))}:${pad2(start % 60)}-${pad2(Math.floor(end / 60))}:${pad2(end % 60)}] ${s.text}`
    })
    .join("\n\n")
}

/**
 * 阶段一：字幕准备（一次性，多模式共享）。
 * detect → fetch_subtitle → [whisper]；落盘 transcript_{runId}.txt，返回供 generateMode 复用。
 */
export async function prepareTranscript(
  req: PrepareRequest,
  deps: SummarizeDeps
): Promise<{ run_id: string; run_dir: string; title: string; transcript: Transcript }> {
  const runId = req.run_id ?? generateRunId()
  const runDir = await deps.resolveOutputDir(runId)
  // 包装依赖：所有外部进程携带本任务 run_id（供 kill 与进度事件路由）。
  const scopedDeps: SummarizeDeps = {
    ...deps,
    runner: (program, args, options) =>
      deps.runner(program, args, { ...options, id: runId })
  }

  // 1. detect_platform
  scopedDeps.onProgress?.("detect")
  const platform = detectPlatform(req.url)

  // 2. fetch_subtitle
  scopedDeps.onProgress?.("fetch_subtitle")
  let title: string
  let transcript: Transcript | null
  if (platform === "bilibili") {
    const bvid = parseBilibiliId(req.url)
    if (!bvid) throw new Error("无效的 B 站链接")
    const meta = await fetchBilibiliMeta(scopedDeps.http, bvid)
    title = meta.title
    transcript = await fetchBilibiliSubtitles(scopedDeps.http, bvid, meta.cid, req.cookie)
  } else {
    const videoId = parseYoutubeId(req.url)
    if (!videoId) throw new Error("无效的 YouTube 链接")
    title = await fetchYoutubeTitle(scopedDeps.http, req.url)
    transcript = await fetchYoutubeSubtitles(scopedDeps.http, videoId)
  }

  // 3. whisper_transcribe（字幕缺失时兜底）
  if (!transcript) {
    scopedDeps.onProgress?.("whisper")
    // 音频作为产物直接落盘到 run 目录（与摘要文件并列）
    transcript = await transcribeWithWhisper(
      scopedDeps,
      req.url,
      req.cookie,
      req.stt_language,
      runDir
    )
  }

  // 字幕落盘（共享基础）：纯文本 + 结构化 JSON（segments/source，供重启后懒生成恢复）
  await scopedDeps.writeFile(`${runDir}/transcript_${runId}.txt`, transcript.text)
  await scopedDeps.writeFile(
    `${runDir}/transcript_${runId}.json`,
    JSON.stringify({ segments: transcript.segments, source: transcript.source })
  )

  return { run_id: runId, run_dir: runDir, title, transcript }
}

/**
 * 阶段二：按模式懒生成（llm + render，共享 transcript）。
 * 落盘 {runDir}/{mode}.md / .html；返回完整产物。
 */
export async function generateMode(req: GenerateRequest, deps: SummarizeDeps): Promise<SummarizeOutput> {
  const { run_id: runId, mode } = req
  const runDir = await deps.resolveOutputDir(runId)
  const now = deps.now?.() ?? new Date()
  // 模式级进程 id：取消/进度路由只影响该模式
  const scopedDeps: SummarizeDeps = {
    ...deps,
    runner: (program, args, options) =>
      deps.runner(program, args, { ...options, id: `${runId}:${mode}` })
  }

  // 1. build_prompt
  scopedDeps.onProgress?.("build_prompt")
  const transcriptText =
    mode === "timestamp"
      ? req.transcript.segments.map((s) => s.text).join("\n")
      : formatTranscriptWithTimestamps(req.transcript.segments)
  const prompt = buildPrompt({
    title: req.title,
    transcript: transcriptText,
    customPrompt: req.custom_prompt,
    mode,
    screenshot: req.screenshot
  })

  // 2. call_llm
  scopedDeps.onProgress?.("llm")
  const rawSummary = await callLlm(scopedDeps.http, req.api_key, req.model, req.base_url, prompt)

  let finalSegments: TranscriptSegment[] = req.transcript.segments
  let summaryText = rawSummary
  if (mode === "timestamp") {
    // LLM 按行 1:1 修正字幕 → 与原 segment 时间戳对齐 → 15s 合并
    const correctedLines = rawSummary
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
    const correctedSegments = req.transcript.segments.map((seg, index) => ({
      start: seg.start,
      end: seg.end,
      text: correctedLines[index] ?? seg.text
    }))
    finalSegments = mergeTranscriptSegments(correctedSegments, TIMESTAMP_MERGE_THRESHOLD_SECS)
    summaryText = formatTimestampSummary(finalSegments)
  }

  // 3. render（Markdown 产物；HTML 功能已移除）
  scopedDeps.onProgress?.("render")
  const markdown = buildOutputMarkdown({
    mode,
    title: req.title,
    summary: summaryText,
    url: req.url,
    time: formatDateTime(now),
    transcriptSource: req.transcript.source as TranscriptSource,
    transcriptSegments: finalSegments
  })

  let finalMarkdown = markdown
  if (req.screenshot) {
    const markers = extractScreenshotMarkers(finalMarkdown)
    if (markers.length > 0) {
      const videoPath = await downloadVideoWithYtdlp(scopedDeps, req.url, req.cookie, `${runDir}/resources`)
      const screenshotDir = `${runDir}/images`
      await scopedDeps.ensureDir(screenshotDir)
      for (const [index, [marker, timestamp]] of markers.entries()) {
        const imagePath = await generateScreenshot(scopedDeps, videoPath, screenshotDir, timestamp, index)
        const filename = imagePath.split("/").pop() ?? ""
        // 相对路径引用（产物目录可整体移动/分享）
        finalMarkdown = finalMarkdown.replace(marker, `![](images/${filename})`)
      }
    }
  }

  // 产物落盘（按模式独立文件）
  await scopedDeps.writeFile(`${runDir}/${mode}.md`, finalMarkdown)

  scopedDeps.onProgress?.("done")

  return {
    run_id: runId,
    title: req.title,
    summary: summaryText,
    markdown: finalMarkdown,
    transcript: req.transcript.text,
    transcript_segments: finalSegments,
    transcript_source: req.transcript.source as TranscriptSource
  }
}
