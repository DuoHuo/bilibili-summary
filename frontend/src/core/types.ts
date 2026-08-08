import type { PromptMode } from "@/lib/prompts"

/** 平台类型 */
export type Platform = "bilibili" | "youtube"

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export type TranscriptSource = "subtitle" | "whisper" | null

export interface Transcript {
  text: string
  segments: TranscriptSegment[]
  source: Exclude<TranscriptSource, null>
}

/** 与旧 web 版 `/api/summarize` 请求体对齐的输入 */
export interface SummarizeRequest {
  url: string
  api_key: string
  model: string | null
  base_url: string | null
  prompt: string | null
  cookie: string | null
  stt_language: "zh-cn" | "en"
  screenshot: boolean
  mode: PromptMode
  /** 会话层预生成的 run_id；缺省时由 runSummarize 内部生成 */
  run_id?: string
}

/** 摘要流水线最终产物（对齐旧 web 版响应体） */
export interface SummarizeOutput {
  run_id: string
  title: string
  summary: string
  markdown: string
  html: string
  transcript: string
  transcript_segments: TranscriptSegment[]
  transcript_source: TranscriptSource
}

/** 流水线阶段，用于进度上报 */
export type Stage =
  | "detect"
  | "fetch_subtitle"
  | "whisper"
  | "build_prompt"
  | "llm"
  | "render"
  | "done"

/* ---------------- 依赖注入契约（让核心层可单测 / 可复用于 web 模式） ---------------- */

export interface HttpResponse {
  status: number
  ok: boolean
  text(): Promise<string>
  json<T>(): Promise<T>
}

export interface HttpFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

export type HttpFetch = (url: string, init?: HttpFetchInit) => Promise<HttpResponse>

export interface ExternalRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type ExternalRunner = (
  program: string,
  args: string[],
  options?: {
    cwd?: string
    env?: Record<string, string>
    onLine?: (line: string) => void
    /** 进度事件阶段名（用于路由 summary://progress） */
    stage?: string
    /** 任务标识（run_id）：透传给 run_external，供 kill/进度路由 */
    id?: string
  }
) => Promise<ExternalRunResult>

export interface SummarizeDeps {
  http: HttpFetch
  runner: ExternalRunner
  onProgress?: (stage: Stage, detail?: string) => void
  resolveModelPath: () => Promise<string>
  resolveOutputDir: (runId: string) => Promise<string>
  /** 音频缓存目录（whisper 兜底下载到此处并复用）；缺省时退化为 resourcesDir */
  resolveCacheDir?: () => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  readFile: (path: string) => Promise<string>
  isFile: (path: string) => Promise<boolean>
  /** 测试注入用；默认 new Date() */
  now?: () => Date
}
