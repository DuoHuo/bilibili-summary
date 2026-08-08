import { describe, expect, it } from "vitest"

import { buildCookieString, extractBiliJct, parseCookiesPayload, parseLoginUrl } from "./bilibili"

describe("parseLoginUrl", () => {
  it("从 sso 登录 URL 提取凭证参数", () => {
    const url =
      "https://passport.bilibili.com/x/passport-login/web/sso/login?SESSDATA=abc123&bili_jct=csrf456&DedeUserID=123456&DedeUserID__ckMd5=md5hash&sid=abc&expires=604800"
    expect(parseLoginUrl(url)).toEqual({
      SESSDATA: "abc123",
      bili_jct: "csrf456",
      DedeUserID: "123456",
      DedeUserID__ckMd5: "md5hash",
      sid: "abc"
    })
  })

  it("忽略白名单之外的参数（如 expires）", () => {
    const url = "https://passport.bilibili.com/x/passport-login/web/sso/login?SESSDATA=x&expires=604800"
    expect(parseLoginUrl(url)).toEqual({ SESSDATA: "x" })
  })

  it("非法 URL 返回空对象", () => {
    expect(parseLoginUrl("not-a-url")).toEqual({})
  })
})

describe("buildCookieString", () => {
  it("组装标准 cookie 字符串", () => {
    expect(buildCookieString({ SESSDATA: "x", bili_jct: "y" })).toBe("SESSDATA=x; bili_jct=y")
  })

  it("空对象返回空串", () => {
    expect(buildCookieString({})).toBe("")
  })
})

describe("parseCookiesPayload", () => {
  it("解析数组对结构 [[name, value]]", () => {
    expect(parseCookiesPayload([["SESSDATA", "x"], ["bili_jct", "y"]])).toEqual({ SESSDATA: "x", bili_jct: "y" })
  })

  it("解析对象数组结构 [{name, value}]", () => {
    expect(parseCookiesPayload([{ name: "SESSDATA", value: "x" }, { name: "bili_jct", value: "y" }])).toEqual({
      SESSDATA: "x",
      bili_jct: "y"
    })
  })

  it("非法输入返回空对象", () => {
    expect(parseCookiesPayload(null)).toEqual({})
    expect(parseCookiesPayload("nope")).toEqual({})
    expect(parseCookiesPayload(["SESSDATA", "x"])).toEqual({})
  })
})

describe("extractBiliJct", () => {
  it("从完整 cookie 中解析 bili_jct", () => {
    expect(extractBiliJct("SESSDATA=abc; bili_jct=csrf456; sid=xyz")).toBe("csrf456")
  })

  it("bili_jct 在开头时也能解析", () => {
    expect(extractBiliJct("bili_jct=csrf456; SESSDATA=abc")).toBe("csrf456")
  })

  it("无 bili_jct 返回 null", () => {
    expect(extractBiliJct("SESSDATA=abc")).toBeNull()
    expect(extractBiliJct("")).toBeNull()
  })
})
