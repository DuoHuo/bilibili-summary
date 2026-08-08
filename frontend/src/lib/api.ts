import { runSummarize } from "@/core/workflow"
import type { SummarizeResult } from "./types"
import type { PromptMode } from "./prompts"
import {
  ensureWhisperModel,
  pathIsFile,
  readTextFile,
  resolveOutputDir,
  tauriHttpFetch,
  tauriRunner,
  writeTextFile
} from "./tauri"

export interface SummarizePayload {
  url: string
  api_key: string
  model: string | null
  base_url: string | null
  prompt: string | null
  cookie: string | null
  stt_language: "zh-cn" | "en"
  screenshot: boolean
  mode: PromptMode
}

export class SummarizeError extends Error {
  readonly responseText: string
  constructor(message: string, responseText: string) {
    super(message)
    this.name = "SummarizeError"
    this.responseText = responseText
  }
}

/**
 * 桌面版摘要入口：把 Tauri 系统能力注入 core 层工作流。
 * 替代旧 web 版的 HTTP 调用；`apiBase` 参数保留仅为兼容调用点，不再使用。
 */
export async function postSummarize(
  _apiBase: string,
  payload: SummarizePayload
): Promise<SummarizeResult> {
  try {
    const output = await runSummarize(
      {
        url: payload.url,
        api_key: payload.api_key,
        model: payload.model,
        base_url: payload.base_url,
        prompt: payload.prompt,
        cookie: payload.cookie,
        stt_language: payload.stt_language,
        screenshot: payload.screenshot,
        mode: payload.mode
      },
      {
        http: tauriHttpFetch,
        runner: tauriRunner,
        resolveModelPath: ensureWhisperModel,
        resolveOutputDir,
        writeFile: writeTextFile,
        readFile: readTextFile,
        isFile: pathIsFile
      }
    )

    return {
      run_id: output.run_id,
      title: output.title,
      summary: output.summary,
      markdown: output.markdown,
      html: output.html,
      transcript: output.transcript,
      transcript_segments: output.transcript_segments,
      transcript_source: output.transcript_source
    }
  } catch (err) {
    throw new SummarizeError(err instanceof Error ? err.message : String(err), "")
  }
}
