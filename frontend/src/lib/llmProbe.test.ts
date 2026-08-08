import { describe, expect, it } from "vitest"

import type { HttpFetch, HttpResponse } from "@/core/types"
import { testLlmConnection } from "./llmProbe"

function jsonResp(body: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async <T>() => body as T
  }
}

describe("testLlmConnection", () => {
  it("API Key 为空时直接返回失败", async () => {
    const http: HttpFetch = async () => jsonResp({})
    const result = await testLlmConnection(http, "", "gpt-4o-mini", "")
    expect(result.ok).toBe(false)
    expect(result.message).toContain("API Key")
  })

  it("请求成功返回连接成功（含模型名）", async () => {
    let seenUrl = ""
    const http: HttpFetch = async (url, init) => {
      seenUrl = url
      expect(init?.headers?.Authorization).toBe("Bearer sk-test")
      return jsonResp({ choices: [] })
    }
    const result = await testLlmConnection(http, "sk-test", "gpt-4o-mini", "https://api.example.com/v1")
    expect(result.ok).toBe(true)
    expect(result.message).toContain("gpt-4o-mini")
    expect(seenUrl).toBe("https://api.example.com/v1/chat/completions")
  })

  it("baseUrl 为空时回退 OpenAI 默认端点", async () => {
    let seenUrl = ""
    const http: HttpFetch = async (url) => {
      seenUrl = url
      return jsonResp({ choices: [] })
    }
    await testLlmConnection(http, "sk-test", "", "")
    expect(seenUrl).toBe("https://api.openai.com/v1/chat/completions")
  })

  it("HTTP 4xx 时返回失败并附带错误详情", async () => {
    const http: HttpFetch = async () => jsonResp({ error: { message: "Invalid API key" } }, 401)
    const result = await testLlmConnection(http, "sk-bad", "gpt-4o-mini", "")
    expect(result.ok).toBe(false)
    expect(result.message).toContain("HTTP 401")
    expect(result.message).toContain("Invalid API key")
  })

  it("网络异常返回失败", async () => {
    const http: HttpFetch = async () => {
      throw new Error("network down")
    }
    const result = await testLlmConnection(http, "sk-test", "gpt-4o-mini", "")
    expect(result.ok).toBe(false)
    expect(result.message).toBe("连接失败：network down")
  })

  it("非 Error 错误（字符串/对象）也完整序列化", async () => {
    const stringHttp: HttpFetch = async () => {
      throw "scope denied: https://api.example.com"
    }
    const strResult = await testLlmConnection(stringHttp, "sk-test", "gpt-4o-mini", "")
    expect(strResult.message).toContain("scope denied")

    const objHttp: HttpFetch = async () => {
      throw { kind: "timeout", url: "https://api.example.com" }
    }
    const objResult = await testLlmConnection(objHttp, "sk-test", "gpt-4o-mini", "")
    expect(objResult.message).toContain("timeout")
  })
})
