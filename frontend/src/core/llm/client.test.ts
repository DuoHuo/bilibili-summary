import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { HttpFetch, HttpResponse } from "../types"
import { callLlm, resolveEndpoint } from "./client"

function jsonResponse(payload: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
    json: async <T>() => payload as T
  }
}

describe("resolveEndpoint", () => {
  it("无 base_url → OpenAI 默认", () => {
    expect(resolveEndpoint(null)).toEqual({
      endpoint: "https://api.openai.com/v1/chat/completions",
      defaultModel: "gpt-4o-mini"
    })
  })

  it("base_url 去尾斜杠并拼接 /chat/completions", () => {
    expect(resolveEndpoint("https://api.deepseek.com/v1/")).toEqual({
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      defaultModel: "gpt-4o-mini"
    })
  })

  it("空 base_url 抛错", () => {
    expect(() => resolveEndpoint("   ")).toThrow("自定义端点不能为空")
  })
})

describe("callLlm", () => {
  it("解析 choices[0].message.content", async () => {
    const payload = JSON.parse(
      readFileSync(new URL("../__fixtures__/llm-response.json", import.meta.url), "utf-8")
    )
    let sentBody: unknown
    let authHeader: string | undefined
    const http: HttpFetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions")
      sentBody = init?.body
      authHeader = init?.headers?.Authorization
      return jsonResponse(payload)
    }
    const content = await callLlm(http, "sk-test", null, null, "prompt")
    expect(content).toContain("## 核心论点")
    expect(authHeader).toBe("Bearer sk-test")
    expect((sentBody as { model: string }).model).toBe("gpt-4o-mini")
    expect((sentBody as { messages: unknown[] }).messages).toHaveLength(2)
  })

  it("模型返回错误抛错", async () => {
    const http: HttpFetch = async () => jsonResponse({ error: "bad" }, 500)
    await expect(callLlm(http, "sk-test", null, null, "p")).rejects.toThrow("模型调用失败")
  })

  it("空白 content 返回空串（对齐 Rust trim 行为）", async () => {
    const http: HttpFetch = async () => jsonResponse({ choices: [{ message: { content: "  " } }] })
    expect(await callLlm(http, "sk-test", null, null, "p")).toBe("")
  })

  it("choices 为空回退提示", async () => {
    const http: HttpFetch = async () => jsonResponse({ choices: [] })
    expect(await callLlm(http, "sk-test", null, null, "p")).toBe("模型未返回内容")
  })
})
