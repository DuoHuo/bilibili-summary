import { useCallback, useEffect, useRef, useState } from "react"
import { load } from "@tauri-apps/plugin-store"
import { listen } from "@tauri-apps/api/event"
import type { PromptMode } from "./prompts"
import { resolvePrompt } from "./prompts"
import type { SummarizeResult, UserConfig } from "./types"
import { postSummarize, type SummarizePayload } from "./api"
import { killExternal, readTextFile, removeDir, resolveOutputDir } from "./tauri"

const SESSIONS_FILE = "sessions.json"
const SESSIONS_KEY = "list"

export type SessionStatus = "running" | "done" | "error" | "cancelled"

export interface SessionMeta {
  run_id: string
  url: string
  title: string
  mode: PromptMode
  status: SessionStatus
  createdAt: number
  finishedAt: number | null
  error?: string
  outputDir: string
  /** 运行中任务的当前阶段（detect/fetch_subtitle/whisper/...）；结束后为 null */
  stage?: string | null
}

/** Runtime guard：从磁盘读回的 session 记录经过校验后才可用（对齐 lib/types.ts 模式）。 */
export function isSessionMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const status = record.status
  return (
    typeof record.run_id === "string" &&
    typeof record.url === "string" &&
    typeof record.title === "string" &&
    (typeof record.mode === "string") &&
    (status === "running" || status === "done" || status === "error" || status === "cancelled") &&
    typeof record.createdAt === "number" &&
    (record.finishedAt === null || typeof record.finishedAt === "number") &&
    (record.error === undefined || typeof record.error === "string") &&
    typeof record.outputDir === "string" &&
    (record.stage === undefined || record.stage === null || typeof record.stage === "string")
  )
}

/** 从磁盘读 session 索引。 */
export async function loadSessions(): Promise<SessionMeta[]> {
  try {
    const store = await load(SESSIONS_FILE)
    const value = await store.get<unknown>(SESSIONS_KEY)
    if (!Array.isArray(value)) return []
    const list = value.filter(isSessionMeta)
    return list.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

/** 写 session 索引（按 createdAt 倒序）。 */
export async function saveSessions(list: SessionMeta[]): Promise<void> {
  const store = await load(SESSIONS_FILE, { autoSave: true })
  await store.set(SESSIONS_KEY, list)
  await store.save()
}

/** 读取 session 产物（回看用）：md 为必需，html/transcript 缺失时降级。 */
export async function readSessionOutput(session: SessionMeta): Promise<SummarizeResult | null> {
  try {
    const mdPath = `${session.outputDir}/summary_${session.run_id}.md`
    const markdown = await readTextFile(mdPath)
    let html = ""
    try {
      html = await readTextFile(`${session.outputDir}/summary_${session.run_id}.html`)
    } catch {
      html = ""
    }
    let transcript: string | null = null
    try {
      transcript = await readTextFile(`${session.outputDir}/transcript_${session.run_id}.txt`)
    } catch {
      transcript = null
    }
    return {
      run_id: session.run_id,
      title: session.title,
      summary: "",
      markdown,
      html,
      transcript
    }
  } catch {
    return null
  }
}

interface UseSessionManagerOptions {
  config: UserConfig
}

/**
 * 会话管理器：并发多任务 + 持久化历史。
 * - `sessions`：索引列表（含 running 任务），内存 + 磁盘镜像
 * - `start(url)`：创建 running session 并执行摘要
 * - `cancel(runId)`：终止外部进程并标记 cancelled
 * - `remove(runId)`：删索引 + 删产物目录
 * - `rerun(runId)`：复用原 URL + 当前配置发起新任务
 */
export function useSessionManager({ config }: UseSessionManagerOptions) {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const sessionsRef = useRef<SessionMeta[]>([])
  sessionsRef.current = sessions

  // 启动时加载持久化历史
  useEffect(() => {
    let active = true
    loadSessions()
      .then((list) => {
        if (active) setSessions(list)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // 订阅全局进度事件：按 run_id 路由到对应 session，更新 stage。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let active = true
    listen<{ run_id: string; stage: string; detail: string }>("summary://progress", (event) => {
      if (!active) return
      const { run_id, stage } = event.payload
      if (!run_id) return
      setSessions((prev) =>
        prev.map((s) => (s.run_id === run_id && s.status === "running" ? { ...s, stage } : s))
      )
    })
      .then((fn) => {
        if (active) unlisten = fn
        else fn()
      })
      .catch(() => {})
    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  // 每次状态变化写盘（仅快照，不阻塞 UI）
  useEffect(() => {
    if (sessions.length === 0) return
    saveSessions(sessions).catch(() => {})
  }, [sessions])

  const patchSession = useCallback((runId: string, patch: Partial<SessionMeta>) => {
    setSessions((prev) => prev.map((s) => (s.run_id === runId ? { ...s, ...patch } : s)))
  }, [])

  const start = useCallback(
    async (url: string) => {
      const runId = crypto.randomUUID()
      const outputDir = await resolveOutputDir(runId)
      const session: SessionMeta = {
        run_id: runId,
        url,
        title: "",
        mode: config.promptMode,
        status: "running",
        createdAt: Date.now(),
        finishedAt: null,
        outputDir,
        stage: "detect"
      }
      setSessions((prev) => [session, ...prev])

      const payload: SummarizePayload = {
        url,
        api_key: config.apiKey.trim(),
        model: config.model.trim() || null,
        base_url: config.baseUrl.trim() || null,
        prompt: resolvePrompt(config.promptMode, config.prompt) || null,
        cookie: config.cookie.trim() || null,
        stt_language: config.sttLanguage,
        screenshot: config.screenshot,
        mode: config.promptMode,
        run_id: runId
      }

      try {
        const result = await postSummarize(
          "",
          payload,
          // 直接路由 stage：core 层 onProgress 回调（detect/fetch_subtitle/llm/render...）
          (stage) => {
            setSessions((prev) =>
              prev.map((s) =>
                s.run_id === runId && s.status === "running" ? { ...s, stage } : s
              )
            )
          }
        )
        patchSession(runId, {
          title: result.title,
          status: "done",
          finishedAt: Date.now(),
          stage: null
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // 取消竞态：若已被 cancel() 标记 cancelled，保持 cancelled 不覆盖。
        setSessions((prev) =>
          prev.map((s) =>
            s.run_id === runId && s.status !== "cancelled"
              ? { ...s, status: "error", finishedAt: Date.now(), stage: null, error: message }
              : s
          )
        )
      }
      return runId
    },
    [config, patchSession]
  )

  const cancel = useCallback(
    async (runId: string) => {
      // 标记 cancelled（尽力而为：终止当前子进程）
      patchSession(runId, { status: "cancelled", finishedAt: Date.now(), stage: null })
      try {
        await killExternal(runId)
      } catch {
        // 进程可能已结束，忽略
      }
    },
    [patchSession]
  )

  const remove = useCallback(
    async (runId: string) => {
      const target = sessionsRef.current.find((s) => s.run_id === runId)
      setSessions((prev) => prev.filter((s) => s.run_id !== runId))
      if (target?.outputDir) {
        try {
          await removeDir(target.outputDir)
        } catch {
          // 目录可能已不存在，忽略
        }
      }
    },
    []
  )

  const rerun = useCallback(
    async (runId: string) => {
      const target = sessionsRef.current.find((s) => s.run_id === runId)
      if (!target) return
      await start(target.url)
    },
    [start]
  )

  return { sessions, start, cancel, remove, rerun }
}
