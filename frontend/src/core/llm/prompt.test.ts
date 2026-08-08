import { describe, expect, it } from "vitest"
import { buildPrompt } from "./prompt"

describe("buildPrompt", () => {
  it("自定义 prompt 替换 {{title}} / {{transcript}}", () => {
    const result = buildPrompt({
      title: "T",
      transcript: "S",
      customPrompt: "标题：{{title}}\n字幕：{{transcript}}",
      mode: "custom",
      screenshot: false
    })
    expect(result).toBe("标题：T\n字幕：S")
  })

  it("无自定义 prompt 时使用内置模板并替换 token", () => {
    const result = buildPrompt({
      title: "T",
      transcript: "S",
      customPrompt: null,
      mode: "summary",
      screenshot: false
    })
    expect(result).toContain("标题：T")
    expect(result).toContain("S")
    expect(result).not.toContain("{{title}}")
    expect(result).not.toContain("{{transcript}}")
  })

  it("screenshot 开启时追加占位提示", () => {
    const result = buildPrompt({
      title: "T",
      transcript: "S",
      customPrompt: "自定义",
      mode: "custom",
      screenshot: true
    })
    expect(result).toContain("Screenshot placeholders")
    expect(result).toContain("`*Screenshot-[mm:ss]`")
  })
})
