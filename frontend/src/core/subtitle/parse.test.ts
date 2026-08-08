import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseYoutubeSubtitlesXml } from "./parse"

describe("parseYoutubeSubtitlesXml", () => {
  it("解析 srv3 格式片段", () => {
    const xml = `<transcript>
  <p t="0" d="3200">Hello everyone, welcome back.</p>
  <p t="3200" d="3300">Today we talk about TypeScript and Tauri.</p>
</transcript>`
    expect(parseYoutubeSubtitlesXml(xml)).toEqual([
      { start: 0, end: 3.2, text: "Hello everyone, welcome back." },
      { start: 3.2, end: 6.5, text: "Today we talk about TypeScript and Tauri." }
    ])
  })

  it("空文本 / 零时长片段被过滤或归零", () => {
    const xml = `<transcript>
  <p t="0" d="3200">Hello</p>
  <p t="6500" d="0"> </p>
</transcript>`
    expect(parseYoutubeSubtitlesXml(xml)).toEqual([{ start: 0, end: 3.2, text: "Hello" }])
  })

  it("文本内换行折叠为空格", () => {
    const xml = `<transcript><p t="0" d="1000">line1
line2</p></transcript>`
    expect(parseYoutubeSubtitlesXml(xml)).toEqual([{ start: 0, end: 1, text: "line1 line2" }])
  })

  it("对照 fixture 文件", () => {
    const xml = readFileSync(new URL("../__fixtures__/youtube-timedtext.xml", import.meta.url), "utf-8")
    const segments = parseYoutubeSubtitlesXml(xml)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ start: 0, end: 3.2, text: "Hello everyone, welcome back." })
    expect(segments[1]).toEqual({ start: 3.2, end: 6.5, text: "Today we talk about TypeScript and Tauri." })
  })
})
