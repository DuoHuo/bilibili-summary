/**
 * 提取截图标记：`*Screenshot-mm:ss` 或 `Screenshot-[mm:ss]`。
 * 移植自 backend/src/utils.rs::extract_screenshot_markers。
 */
export function extractScreenshotMarkers(markdown: string): Array<[string, number]> {
  const pattern = /(?:\*Screenshot-(\d{2}):(\d{2})|Screenshot-\[(\d{2}):(\d{2})\])/g
  const results: Array<[string, number]> = []
  for (const match of markdown.matchAll(pattern)) {
    const mm = match[1] ?? match[3]
    const ss = match[2] ?? match[4]
    if (mm === undefined || ss === undefined) continue
    const total = Number(mm) * 60 + Number(ss)
    if (Number.isNaN(total)) continue
    results.push([match[0], total])
  }
  return results
}
