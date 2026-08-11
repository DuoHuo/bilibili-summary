import { generateMode, prepareTranscript } from "@/core/workflow"
import type { GenerateRequest, PrepareRequest, SummarizeOutput } from "@/core/types"
import type { PromptMode } from "./prompts"
import { AppError } from "@/core/errors"
import { createFileLogger, loggerRef } from "./logger"
import {
  ensureWhisperModel,
  ensureDir,
  pathIsFile,
  readTextFile,
  resolveOutputDir,
  resolveFfmpegPath,
  tauriHttpFetch,
  tauriRunner,
  writeTextFile
} from "./tauri"

export interface PreparePayload {
  url: string
  cookie: string | null
  stt_language: "zh-cn" | "en"
  run_id?: string
  source?: "subtitle" | "audio"
  /** Whisper 模型（ggml-*.bin） */
  stt_model?: string
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
  /** 原始 AppError（若有）：透传 code/traceId/diagnosticId/context，供调用方落盘诊断日志 */
  readonly appError?: AppError
  constructor(message: string, responseText: string, appError?: AppError) {
    super(message)
    this.name = "SummarizeError"
    this.responseText = responseText
    this.appError = appError
  }
}

const tauriDeps = {
  http: tauriHttpFetch,
  runner: tauriRunner,
  resolveModelPath: ensureWhisperModel,
  resolveFfmpegPath,
  resolveOutputDir,
  ensureDir,
  writeFile: writeTextFile,
  readFile: readTextFile,
  isFile: pathIsFile
}

// 启动期异步解析日志目录 + 接文件 sink；解析完成前 loggerRef 为 noop 兜底，不阻塞主流程
void createFileLogger().catch(() => {})

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
        run_id: payload.run_id,
        source: payload.source
      } satisfies PrepareRequest,
      {
        ...tauriDeps,
        resolveModelPath: () => ensureWhisperModel(payload.stt_model),
        logger: loggerRef,
        onProgress
      }
    )
  } catch (err) {
    const appErr = err instanceof AppError ? err : undefined
    throw new SummarizeError(err instanceof Error ? err.message : String(err), "", appErr)
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
      { ...tauriDeps, logger: loggerRef, onProgress }
    )
  } catch (err) {
    const appErr = err instanceof AppError ? err : undefined
    throw new SummarizeError(err instanceof Error ? err.message : String(err), "", appErr)
  }
}
