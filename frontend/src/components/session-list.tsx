import { Loader2, Trash2, XCircle } from "lucide-react"
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

/** 侧边栏 session 平铺列表：已完成只显示标题，运行中显示动态状态。 */
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
    <div className="flex flex-col gap-1 px-3">
      {sessions.map((session) => {
        const active = session.run_id === activeRunId
        const running = session.status === "preparing" || hasRunningMode(session)
        return (
          <div
            key={session.run_id}
            className={`group flex flex-col rounded-lg px-3 py-1.5 transition-colors ${
              active ? "bg-surface-card" : "hover:bg-surface-soft"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(session.run_id)}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  running ? "bg-muted-soft" : session.status === "ready" ? "bg-success" : "bg-error"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {session.title || "未命名视频"}
              </span>
            </button>

            {running && (
              <div className="flex items-center gap-2 pl-3.5">
                <Loader2 className="size-3 animate-spin text-muted" />
                <span className="flex-1 truncate text-xs text-muted">
                  {describeSessionState(session)}
                </span>
                <button
                  type="button"
                  onClick={() => onCancel(session.run_id)}
                  title="取消任务"
                  className="rounded p-0.5 text-muted hover:text-error"
                >
                  <XCircle className="size-3.5" />
                </button>
              </div>
            )}

            {!running && (
              <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onRemove(session.run_id)}
                  title="删除"
                  className="rounded p-0.5 text-muted hover:text-error"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
