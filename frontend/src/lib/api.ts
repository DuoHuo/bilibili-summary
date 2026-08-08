import { generateMode, prepareTranscript } from "@/core/workflow"
import type { GenerateRequest, PrepareRequest, SummarizeOutput } from "@/core/types"
import type { PromptMode } from "./prompts"
import {
  ensureWhisperModel,
  ensureDir,
  pathIsFile,
  readTextFile,
  resolveOutputDir,
  tauriHttpFetch,
  tauriRunner,
  writeTextFile
} from "./tauri"

export interface PreparePayload {
  url: string
  cookie: string | null
  stt_language: "zh-cn" | "en"
  run_id?: string
}

export interface GeneratePayload {
  run_id: string
  url: string
  cookie: string | null
  title: string
  transcript: import("@/core/types").Transcript
  mode: PromptMode
  custom_prompt: string | null
  api_key: string
  model: string | null
  base_url: string | null
  screenshot: boolean
}

export class SummarizeError extends Error {
  readonly responseText: string
  constructor(message: string, responseText: string) {
    super(message)
    this.name = "SummarizeError"
    this.responseText = responseText
  }
}

const tauriDeps = {
  http: tauriHttpFetch,
  runner: tauriRunner,
  resolveModelPath: ensureWhisperModel,
  resolveOutputDir,
  ensureDir,
  writeFile: writeTextFile,
  readFile: readTextFile,
  isFile: pathIsFile
}

/** 阶段一：字幕准备（一次性）。 */
export async function runPrepare(
  payload: PreparePayload,
  onProgress?: (stage: string, detail?: string) => void
): Promise<{ run_id: string; run_dir: string; title: string; transcript: import("@/core/types").Transcript }> {
  try {
    return await prepareTranscript(
      {
        url: payload.url,
        cookie: payload.cookie,
        stt_language: payload.stt_language,
        run_id: payload.run_id
      } satisfies PrepareRequest,
      { ...tauriDeps, onProgress }
    )
  } catch (err) {
    throw new SummarizeError(err instanceof Error ? err.message : String(err), "")
  }
}

/** 阶段二：按模式懒生成。 */
export async function runGenerate(
  payload: GeneratePayload,
  onProgress?: (stage: string, detail?: string) => void
): Promise<SummarizeOutput> {
  try {
    return await generateMode(
      {
        run_id: payload.run_id,
        url: payload.url,
        cookie: payload.cookie,
        title: payload.title,
        transcript: payload.transcript,
        mode: payload.mode,
        custom_prompt: payload.custom_prompt,
        api_key: payload.api_key,
        model: payload.model,
        base_url: payload.base_url,
        screenshot: payload.screenshot
      } satisfies GenerateRequest,
      { ...tauriDeps, onProgress }
    )
  } catch (err) {
    throw new SummarizeError(err instanceof Error ? err.message : String(err), "")
  }
}
