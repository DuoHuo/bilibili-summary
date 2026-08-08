import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { renderMarkdownHtml } from "./html"

const SAMPLE_MD =
  "## 摘要\n\n一句话高密度摘要。\n\n- 要点 A\n- 要点 B\n\n| 列1 | 列2 |\n|---|---|\n| 甲 | 乙 |\n\n~~删除线~~ 与 `inline code`\n\n```\n代码块\n```"

/**
 * 压缩标签间空白，用于对齐 pulldown-cmark 与 marked 的表格换行差异。
 * 见 core/render/README.md 白名单说明。
 */
function normalizeWhitespace(html: string): string {
  return html.replace(/>\s+</g, "><").trim()
}

describe("renderMarkdownHtml golden", () => {
  it("与 Rust 版（pulldown-cmark）输出一致（忽略标签间空白）", () => {
    const golden = readFileSync(new URL("../__fixtures__/golden-html.html", import.meta.url), "utf-8")
    const html = renderMarkdownHtml({
      title: "测试视频",
      markdown: SAMPLE_MD,
      subtitle: "东方简约信纸 · bilibili summary",
      stamp: "摘要"
    })
    expect(normalizeWhitespace(html)).toBe(normalizeWhitespace(golden))
  })
})
