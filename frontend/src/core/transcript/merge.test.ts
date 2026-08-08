import { describe, expect, it } from "vitest"
import { mergeTranscriptSegments } from "./merge"
import type { TranscriptSegment } from "../types"

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text }
}

describe("mergeTranscriptSegments（对齐 Rust 现有测试）", () => {
  it("空数组返回空", () => {
    expect(mergeTranscriptSegments([], 15.0)).toEqual([])
  })

  it("单个短段原样保留", () => {
    expect(mergeTranscriptSegments([seg(0.0, 5.0, "hello")], 15.0)).toEqual([seg(0.0, 5.0, "hello")])
  })

  it("单个超阈值段原样保留", () => {
    expect(mergeTranscriptSegments([seg(0.0, 20.0, "long")], 15.0)).toEqual([seg(0.0, 20.0, "long")])
  })

  it("合并直到阈值", () => {
    const result = mergeTranscriptSegments(
      [seg(0.0, 5.0, "a"), seg(5.0, 10.0, "b"), seg(10.0, 16.0, "c")],
      15.0
    )
    expect(result).toEqual([seg(0.0, 10.0, "a b"), seg(10.0, 16.0, "c")])
  })

  it("最后一段可为短段", () => {
    const result = mergeTranscriptSegments([seg(0.0, 5.0, "a"), seg(5.0, 20.0, "b")], 15.0)
    expect(result).toEqual([seg(0.0, 5.0, "a"), seg(5.0, 20.0, "b")])
  })
})
