/**
 * 纯函数层：B 站 passport 扫码登录的凭证解析与组装。
 * 不依赖网络 / DOM，便于单测。
 * 接口参考：luyuduan/get_bilibili_cookie（get_cookie.py）+ BilibiliPotPlayer 同款方案。
 */

/** passport sso 登录 URL 中可作为 cookie 的凭证参数白名单 */
const COOKIE_KEYS = ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"] as const

/**
 * 解析扫码轮询成功返回的 `data.url`，提取登录凭证参数。
 * 典型 url：`https://passport.bilibili.com/x/passport-login/web/sso/login?SESSDATA=xxx&bili_jct=yyy&...`
 */
export function parseLoginUrl(url: string): Record<string, string> {
  const result: Record<string, string> = {}
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return result
  }
  for (const key of COOKIE_KEYS) {
    const value = parsed.searchParams.get(key)
    if (value !== null) result[key] = value
  }
  return result
}

/** 组装标准 cookie 字符串：`SESSDATA=x; bili_jct=y`。 */
export function buildCookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ")
}

/** 从 cookie 字符串解析 bili_jct（退出登录 CSRF 用），未找到返回 null。 */
export function extractBiliJct(cookie: string): string | null {
  const match = /(?:^|;\s*)bili_jct=([^;]+)/.exec(cookie)
  return match ? match[1] : null
}

/**
 * 解析 poll 成功响应 body 中可能存在的 cookies 字段（B 站接口演进，部分版本直接在 body 返回 cookie）。
 * 兼容两种结构：`[["SESSDATA","x"],...]` 与 `[{"name":"SESSDATA","value":"x"},...]`。
 */
export function parseCookiesPayload(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!Array.isArray(value)) return result
  for (const item of value) {
    if (Array.isArray(item) && item.length >= 2 && typeof item[0] === "string" && typeof item[1] === "string") {
      result[item[0]] = item[1]
      continue
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      if (typeof record.name === "string" && typeof record.value === "string") {
        result[record.name] = record.value
      }
    }
  }
  return result
}
