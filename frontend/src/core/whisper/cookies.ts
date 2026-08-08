/**
 * cookie 处理：将 `key=value; ...` 串转为 Netscape 格式内容。
 * 移植自 backend/src/services.rs::prepare_ytdlp_cookies（内容生成部分）。
 */

/** 提取注册域名（取 host 最后两段） */
export function extractCookieDomain(url: string): string {
  const host = new URL(url).hostname
  const parts = host.split(".")
  if (parts.length >= 2) return parts.slice(-2).join(".")
  return host
}

/** 生成 Netscape cookies.txt 内容 */
export function buildNetscapeCookieContent(url: string, cookie: string): string {
  const domain = extractCookieDomain(url)
  let content = "# Netscape HTTP Cookie File\n"
  for (const pair of cookie.split(";")) {
    const trimmed = pair.trim()
    const eq = trimmed.indexOf("=")
    if (eq < 0) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    content += `.${domain}\tTRUE\t/\tFALSE\t0\t${name}\t${value}\n`
  }
  return content
}
