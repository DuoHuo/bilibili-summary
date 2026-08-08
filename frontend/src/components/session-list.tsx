import { Loader2, RefreshCw, Trash2, XCircle } from "lucide-react"
import type { SessionMeta } from "@/lib/sessions"

const STAGE_LABEL: Record<string, string> = {
  detect: "识别平台",
  fetch_subtitle: "抓取字幕",
  whisper: "本地转写",
  build_prompt: "构建提示词",
  llm: "生成摘要",
  render: "渲染结果",
  done: "完成"
}

const STATUS_DOT: Record<SessionMeta["status"], string> = {
  running: "bg-muted-soft",
  done: "bg-success",
  error: "bg-error",
  cancelled: "bg-error"
}

const STATUS_LABEL: Record<SessionMeta["status"], string> = {
  running: "进行中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消"
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface SessionListProps {
  sessions: SessionMeta[]
  activeRunId: string | null
  onSelect: (runId: string) => void
  onCancel: (runId: string) => void
  onRemove: (runId: string) => void
  onRerun: (runId: string) => void
}

/** 侧边栏 session 平铺列表：色点状态 + 标题 + 时间 + 操作按钮。 */
export function SessionList({
  sessions,
  activeRunId,
  onSelect,
  onCancel,
  onRemove,
  onRerun
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
        const running = session.status === "running"
        return (
          <div
            key={session.run_id}
            className={`group flex flex-col gap-1 rounded-lg px-3 py-2 transition-colors ${
              active ? "bg-surface-card" : "hover:bg-surface-soft"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(session.run_id)}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status]}`}
                title={STATUS_LABEL[session.status]}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {session.title || "未命名视频"}
                </span>
                <span className="block truncate text-xs text-muted-soft">
                  {formatTime(session.createdAt)} · {STATUS_LABEL[session.status]}
                </span>
              </span>
            </button>

            {running && (
              <div className="flex items-center gap-2 pl-3.5">
                <Loader2 className="size-3 animate-spin text-muted" />
                <span className="flex-1 truncate text-xs text-muted">
                  {STAGE_LABEL[session.stage ?? ""] ?? session.stage ?? "准备中"}
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
              <div className="flex items-center gap-1 pl-3.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onRerun(session.run_id)}
                  title="再次生成"
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted hover:text-ink"
                >
                  <RefreshCw className="size-3" />
                  再次生成
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(session.run_id)}
                  title="删除"
                  className="ml-auto rounded px-1 py-0.5 text-muted hover:text-error"
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
