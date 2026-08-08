import type { HttpFetch } from "../types"

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string | null } | null
  }> | null
}

/**
 * 解析 LLM 端点：base_url 有值 → `{base}/chat/completions`，否则 OpenAI 默认。
 * 移植自 backend/src/services.rs::resolve_endpoint。
 */
export function resolveEndpoint(baseUrl: string | null): { endpoint: string; defaultModel: string } {
  if (baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "")
    if (trimmed === "") throw new Error("自定义端点不能为空")
    return { endpoint: `${trimmed}/chat/completions`, defaultModel: "gpt-4o-mini" }
  }
  return { endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini" }
}

/**
 * 调用 OpenAI 兼容接口生成摘要。
 * 移植自 backend/src/services.rs::call_llm。
 */
export async function callLlm(
  http: HttpFetch,
  apiKey: string,
  model: string | null,
  baseUrl: string | null,
  prompt: string,
  maxTokens?: number
): Promise<string> {
  const { endpoint, defaultModel } = resolveEndpoint(baseUrl)
  const body: Record<string, unknown> = {
    model: model ?? defaultModel,
    messages: [
      { role: "system", content: "你是专业视频内容总结助手" },
      { role: "user", content: prompt }
    ]
  }
  if (maxTokens !== undefined) body.max_tokens = maxTokens

  const resp = await http(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body
  })

  const text = await resp.text()
  if (!resp.ok) throw new Error("模型调用失败")

  let data: OpenAIResponse
  try {
    data = JSON.parse(text) as OpenAIResponse
  } catch {
    throw new Error("解析模型响应失败")
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  return content ?? "模型未返回内容"
}
