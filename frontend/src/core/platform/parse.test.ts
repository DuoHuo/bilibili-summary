import { describe, expect, it } from "vitest"
import { parseBilibiliId, parseYoutubeId } from "./parse"

describe("parseBilibiliId", () => {
  it("提取标准 BV 段", () => {
    expect(parseBilibiliId("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("BV1xx411c7mD")
  })

  it("路径中包含 BV 段", () => {
    expect(parseBilibiliId("https://bilibili.com/video/BV1xx411c7mD?p=2&t=10")).toBe("BV1xx411c7mD")
  })

  it("无 BV 段返回 null", () => {
    expect(parseBilibiliId("https://www.bilibili.com/video/av12345")).toBeNull()
  })

  it("非法 URL 返回 null", () => {
    expect(parseBilibiliId("not a url")).toBeNull()
  })
})

describe("parseYoutubeId", () => {
  it("提取 watch?v= 形式", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
  })

  it("提取 shorts 形式", () => {
    expect(parseYoutubeId("https://www.youtube.com/shorts/abcdef12345")).toBe("abcdef12345")
  })

  it("提取 youtu.be 短链", () => {
    expect(parseYoutubeId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ")
  })

  it("不匹配返回 null", () => {
    expect(parseYoutubeId("https://www.youtube.com/feed/subscriptions")).toBeNull()
  })
})
