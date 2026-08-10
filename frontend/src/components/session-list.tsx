import { Trash2, XCircle } from "lucide-react"

import { describeSessionState, type SessionMeta } from "@/lib/sessions"
import type { PromptMode } from "@/lib/prompts"

function hasRunningMode(session: SessionMeta): boolean {
  return (Object.keys(session.modes) as PromptMode[]).some((m) => session.modes[m]?.status === "running")
}

interface SessionListProps {
  sessions: SessionMeta[]
  activeRunId: string | null
  onSelect: (runId: string) => void
  onCancel: (runId: string) => void
  onRemove: (runId: string) => void
}

/** 侧边栏 session 卡片列表：状态灯表示运行/完成/失败，标题恒定展示，操作按钮 hover 时浮现。 */
export function SessionList({
  sessions,
  activeRunId,
  onSelect,
  onCancel,
  onRemove
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="px-5 py-4 text-xs text-muted-soft">
        暂无历史记录
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-3">
      {sessions.map((session) => {
        const active = session.run_id === activeRunId
        const running = session.status === "preparing" || hasRunningMode(session)
        const dotClass = running ? "bg-muted-soft animate-pulse" : session.status === "ready" ? "bg-success" : "bg-error"
        const hint = describeSessionState(session) || session.error || session.title
        return (
          <div key={session.run_id} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(session.run_id)}
              title={hint}
              aria-current={active ? "true" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 pr-9 text-left transition-colors ${
                active ? "border-primary/60 bg-surface-card" : "border-hairline hover:bg-surface-soft"
              }`}
            >
              <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {session.title || "未命名视频"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => (running ? onCancel(session.run_id) : onRemove(session.run_id))}
              title={running ? "取消任务" : "删除"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 transition-opacity hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
            >
              {running ? <XCircle className="size-3.5" /> : <Trash2 className="size-3" />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
