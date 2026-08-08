import { describe, expect, it } from "vitest"

import type { HttpFetch, HttpResponse } from "@/core/types"
import { fetchNavInfo } from "./biliAuth"

function jsonResp(body: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async <T>() => body as T
  }
}

function navBody(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    message: "0",
    data: {
      isLogin: true,
      uname: "测试用户",
      face: "https://i0.hdslb.com/face.png",
      mid: 123456,
      ...overrides
    }
  }
}

describe("fetchNavInfo 会话状态机", () => {
  it("code=-101 判定过期（expired）", async () => {
    const http: HttpFetch = async () => jsonResp({ code: -101, message: "账号未登录", data: null })
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("expired")
    expect(state.profile).toBeNull()
  })

  it("code=0 且 isLogin=true 返回 active + profile", async () => {
    const http: HttpFetch = async () => jsonResp(navBody())
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("active")
    expect(state.profile).toEqual({ uid: 123456, name: "测试用户", face: "https://i0.hdslb.com/face.png" })
  })

  it("code=-352 风控等非 -101 业务码判定服务异常（不清 cookie）", async () => {
    const http: HttpFetch = async () => jsonResp({ code: -352, message: "风控校验失败", data: null })
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("serviceError")
  })

  it("HTTP 非 2xx 判定服务异常", async () => {
    const http: HttpFetch = async () => jsonResp({ code: 0 }, 500)
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("serviceError")
  })

  it("网络异常判定服务异常", async () => {
    const http: HttpFetch = async () => {
      throw new Error("network down")
    }
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("serviceError")
  })

  it("code=0 但 isLogin=false 判定过期", async () => {
    const http: HttpFetch = async () => jsonResp(navBody({ isLogin: false }))
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("expired")
  })

  it("响应体解析失败判定服务异常", async () => {
    const http: HttpFetch = async () =>
      ({
        status: 200,
        ok: true,
        text: async () => "not-json",
        json: async () => {
          throw new Error("parse failed")
        }
      }) as HttpResponse
    const state = await fetchNavInfo(http, "SESSDATA=x")
    expect(state.status).toBe("serviceError")
  })

  it("cookie 非空时请求携带 Cookie 头，为空时不携带", async () => {
    const seen: Array<Record<string, string> | undefined> = []
    const http: HttpFetch = async (_url, init) => {
      seen.push(init?.headers)
      return jsonResp(navBody())
    }
    await fetchNavInfo(http, "SESSDATA=abc")
    await fetchNavInfo(http, "")
    expect(seen[0]?.Cookie).toBe("SESSDATA=abc")
    expect(seen[1]?.Cookie).toBeUndefined()
  })
})
