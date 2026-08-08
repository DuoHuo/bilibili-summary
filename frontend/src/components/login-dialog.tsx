import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { buildCookieString, parseLoginUrl } from "@/core/auth/bilibili"
import type { HttpFetch } from "@/core/types"
import {
  fetchNavInfo,
  generateQrcode,
  pollQrcode,
  type BiliProfile
} from "@/lib/biliAuth"

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  http: HttpFetch
  onSuccess: (profile: BiliProfile, cookie: string) => void
}

type Status = "loading" | "ready" | "error"

const POLL_INTERVAL_MS = 2000
const QR_WIDTH = 220

/** B 站扫码登录弹窗：生成二维码 → 轮询扫码状态 → 成功后回调 profile + cookie。 */
export function LoginDialog({ open, onOpenChange, http, onSuccess }: LoginDialogProps) {
  const [status, setStatus] = useState<Status>("loading")
  const [qrcodeUrl, setQrcodeUrl] = useState("")
  const [hint, setHint] = useState("请使用手机 B 站 App 扫码登录")
  const [errorMsg, setErrorMsg] = useState("")
  const qrcodeKeyRef = useRef("")
  const pollingRef = useRef(false)

  const startLogin = useCallback(async () => {
    setStatus("loading")
    try {
      const qr = await generateQrcode(http)
      const dataUrl = await QRCode.toDataURL(qr.content, { width: QR_WIDTH, margin: 1 })
      qrcodeKeyRef.current = qr.qrcodeKey
      setQrcodeUrl(dataUrl)
      setHint("请使用手机 B 站 App 扫码登录")
      setStatus("ready")
    } catch (err) {
      console.error("[bili-auth] 获取二维码失败", err)
      setErrorMsg(`获取二维码失败：${err instanceof Error ? err.message : JSON.stringify(err)}`)
      setStatus("error")
    }
  }, [http])

  // 打开时初始化；关闭时清理
  useEffect(() => {
    if (!open) return
    qrcodeKeyRef.current = ""
    setQrcodeUrl("")
    setHint("请使用手机 B 站 App 扫码登录")
    setErrorMsg("")
    void startLogin()
  }, [open, startLogin])

  // 轮询扫码状态（仅 ready 时启用）
  useEffect(() => {
    if (!open || status !== "ready") return
    let cancelled = false

    const tick = async () => {
      if (cancelled || pollingRef.current) return
      pollingRef.current = true
      try {
        const res = await pollQrcode(http, qrcodeKeyRef.current)
        if (cancelled) return

        if (res.code === 0 && res.loginUrl) {
          // 1. 访问 sso url：响应 Set-Cookie 由 plugin-http cookie jar 自动存储（登录态核心，不依赖解析）
          await http(res.loginUrl, { headers: { Referer: "https://passport.bilibili.com/" } }).catch(() => {})
          // 2. 解析 cookie 字符串（body cookies 优先，url query 回退），用于字幕抓取与展示
          const creds = Object.keys(res.cookies).length > 0 ? res.cookies : parseLoginUrl(res.loginUrl)
          const cookieStr = buildCookieString(creds)
          // 3. 校验登录态：cookie 为空时交给 jar（不传手动 Cookie 头）
          const nav = await fetchNavInfo(http, cookieStr || undefined)
          if (cancelled) return
          if (nav.status === "active" && nav.profile) {
            onSuccess(nav.profile, cookieStr)
            onOpenChange(false)
            return
          }
          setErrorMsg(
            nav.status === "expired"
              ? "登录校验未通过（B 站未确认登录态），请重试"
              : "登录校验服务暂时不可用，请稍后重试"
          )
          setStatus("error")
          return
        }

        if (res.code === 86038) {
          // 二维码已失效：自动刷新
          await startLogin()
          return
        }

        setHint(res.code === 86090 ? "已扫码，请在手机上确认登录" : "请使用手机 B 站 App 扫码登录")
      } catch (err) {
        if (!cancelled) {
          console.error("[bili-auth] 查询扫码状态失败", err)
          setErrorMsg(`查询扫码状态失败：${err instanceof Error ? err.message : JSON.stringify(err)}`)
          setStatus("error")
        }
      } finally {
        pollingRef.current = false
      }
    }

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [open, status, http, onSuccess, onOpenChange, startLogin])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-8 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>登录 B 站账号</DialogTitle>
          <DialogDescription>
            使用手机 B 站 App 扫码，登录后自动填充 Cookie，解锁会员视频字幕抓取。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {status === "loading" && (
            <div className="flex h-56 w-full items-center justify-center text-sm text-muted">
              正在生成二维码...
            </div>
          )}

          {status === "ready" && (
            <>
              <img
                src={qrcodeUrl}
                alt="B 站登录二维码"
                className="rounded-lg border border-hairline bg-white p-2"
                style={{ width: QR_WIDTH + 16, height: QR_WIDTH + 16 }}
              />
              <p className="text-sm text-muted">{hint}</p>
            </>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-sm text-error">{errorMsg}</p>
              <Button variant="secondary" onClick={() => void startLogin()}>
                重试
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
