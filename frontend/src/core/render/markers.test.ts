import { describe, expect, it } from "vitest"
import { extractScreenshotMarkers } from "./markers"

describe("extractScreenshotMarkers", () => {
  it("提取星号形式 `*Screenshot-mm:ss`", () => {
    expect(extractScreenshotMarkers("看看这里 *Screenshot-01:23 的效果")).toEqual([
      ["*Screenshot-01:23", 83]
    ])
  })

  it("提取方括号形式 `Screenshot-[mm:ss]`", () => {
    expect(extractScreenshotMarkers("Screenshot-[12:34]")).toEqual([["Screenshot-[12:34]", 754]])
  })

  it("无标记返回空数组", () => {
    expect(extractScreenshotMarkers("普通文本")).toEqual([])
  })
})
