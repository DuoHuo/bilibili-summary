import type { PromptMode } from "./prompts"

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export type TranscriptSource =
  | "subtitle"
  | "whisper"
  | null

export interface SummarizeResult {
  run_id?: string
  title: string
  summary: string
  markdown: string
  html: string
  transcript?: string | null
  transcript_segments?: TranscriptSegment[] | null
  transcript_source?: TranscriptSource
}

/**
 * Runtime guard for the `/api/summarize` response. Replaces an unchecked
 * `as SummarizeResult` cast at the network boundary so malformed payloads
 * surface as a typed error instead of silent field reads.
 */
export function isSummarizeResult(
  value: unknown
): value is SummarizeResult {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.markdown === "string" &&
    typeof record.html === "string"
  )
}

export interface UserConfig {
  apiKey: string
  model: string
  baseUrl: string
  prompt: string
  /** Built-in modes ("summary"/"fulltext"/"timestamp") use templates; "custom" uses `prompt`. */
  promptMode: PromptMode
  cookie: string
  sttLanguage: "zh-cn" | "en"
  screenshot: boolean
  /** B 站扫码登录的用户信息；null = 未登录。可选字段兼容旧配置。 */
  biliProfile: BiliProfile | null
}

/** B 站登录用户信息（来自 nav 接口） */
export interface BiliProfile {
  uid: number
  name: string
  face: string
}

const PROMPT_MODES: readonly PromptMode[] = ["summary", "fulltext", "timestamp", "custom"]

/** Allows missing `promptMode` so pre-migration configs still load. */
function isValidPromptMode(value: unknown): value is PromptMode | undefined {
  return value === undefined || (typeof value === "string" && (PROMPT_MODES as readonly string[]).includes(value))
}

/** Allows missing `biliProfile` (null = logged out, undefined = pre-login configs). */
function isValidBiliProfile(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.uid === "number" &&
    typeof record.name === "string" &&
    typeof record.face === "string"
  )
}

/**
 * Runtime guard for IndexedDB-persisted config. `promptMode` may be absent in
 * records written before the mode selector existed; callers merge with
 * `DEFAULT_CONFIG` to fill the gap.
 */
export function isUserConfig(value: unknown): value is UserConfig {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.apiKey === "string" &&
    typeof record.model === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.prompt === "string" &&
    typeof record.cookie === "string" &&
    (record.sttLanguage === "zh-cn" || record.sttLanguage === "en") &&
    typeof record.screenshot === "boolean" &&
    isValidPromptMode(record.promptMode) &&
    isValidBiliProfile(record.biliProfile)
  )
}
