import type { HttpFetch, HttpResponse } from "@/core/types"
import { BILI_HEADERS } from "@/core/subtitle/bilibili"
import { extractBiliJct, parseCookiesPayload } from "@/core/auth/bilibili"
import type { BiliProfile } from "./types"

/**
 * 适配层：B 站 passport 扫码登录网络调用（注入 HttpFetch，Tauri 下为 tauriHttpFetch）。
 * 接口流程参考 luyuduan/get_bilibili_cookie；所有 B 站接口调用集中在此，便于接口变更时收敛。
 */

export interface QrcodePayload {
  qrcodeKey: string
  /** 二维码内容（登录 URL） */
  content: string
}

export interface PollResult {
  /** B 站 poll 状态码：0=成功 / 86038=失效 / 86101=未扫 / 86090=已扫未确认 */
  code: number
  message: string
  /** 成功时含登录凭证的 sso url */
  loginUrl: string | null
  /** 成功时 body 中可能直接返回的 cookie（部分接口版本） */
  cookies: Record<string, string>
}

export type { BiliProfile }

/** 会话状态：区分「过期」与「服务异常」，避免误清用户 Cookie（对齐 FocuBili 的状态模型）。 */
export type BiliSessionStatus = "signedOut" | "active" | "expired" | "serviceError"

export interface SessionState {
  status: BiliSessionStatus
  profile: BiliProfile | null
}

interface BiliResp<T> {
  code: number
  message?: string
  data?: T | null
}

/** 解析 B 站响应体：非零 code 抛用户可读错误。debug 时附带原始响应片段。 */
async function parseResp<T>(resp: HttpResponse, context: string): Promise<T> {
  if (!resp.ok) {
    const raw = await resp.text().catch(() => "")
    throw new Error(`${context}失败（HTTP ${resp.status}）${raw ? `：${raw.slice(0, 200)}` : ""}`)
  }
  const body = (await resp.json<BiliResp<T>>()) as BiliResp<T>
  if (body.code !== 0) {
    throw new Error(`${context}失败（code=${body.code}）${body.message ? `：${body.message}` : ""}`)
  }
  if (body.data === undefined || body.data === null) throw new Error(`${context}失败：响应数据为空`)
  return body.data
}

/** 获取登录二维码：`GET /x/passport-login/web/qrcode/generate` */
export async function generateQrcode(http: HttpFetch): Promise<QrcodePayload> {
  const data = await parseResp<{ url?: string; qrcode_key?: string }>(
    await http("https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header", {
      headers: BILI_HEADERS
    }),
    "获取登录二维码"
  )
  if (!data.url || !data.qrcode_key) throw new Error("获取登录二维码失败：响应数据不完整")
  return { qrcodeKey: data.qrcode_key, content: data.url }
}

/** 轮询扫码状态：`GET /x/passport-login/web/qrcode/poll`（外层 code=0 仅表示请求成功，状态在 data.code） */
export async function pollQrcode(http: HttpFetch, qrcodeKey: string): Promise<PollResult> {
  const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}&source=main-fe-header`
  const data = await parseResp<{ code?: number; message?: string; url?: string | null; cookies?: unknown }>(
    await http(url, { headers: BILI_HEADERS }),
    "查询扫码状态"
  )
  const code = data.code ?? -1
  return {
    code,
    message: data.message || "",
    loginUrl: code === 0 && data.url ? data.url : null,
    cookies: parseCookiesPayload(data.cookies)
  }
}

/** 校验登录态并获取用户信息：`GET /x/web-interface/nav`。
 * cookie 为空时不手动传 Cookie 头，交由 plugin-http 的 cookie jar（Set-Cookie 已自动存储）。
 * 状态语义：仅 code=-101 判定过期；HTTP/解析/其他 code 均视为服务异常（保留 Cookie 不清除）。 */
export async function fetchNavInfo(http: HttpFetch, cookie?: string): Promise<SessionState> {
  const headers: Record<string, string> = { ...BILI_HEADERS }
  if (cookie) headers.Cookie = cookie

  let resp: HttpResponse
  try {
    resp = await http("https://api.bilibili.com/x/web-interface/nav", { headers })
  } catch {
    return { status: "serviceError", profile: null }
  }
  if (!resp.ok) return { status: "serviceError", profile: null }

  let body: BiliResp<{
    isLogin?: boolean
    uname?: string
    face?: string
    mid?: number
    uid?: number
  }>
  try {
    body = await resp.json<BiliResp<{
      isLogin?: boolean
      uname?: string
      face?: string
      mid?: number
      uid?: number
    }>>()
  } catch {
    return { status: "serviceError", profile: null }
  }

  if (body.code === -101) return { status: "expired", profile: null }
  if (body.code !== 0 || !body.data) return { status: "serviceError", profile: null }

  const data = body.data
  if (!data.isLogin) return { status: "expired", profile: null }

  const uid = data.mid ?? data.uid
  if (uid === undefined || !data.uname) return { status: "serviceError", profile: null }
  return {
    status: "active",
    profile: { uid, name: data.uname, face: data.face || "" }
  }
}

/** 退出登录：`POST /x/passport-login/login/exit/v2`（bili_jct 作 CSRF）。尽力而为，任何失败不抛错。 */
export async function logoutBili(http: HttpFetch, cookie: string): Promise<void> {
  try {
    await http("https://passport.bilibili.com/login/exit/v2", {
      method: "POST",
      headers: {
        ...BILI_HEADERS,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `biliCSRF=${encodeURIComponent(extractBiliJct(cookie) ?? "")}`
    })
  } catch {
    // 服务端会话失效失败不影响本地清除
  }
}
