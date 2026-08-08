import type { PromptMode } from "@/lib/prompts"
import type {
  Stage,
  SummarizeDeps,
  SummarizeOutput,
  SummarizeRequest,
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
import { buildOutputMarkdown, stripMarkdownTitle } from "../render/markdown"
import { extractScreenshotMarkers } from "../render/markers"
import { generateScreenshot } from "../render/screenshots"
import { renderMarkdownHtml } from "../render/html"

export type { PromptMode, Stage, SummarizeDeps, SummarizeOutput, SummarizeRequest }

/** run_id：UUID v4（对齐 backend 的 Uuid::new_v4） */
function generateRunId(): string {
  return crypto.randomUUID()
}

/** `YYYY-MM-DD HH:mm:ss`，对齐 chrono Local::now().format */
function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

interface HtmlLabels {
  subtitle: string
  stamp: string
}

/** 双语拼接：`cn / en`，单边或空处理。移植自 format_bilingual。 */
function formatBilingual(cn: string, en: string): string {
  const c = cn.trim()
  const e = en.trim()
  if (c === "" && e === "") return ""
  if (e === "") return c
  if (c === "") return e
  return `${c} / ${e}`
}

/** 二次 LLM 调用生成 HTML 副标题/印章，失败时降级为默认。移植自 generate_html_labels。 */
async function generateHtmlLabels(
  deps: Pick<SummarizeDeps, "http">,
  apiKey: string,
  model: string | null,
  baseUrl: string | null,
  title: string,
  summary: string
): Promise<HtmlLabels> {
  const prompt =
    `你是资深内容编辑，请基于视频标题与摘要生成一组用于网页的短文本。\n\n标题：${title}\n摘要：${summary}\n\n` +
    `请输出严格 JSON 格式，字段如下：\n{\n  "subtitle_cn": "20字以内中文副标题",\n  "subtitle_en": "12词以内英文副标题",\n  "stamp_cn": "4字以内中文印章",\n  "stamp_en": "2-4词英文印章"\n}\n\n` +
    `要求：\n- 与视频内容强相关\n- 文案要精炼、有记忆点\n- 仅输出 JSON，不要添加其它文字\n`
  const response = await callLlm(deps.http, apiKey, model, baseUrl, prompt)

  let parsed: {
    subtitle_cn?: string
    subtitle_en?: string
    stamp_cn?: string
    stamp_en?: string
  }
  try {
    parsed = JSON.parse(response) as typeof parsed
  } catch {
    throw new Error("解析 HTML 文案失败")
  }
  return {
    subtitle: formatBilingual(parsed.subtitle_cn ?? "", parsed.subtitle_en ?? ""),
    stamp: formatBilingual(parsed.stamp_cn ?? "", parsed.stamp_en ?? "")
  }
}

/** timestamp 模式展示摘要：`[mm:ss-mm:ss] 文本` 块。移植自 CallLlmNode。 */
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
 * 摘要流水线编排（替代 Rust PocketFlow 6 节点）。
 * detect → fetch_subtitle → [whisper] → build_prompt → llm → render。
 */
export async function runSummarize(
  input: SummarizeRequest,
  deps: SummarizeDeps
): Promise<SummarizeOutput> {
  const now = deps.now?.() ?? new Date()
  // 会话层可预生成 run_id（用于产物目录 + 进度路由）；缺省时内部生成。
  const runId = input.run_id ?? generateRunId()
  const runDir = await deps.resolveOutputDir(runId)
  // 包装依赖：所有外部进程调用携带本任务 run_id（供 kill 与进度事件路由）。
  const scopedDeps: SummarizeDeps = {
    ...deps,
    runner: (program, args, options) =>
      deps.runner(program, args, { ...options, id: runId })
  }
  const mode = input.mode

  // 1. detect_platform
  scopedDeps.onProgress?.("detect")
  const platform = detectPlatform(input.url)

  // 2. fetch_subtitle
  scopedDeps.onProgress?.("fetch_subtitle")
  let title: string
  let transcript: Transcript | null
  if (platform === "bilibili") {
    const bvid = parseBilibiliId(input.url)
    if (!bvid) throw new Error("无效的 B 站链接")
    const meta = await fetchBilibiliMeta(scopedDeps.http, bvid)
    title = meta.title
    transcript = await fetchBilibiliSubtitles(scopedDeps.http, bvid, meta.cid, input.cookie)
  } else {
    const videoId = parseYoutubeId(input.url)
    if (!videoId) throw new Error("无效的 YouTube 链接")
    title = await fetchYoutubeTitle(scopedDeps.http, input.url)
    transcript = await fetchYoutubeSubtitles(scopedDeps.http, videoId)
  }

  // 3. whisper_transcribe（字幕缺失时兜底）
  if (!transcript) {
    scopedDeps.onProgress?.("whisper")
    // 音频作为产物直接落盘到 run 目录（与摘要文件并列）
    const audioDir = runDir
    transcript = await transcribeWithWhisper(
      scopedDeps,
      input.url,
      input.cookie,
      input.stt_language,
      audioDir
    )
  }

  // 4. build_prompt
  scopedDeps.onProgress?.("build_prompt")
  const transcriptText =
    mode === "timestamp"
      ? transcript.segments.map((s) => s.text).join("\n")
      : formatTranscriptWithTimestamps(transcript.segments)
  const prompt = buildPrompt({
    title,
    transcript: transcriptText,
    customPrompt: input.prompt,
    mode,
    screenshot: input.screenshot
  })

  // 5. call_llm
  scopedDeps.onProgress?.("llm")
  const rawSummary = await callLlm(scopedDeps.http, input.api_key, input.model, input.base_url, prompt)

  let finalSegments: TranscriptSegment[] = transcript.segments
  let summaryText = rawSummary
  if (mode === "timestamp") {
    // LLM 按行 1:1 修正字幕 → 与原 segment 时间戳对齐 → 15s 合并
    const correctedLines = rawSummary
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
    const correctedSegments = transcript.segments.map((seg, index) => ({
      start: seg.start,
      end: seg.end,
      text: correctedLines[index] ?? seg.text
    }))
    finalSegments = mergeTranscriptSegments(correctedSegments, TIMESTAMP_MERGE_THRESHOLD_SECS)
    summaryText = formatTimestampSummary(finalSegments)
  }

  // 二次 LLM 生成 HTML 文案（失败降级默认值）
  let htmlSubtitle: string | null = null
  let htmlStamp: string | null = null
  try {
    const labels = await generateHtmlLabels(scopedDeps, input.api_key, input.model, input.base_url, title, rawSummary)
    if (labels.subtitle.trim() !== "") htmlSubtitle = labels.subtitle
    if (labels.stamp.trim() !== "") htmlStamp = labels.stamp
  } catch {
    // 降级：使用模板默认值
  }

  // 6. render
  scopedDeps.onProgress?.("render")
  let markdown = buildOutputMarkdown({
    mode,
    title,
    summary: summaryText,
    url: input.url,
    time: formatDateTime(now),
    transcriptSource: transcript.source as TranscriptSource,
    transcriptSegments: finalSegments
  })

  if (input.screenshot) {
    const markers = extractScreenshotMarkers(markdown)
    if (markers.length > 0) {
      const videoPath = await downloadVideoWithYtdlp(scopedDeps, input.url, input.cookie, `${runDir}/resources`)
      const screenshotDir = `${runDir}/images`
      await scopedDeps.ensureDir(screenshotDir)
      for (const [index, [marker, timestamp]] of markers.entries()) {
        const imagePath = await generateScreenshot(scopedDeps, videoPath, screenshotDir, timestamp, index)
        const filename = imagePath.split("/").pop() ?? ""
        // 相对路径引用（产物目录可整体移动/分享）
        markdown = markdown.replace(marker, `![](images/${filename})`)
      }
    }
  }

  const strippedMarkdown = stripMarkdownTitle(markdown)
  const html = renderMarkdownHtml({
    title,
    markdown: strippedMarkdown,
    subtitle: htmlSubtitle,
    stamp: htmlStamp
  })

  // 产物落盘
  await scopedDeps.writeFile(`${runDir}/summary_${runId}.md`, markdown)
  await scopedDeps.writeFile(`${runDir}/summary_${runId}.html`, html)
  await scopedDeps.writeFile(`${runDir}/transcript_${runId}.txt`, transcript.text)

  scopedDeps.onProgress?.("done")

  return {
    run_id: runId,
    title,
    summary: summaryText,
    markdown,
    html,
    transcript: transcript.text,
    transcript_segments: finalSegments,
    transcript_source: transcript.source as TranscriptSource
  }
}
