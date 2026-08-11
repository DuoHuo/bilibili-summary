import { getVersion } from "@tauri-apps/api/app"

import { tauriHttpFetch } from "@/lib/tauri"

/** 检查更新结果；hasUpdate=false 时其余字段无意义。 */
export interface UpdateInfo {
  hasUpdate: boolean
  /** 最新版本号（去 v 前缀，如 "0.2.0"） */
  latestVersion: string | null
  /** release 页面 URL，供「下载」按钮打开 */
  htmlUrl: string | null
}

const REPO = "DuoHuo/bilibili-summary"
const RELEASES_LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

/** 简单 semver 三段比较：a > b → 1，a < b → -1，相等 → 0。非数字段按 0 处理。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

interface GithubRelease {
  tag_name: string
  html_url: string
}

/**
 * 检查 GitHub 最新 release；全程失败静默，返回 hasUpdate=false。
 * 启动后台调用，不应阻塞 UI 或弹错。
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  let currentVersion: string | null = null
  try {
    currentVersion = await getVersion()
  } catch {
    // 非 Tauri 运行环境（单测 / web 预览）：无版本信息，视为无更新
    return { hasUpdate: false, latestVersion: null, htmlUrl: null }
  }

  try {
    const resp = await tauriHttpFetch(RELEASES_LATEST_API)
    if (!resp.ok) return { hasUpdate: false, latestVersion: null, htmlUrl: null }
    const data = await resp.json<GithubRelease>()
    const latest = data.tag_name.replace(/^v/, "")
    const hasUpdate = compareSemver(latest, currentVersion) > 0
    return { hasUpdate, latestVersion: latest, htmlUrl: data.html_url }
  } catch {
    // 网络失败 / GitHub 限流 / 响应异常：静默
    return { hasUpdate: false, latestVersion: null, htmlUrl: null }
  }
}
