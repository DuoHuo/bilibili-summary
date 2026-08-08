import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { HttpFetch, HttpResponse } from "../types"
import { fetchBilibiliMeta, fetchBilibiliSubtitles } from "./bilibili"

function jsonResponse(payload: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
    json: async <T>() => payload as T
  }
}

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf-8")
  )
}

describe("fetchBilibiliMeta", () => {
  it("从 view API 提取标题与 cid", async () => {
    const calls: string[] = []
    const http: HttpFetch = async (url) => {
      calls.push(url)
      return jsonResponse(fixture("bilibili-view.json"))
    }
    const result = await fetchBilibiliMeta(http, "BV1xx411c7mD")
    expect(result).toEqual({ title: "【示例】B站视频标题：TypeScript 与 Tauri 入门", cid: 188272307 })
    expect(calls[0]).toContain("/x/web-interface/view?bvid=BV1xx411c7mD")
  })

  it("响应非成功抛错", async () => {
    const http: HttpFetch = async () => jsonResponse({}, 500)
    await expect(fetchBilibiliMeta(http, "BV1xx411c7mD")).rejects.toThrow("获取视频信息失败")
  })
})

describe("fetchBilibiliSubtitles", () => {
  it("从字幕索引 + 内容提取 segments（过滤空文本、按 start 排序）", async () => {
    const calls: string[] = []
    const http: HttpFetch = async (url, init) => {
      calls.push(url)
      if (url.includes("/x/player/v2")) return jsonResponse(fixture("bilibili-subtitle-index.json"))
      return jsonResponse(fixture("bilibili-subtitle-body.json"))
    }
    const transcript = await fetchBilibiliSubtitles(http, "BV1xx411c7mD", 188272307, null)
    expect(transcript).not.toBeNull()
    expect(transcript!.source).toBe("subtitle")
    expect(transcript!.segments).toEqual([
      { start: 0.5, end: 3.2, text: "大家好，欢迎收看本期视频。" },
      { start: 3.5, end: 6.8, text: "今天我们来聊聊 TypeScript 与 Tauri。" }
    ])
  })

  it("无字幕候选返回 null", async () => {
    const http: HttpFetch = async () =>
      jsonResponse({ code: 0, data: { subtitle: { subtitles: [], ai_subtitle: null } } })
    expect(await fetchBilibiliSubtitles(http, "BV1xx411c7mD", 1, null)).toBeNull()
  })

  it("cookie 透传到字幕索引请求", async () => {
    let headers: Record<string, string> | undefined
    const http: HttpFetch = async (url, init) => {
      if (url.includes("/x/player/v2")) headers = init?.headers
      return jsonResponse({ code: 0, data: { subtitle: null } })
    }
    await fetchBilibiliSubtitles(http, "BV1xx411c7mD", 1, "SESSDATA=abc")
    expect(headers?.Cookie).toBe("SESSDATA=abc")
  })
})
