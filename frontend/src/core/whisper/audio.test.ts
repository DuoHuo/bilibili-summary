import { describe, expect, it } from "vitest"
import { buildWhisperAudioName } from "./audio"

describe("buildWhisperAudioName", () => {
  it("B 站用 BV 号", () => {
    expect(buildWhisperAudioName("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("BV1xx411c7mD")
  })

  it("YouTube 加 youtube- 前缀", () => {
    expect(buildWhisperAudioName("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube-dQw4w9WgXcQ")
  })

  it("无法识别用时间戳", () => {
    const name = buildWhisperAudioName("https://example.com/video")
    expect(name).toMatch(/^audio-\d+$/)
  })
})
