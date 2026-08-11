import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { getBufferedLogs, getLogDir, subscribeLogs } from "@/lib/logger"
import type { LogEvent, LogLevel } from "@/core/log"

/** 渲染行数上限（超出只保留最新 N 条，防 DOM 过载）。 */
const MAX_ROWS = 500
/** 距底部在此像素内才自动滚动；用户上滚超过此阈值则暂停跟随。 */
const AUTO_SCROLL_THRESHOLD = 80

const LEVEL_CLASS: Record<LogLevel, string> = {
  DEBUG: "text-muted-soft",
  INFO: "text-ink",
  WARN: "text-warning",
  ERROR: "text-error"
}

/** ISO 8601 → HH:mm:ss（本地时区，对齐日志阅读习惯）。 */
function formatTime(ts: string): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Session 日志面板：订阅 logger 内存 sink，仅显示当前 run_id 的事件。
 * 实时追加 + 自动滚底（用户上滚暂停）；ERROR 可展开 err.context。
 * 历史 session（ring buffer 为空）显示空状态 + 打开日志文件入口。
 */
export function SessionLogPanel({ runId }: { runId: string }) {
  // 播种：挂载时从 ring buffer 快照过滤当前 session 的事件
  const [events, setEvents] = useState<LogEvent[]>(() =>
    getBufferedLogs().filter((e) => e.run_id === runId)
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  // 是否跟随底部：用户上滚后置 false，回到底部附近恢复 true
  const stickToBottomRef = useRef(true)

  // re-derive 模式：每次事件触发从 ring buffer 重新过滤全量，避免 seed/subscribe 竞态丢事件
  useEffect(() => {
    const derive = (): void => setEvents(getBufferedLogs().filter((e) => e.run_id === runId))
    derive() // 挂载后补种，覆盖 initializer 与 subscribe 之间的空窗
    return subscribeLogs((evt) => {
      if (evt.run_id !== runId) return
      derive()
    })
  }, [runId])

  // 新事件自动滚底（仅在跟随状态时）
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [events])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distFromBottom < AUTO_SCROLL_THRESHOLD
  }, [])

  const handleCopyAll = useCallback(() => {
    const jsonl = events.map((e) => JSON.stringify(e)).join("\n")
    void navigator.clipboard.writeText(jsonl).then(() => {
      toast.success(`已复制 ${events.length} 条日志`)
    })
  }, [events])

  const handleOpenLog = useCallback(() => {
    void import("@/lib/tauri").then(({ openPath }) => {
      const dir = getLogDir()
      if (dir) void openPath(dir)
      else toast.info("日志目录尚未就绪")
    })
  }, [])

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (events.length === 0) {
    return (
      <div className="raised-card p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted">本轮暂无日志</p>
          <p className="text-xs text-muted-soft">历史任务日志请打开日志文件查看</p>
          <Button variant="secondary" size="sm" onClick={handleOpenLog}>
            <ExternalLink />
            打开日志文件
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="raised-card flex min-h-[320px] flex-col gap-2 p-3">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[60vh] flex-1 overflow-y-auto rounded-lg bg-surface-soft p-3 font-mono text-xs leading-relaxed"
      >
        {events.slice(-MAX_ROWS).map((evt) => {
          const key = `${evt.ts}-${evt.event}-${evt.level}`
          const hasContext = evt.err && evt.err.context !== undefined
          const isExpanded = expanded.has(key)
          return (
            <div key={key} className="py-0.5">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="shrink-0 text-muted-soft">{formatTime(evt.ts)}</span>
                <span className={`shrink-0 font-semibold ${LEVEL_CLASS[evt.level]}`}>
                  {evt.level}
                </span>
                <span className="shrink-0 text-ink">{evt.event}</span>
                {evt.err && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(key)}
                    className="flex shrink-0 items-center gap-0.5 text-error hover:underline"
                  >
                    {hasContext &&
                      (isExpanded ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      ))}
                    {evt.err.code}
                  </button>
                )}
              </div>
              {isExpanded && evt.err?.context !== undefined && (
                <pre className="mt-1 whitespace-pre-wrap break-all pl-4 text-muted">
                  {JSON.stringify(evt.err.context, null, 2)}
                </pre>
              )}
              {isExpanded && evt.err && (
                <p className="mt-1 pl-4 text-xs text-muted-soft">{evt.err.message}</p>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-soft">
          {events.length} 条 · 仅本轮 session
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleCopyAll}>
            <Copy />
            复制全部
          </Button>
          <Button variant="secondary" size="sm" onClick={handleOpenLog}>
            <ExternalLink />
            打开日志文件
          </Button>
        </div>
      </div>
    </div>
  )
}
