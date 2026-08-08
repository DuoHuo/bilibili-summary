import { describe, expect, it } from "vitest"
import { buildNetscapeCookieContent, extractCookieDomain } from "./cookies"

describe("extractCookieDomain", () => {
  it("取注册域名", () => {
    expect(extractCookieDomain("https://www.bilibili.com/video/BV1")).toBe("bilibili.com")
    expect(extractCookieDomain("https://youtu.be/abc")).toBe("youtu.be")
  })
})

describe("buildNetscapeCookieContent", () => {
  it("生成 Netscape 格式", () => {
    const content = buildNetscapeCookieContent(
      "https://www.bilibili.com/video/BV1",
      "SESSDATA=abc; bili_jct=xyz"
    )
    expect(content).toBe(
      "# Netscape HTTP Cookie File\n" +
        ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tabc\n" +
        ".bilibili.com\tTRUE\t/\tFALSE\t0\tbili_jct\txyz\n"
    )
  })

  it("跳过无等号片段", () => {
    const content = buildNetscapeCookieContent("https://bilibili.com", "SESSDATA=abc; garbage")
    expect(content).toContain("SESSDATA")
    expect(content).not.toContain("garbage")
  })
})
