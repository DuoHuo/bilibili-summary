import { isSummarizeResult, type SummarizeResult } from "./types"
import type { PromptMode } from "./prompts"

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

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message
    if (typeof message === "string") return message
  }
  return fallback
}

export async function postSummarize(
  apiBase: string,
  payload: SummarizePayload
): Promise<SummarizeResult> {
  const response = await fetch(`${apiBase}/api/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })

  const rawText = await response.text()
  const parsed = rawText ? safeParseJson(rawText) : null

  if (!response.ok) {
    throw new SummarizeError(
      extractMessage(parsed, rawText || `请求失败（HTTP ${response.status}）`),
      rawText
    )
  }

  if (!isSummarizeResult(parsed)) {
    throw new SummarizeError("服务端响应格式异常", rawText)
  }

  return parsed
}
