import type { MouseEvent, ReactNode } from "react"

/**
 * 窗口拖拽区域。
 * 背景：Tauri 2 在 macOS `titleBarStyle: Overlay` 下 `data-tauri-drag-region`
 * 不生效（上游 issue tauri-apps/tauri#9503），需手动调用 startDragging。
 * 保留 data-tauri-drag-region 属性作为非 Overlay 平台/未来修复的双保险。
 */
export function DragRegion({ className, children }: { className?: string; children?: ReactNode }) {
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    // 非 Tauri 环境（浏览器 QA）静默跳过
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch(() => {})
  }

  return (
    <div data-tauri-drag-region className={className} onMouseDown={handleMouseDown}>
      {children}
    </div>
  )
}
