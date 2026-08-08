import { describe, expect, it } from "vitest"
import { detectPlatform } from "./detect"

describe("detectPlatform", () => {
  it("识别 B 站", () => {
    expect(detectPlatform("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("bilibili")
  })

  it("识别 YouTube（youtube.com）", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube")
  })

  it("识别 YouTube（youtu.be）", () => {
    expect(detectPlatform("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube")
  })

  it("不支持平台抛错", () => {
    expect(() => detectPlatform("https://vimeo.com/123")).toThrow("暂不支持该链接")
  })
})
