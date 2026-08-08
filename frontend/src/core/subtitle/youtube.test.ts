import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { HttpFetch, HttpResponse } from "../types"
import { fetchYoutubeSubtitles, fetchYoutubeTitle } from "./youtube"

function jsonResponse(payload: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
    json: async <T>() => payload as T
  }
}

function textResponse(text: string, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    json: async () => {
      throw new Error("not json")
    }
  }
}

describe("fetchYoutubeTitle", () => {
  it("从 oEmbed 提取标题", async () => {
    const oembed = JSON.parse(
      readFileSync(new URL("../__fixtures__/youtube-oembed.json", import.meta.url), "utf-8")
    )
    const http: HttpFetch = async (url) => {
      expect(url).toContain("/oembed?url=")
      return jsonResponse(oembed)
    }
    expect(await fetchYoutubeTitle(http, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "TypeScript & Tauri in 10 minutes"
    )
  })
})

describe("fetchYoutubeSubtitles", () => {
  it("语言优先级：zh-Hans 命中即返回", async () => {
    const xml = readFileSync(new URL("../__fixtures__/youtube-timedtext.xml", import.meta.url), "utf-8")
    const urls: string[] = []
    const http: HttpFetch = async (url) => {
      urls.push(url)
      return textResponse(xml)
    }
    const transcript = await fetchYoutubeSubtitles(http, "dQw4w9WgXcQ")
    expect(transcript).not.toBeNull()
    expect(transcript!.source).toBe("subtitle")
    expect(transcript!.segments[0]).toEqual({ start: 0, end: 3.2, text: "Hello everyone, welcome back." })
    expect(urls[0]).toContain("lang=zh-Hans")
  })

  it("语言缺失时依次尝试，最终返回 null", async () => {
    const http: HttpFetch = async () => textResponse("not found", 404)
    expect(await fetchYoutubeSubtitles(http, "dQw4w9WgXcQ")).toBeNull()
  })
})
