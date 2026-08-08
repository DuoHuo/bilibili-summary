import type { HttpFetch } from "@/core/types"
import { resolveEndpoint } from "@/core/llm/client"

export interface ProbeResult {
  ok: boolean
  message: string
}

interface ProbeErrorBody {
  error?: { message?: string }
}

/**
 * 测试 LLM 连接：发最小 chat 请求（max_tokens=1）验证 baseUrl + API Key + 模型全链路。
 * 复用 core/llm 的端点解析；不抛异常，任何失败转为可读结果。
 */
export async function testLlmConnection(
  http: HttpFetch,
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<ProbeResult> {
  const key = apiKey.trim()
  if (!key) return { ok: false, message: "请先填写 API Key" }

  let endpoint: string
  let modelName: string
  try {
    const resolved = resolveEndpoint(baseUrl)
    endpoint = resolved.endpoint
    modelName = model.trim() || resolved.defaultModel
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "端点配置无效" }
  }

  try {
    const resp = await http(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: { model: modelName, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }
    })
    const text = await resp.text()
    if (!resp.ok) {
      let detail = ""
      try {
        const body = JSON.parse(text) as ProbeErrorBody
        detail = body.error?.message ?? ""
      } catch {
        // 非 JSON 响应体，回退原文
      }
      if (!detail) detail = text.slice(0, 200)
      console.error("[llm-probe] 连接失败", { endpoint, status: resp.status, body: text.slice(0, 500) })
      return { ok: false, message: `连接失败（HTTP ${resp.status}）${detail ? `：${detail}` : ""}` }
    }
    console.log("[llm-probe] 连接成功", { endpoint, model: modelName })
    return { ok: true, message: `连接成功（${modelName}）` }
  } catch (err) {
    // Tauri invoke 拒绝时 err 可能是字符串/对象而非 Error，完整序列化避免吞掉真实原因
    const detail =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : JSON.stringify(err) ?? "未知错误"
    console.error("[llm-probe] 网络异常", { endpoint }, err)
    return { ok: false, message: `连接失败：${detail || "未知错误"}` }
  }
}
