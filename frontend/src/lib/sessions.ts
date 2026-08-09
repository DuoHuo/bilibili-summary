import { useCallback, useEffect, useRef, useState } from "react"
import { load } from "@tauri-apps/plugin-store"
import { listen } from "@tauri-apps/api/event"
import type { PromptMode } from "./prompts"
import type { Transcript } from "@/core/types"
import { runGenerate, runPrepare } from "./api"
import { killExternal, readTextFile, removeDir, resolveOutputDir, writeTextFile } from "./tauri"

const SESSIONS_FILE = "sessions.json"
const SESSIONS_KEY = "list"

export type SessionStatus = "preparing" | "ready" | "error" | "cancelled"
export type ModeStatus = "pending" | "running" | "done" | "error"

export interface ModeEntry {
  status: ModeStatus
  error?: string
  finishedAt?: number | null
}

export interface SessionMeta {
  run_id: string
  url: string
  title: string
  /** 任务级状态：字幕准备阶段 */
  status: SessionStatus
  /** 每模式独立生成状态 */
  modes: Partial<Record<PromptMode, ModeEntry>>
  createdAt: number
  finishedAt: number | null
  error?: string
  outputDir: string
  /** 准备阶段进度阶段（detect/fetch_subtitle/whisper）；完成后为 null */
  stage?: string | null
  /** 转录来源（subtitle/whisper），重新生成选源时判断用 */
  transcript_source?: "subtitle" | "whisper"
}

/** 模式中文名（动态文案用） */
const MODE_LABEL: Record<PromptMode, string> = {
  summary: "摘要",
  fulltext: "全文",
  timestamp: "时间戳",
  custom: "自定义"
}

const STAGE_LABEL: Record<string, string> = {
  detect: "正在识别平台",
  fetch_subtitle: "正在抓取字幕",
  whisper: "正在本地转写",
  build_prompt: "构建提示词",
  llm: "调用模型",
  render: "渲染结果"
}

/** 动态状态文案：preparing 返回阶段文案；模式生成中返回「正在生成{模式}」+ 阶段细节。 */
export function describeSessionState(session: SessionMeta): string {
  if (session.status === "preparing") {
    return STAGE_LABEL[session.stage ?? ""] ?? "正在准备字幕"
  }
  for (const [mode, entry] of Object.entries(session.modes) as Array<[PromptMode, ModeEntry]>) {
    if (entry.status === "running") {
      const stage = session.stage ? STAGE_LABEL[session.stage] : null
      return stage ? `正在生成${MODE_LABEL[mode]} · ${stage}` : `正在生成${MODE_LABEL[mode]}`
    }
  }
  return ""
}

/** Runtime guard：从磁盘读回的 session 记录经过校验后才可用。 */
export function isSessionMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.run_id === "string" &&
    typeof record.url === "string" &&
    typeof record.title === "string" &&
    (typeof record.status === "string") &&
    typeof record.createdAt === "number" &&
    (record.finishedAt === null || typeof record.finishedAt === "number") &&
    (record.error === undefined || typeof record.error === "string") &&
    typeof record.outputDir === "string" &&
    (record.stage === undefined || record.stage === null || typeof record.stage === "string") &&
    (record.transcript_source === undefined || record.transcript_source === "subtitle" || record.transcript_source === "whisper") &&
    (record.modes === undefined || record.modes === null || typeof record.modes === "object")
  )
}

const LEGACY_STATUS: Record<string, ModeStatus> = {
  done: "done",
  running: "running",
  error: "error",
  cancelled: "error"
}

/** 旧记录迁移（单 mode → modes 快照）；新记录原样通过。 */
function normalizeSession(value: unknown): SessionMeta | null {
  if (!isSessionMeta(value)) return null
  const session = value as SessionMeta & { mode?: PromptMode; status?: string }
  if (session.modes && typeof session.modes === "object") {
    return session as SessionMeta
  }
  // legacy：单模式 session（status 为 running/done/error/cancelled）
  const legacyMode: PromptMode = session.mode ?? "summary"
  const legacyStatus = LEGACY_STATUS[(session as { status?: string }).status ?? ""] ?? "done"
  return {
    run_id: session.run_id,
    url: session.url,
    title: session.title,
    status: (session as { status?: string }).status === "running" ? "preparing" : "ready",
    modes: { [legacyMode]: { status: legacyStatus, finishedAt: session.finishedAt } },
    createdAt: session.createdAt,
    finishedAt: session.finishedAt,
    error: session.error,
    outputDir: session.outputDir,
    stage: null
  }
}

/** 从磁盘读 session 索引。 */
export async function loadSessions(): Promise<SessionMeta[]> {
  try {
    const store = await load(SESSIONS_FILE)
    const value = await store.get<unknown>(SESSIONS_KEY)
    if (!Array.isArray(value)) return []
    const list = value
      .map(normalizeSession)
      .filter((s): s is SessionMeta => s !== null)
    return list.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

/** 写 session 索引（按 createdAt 倒序）。 */
async function saveSessions(list: SessionMeta[]): Promise<void> {
  const store = await load(SESSIONS_FILE, { autoSave: true })
  await store.set(SESSIONS_KEY, list)
  await store.save()
}

/** 读结构化 transcript（懒生成恢复用）；不存在返回 null。 */
async function readTranscript(session: SessionMeta): Promise<Transcript | null> {
  try {
    const raw = await readTextFile(`${session.outputDir}/transcript_${session.run_id}.json`)
    const data = JSON.parse(raw) as { segments?: Transcript["segments"]; source?: Transcript["source"] }
    if (!Array.isArray(data.segments)) return null
    return { text: "", segments: data.segments, source: data.source === "whisper" ? "whisper" : "subtitle" }
  } catch {
    return null
  }
}

/** 读取模式产物（回看用）：{mode}.md 必需，旧 summary_{id}.md 兼容 fallback。 */
export async function readModeOutput(session: SessionMeta, mode: PromptMode): Promise<string | null> {
  try {
    return await readTextFile(`${session.outputDir}/${mode}.md`)
  } catch {
    try {
      return await readTextFile(`${session.outputDir}/summary_${session.run_id}.md`)
    } catch {
      return null
    }
  }
}

interface UseSessionManagerOptions {
  config: {
    apiKey: string
    model: string
    baseUrl: string
    prompt: string
    promptMode: PromptMode
    cookie: string
    sttLanguage: "zh-cn" | "en"
    sttModel: string
    screenshot: boolean
  }
}

/**
 * 会话管理器：字幕准备一次 + 多模式懒生成 + 历史持久化。
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

  // 订阅全局进度事件：preparing 阶段按 run_id 路由 stage；模式生成路由到 modes
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let active = true
    listen<{ run_id: string; stage: string; detail: string }>("summary://progress", (event) => {
      if (!active) return
      const { run_id, stage } = event.payload
      if (!run_id) return
      setSessions((prev) =>
        prev.map((s) => {
          if (s.run_id !== run_id) return s
          if (s.status === "preparing") return { ...s, stage }
          // 模式生成阶段：找到 running 的 mode 更新 stage
          const runningMode = (Object.keys(s.modes) as PromptMode[]).find(
            (m) => s.modes[m]?.status === "running"
          )
          return runningMode ? { ...s, modes: { ...s.modes, [runningMode]: { ...s.modes[runningMode], status: "running" } } } : s
        })
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

  // 每次状态变化写盘（快照，不阻塞 UI）
  useEffect(() => {
    if (sessions.length === 0) return
    saveSessions(sessions).catch(() => {})
  }, [sessions])

  const patchSession = useCallback((runId: string, patch: Partial<SessionMeta>) => {
    setSessions((prev) => prev.map((s) => (s.run_id === runId ? { ...s, ...patch } : s)))
  }, [])

  const patchMode = useCallback((runId: string, mode: PromptMode, patch: Partial<ModeEntry>) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.run_id === runId
          ? { ...s, modes: { ...s.modes, [mode]: { ...s.modes[mode], ...patch } } }
          : s
      )
    )
  }, [])

  /** 执行某模式生成（基于目标 session 对象，不依赖 ref——供 start 自动触发与 generate 共用）。 */
  const runGenerateMode = useCallback(
    async (target: SessionMeta, mode: PromptMode) => {
      patchMode(target.run_id, mode, { status: "running", error: undefined, finishedAt: null })

      const transcript = await readTranscript(target)
      if (!transcript) {
        patchMode(target.run_id, mode, { status: "error", error: "字幕数据缺失，请重新提交任务", finishedAt: Date.now() })
        return null
      }

      try {
        const result = await runGenerate(
          {
            run_id: target.run_id,
            url: target.url,
            cookie: config.cookie.trim() || null,
            title: target.title,
            transcript,
            mode,
            custom_prompt: mode === "custom" ? config.prompt : null,
            api_key: config.apiKey.trim(),
            model: config.model.trim() || null,
            base_url: config.baseUrl.trim() || null,
            screenshot: config.screenshot
          },
          // 模式生成阶段的进度（build_prompt/llm/render）路由到 session.stage，正文动态展示
          (stage) => {
            setSessions((prev) =>
              prev.map((s) =>
                s.run_id === target.run_id && s.modes[mode]?.status === "running" ? { ...s, stage } : s
              )
            )
          }
        )
        patchMode(target.run_id, mode, { status: "done", finishedAt: Date.now() })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        patchMode(target.run_id, mode, { status: "error", error: message, finishedAt: Date.now() })
      }
      return null
    },
    [config, patchMode]
  )

  /** 新建任务：字幕准备（只做一次）；可选 autoMode——准备完成后立即生成该模式。 */
  const start = useCallback(
    async (url: string, autoMode?: PromptMode) => {
      const runId = crypto.randomUUID()
      const outputDir = await resolveOutputDir(runId)
      const session: SessionMeta = {
        run_id: runId,
        url,
        title: "",
        status: "preparing",
        modes: {},
        createdAt: Date.now(),
        finishedAt: null,
        outputDir,
        stage: "detect"
      }
      setSessions((prev) => [session, ...prev])

      try {
        const prepared = await runPrepare(
          {
            url,
            cookie: config.cookie.trim() || null,
            stt_language: config.sttLanguage,
            stt_model: config.sttModel,
            run_id: runId
          },
          (stage) => {
            setSessions((prev) =>
              prev.map((s) => (s.run_id === runId && s.status === "preparing" ? { ...s, stage } : s))
            )
          }
        )
        const readySession: SessionMeta = { ...session, title: prepared.title, status: "ready", stage: null }
        patchSession(runId, {
          title: prepared.title,
          status: "ready",
          stage: null,
          transcript_source: prepared.transcript.source
        })
        // 自动生成选中的模式（懒生成其他模式仍由 Tab 触发）
        if (autoMode) {
          await runGenerateMode(readySession, autoMode)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        patchSession(runId, { status: "error", finishedAt: Date.now(), stage: null, error: message })
      }
      return runId
    },
    [config.cookie, config.sttLanguage, patchSession, runGenerateMode]
  )

  /** 懒生成某模式；source 提供时先重新准备数据源（字幕/音频）再生成。 */
  const generate = useCallback(
    async (runId: string, mode: PromptMode, source?: "subtitle" | "audio") => {
      const target = sessionsRef.current.find((s) => s.run_id === runId)
      if (!target || target.status === "preparing") return null

      // 可选：重新准备数据源（覆盖 transcript）
      if (source) {
        patchSession(runId, { status: "preparing", stage: "detect" })
        try {
          const prepared = await runPrepare(
            {
              url: target.url,
              cookie: config.cookie.trim() || null,
              stt_language: config.sttLanguage,
              stt_model: config.sttModel,
              run_id: runId,
              source
            },
            (stage) => {
              setSessions((prev) =>
                prev.map((s) => (s.run_id === runId && s.status === "preparing" ? { ...s, stage } : s))
              )
            }
          )
          // 覆盖结构化 transcript（供懒生成恢复）
          await writeTextFile(
            `${target.outputDir}/transcript_${runId}.json`,
            JSON.stringify({ segments: prepared.transcript.segments, source: prepared.transcript.source })
          )
          patchSession(runId, {
            status: "ready",
            stage: null,
            transcript_source: prepared.transcript.source
          })
        } catch (err) {
          patchSession(runId, { status: "ready", stage: null })
          const message = err instanceof Error ? err.message : String(err)
          patchMode(runId, mode, { status: "error", error: message, finishedAt: Date.now() })
          return null
        }
      }

      const targetReady = sessionsRef.current.find((s) => s.run_id === runId)
      if (!targetReady || targetReady.status !== "ready") return null
      return runGenerateMode(targetReady, mode)
    },
    [config, patchMode, patchSession, runGenerateMode]
  )

  /** 取消单模式生成。 */
  const cancelMode = useCallback(
    async (runId: string, mode: PromptMode) => {
      patchMode(runId, mode, { status: "error", error: "已取消", finishedAt: Date.now() })
      try {
        await killExternal(`${runId}:${mode}`)
      } catch {
        // 进程可能已结束
      }
    },
    [patchMode]
  )

  /** 整体取消（字幕准备中）。 */
  const cancel = useCallback(
    async (runId: string) => {
      patchSession(runId, { status: "cancelled", finishedAt: Date.now(), stage: null })
      try {
        await killExternal(runId)
      } catch {
        // 忽略
      }
    },
    [patchSession]
  )

  /** 删除 session（含产物目录）；删除失败时抛错由 UI 层提示。 */
  const remove = useCallback(async (runId: string) => {
    const target = sessionsRef.current.find((s) => s.run_id === runId)
    setSessions((prev) => prev.filter((s) => s.run_id !== runId))
    if (target?.outputDir) {
      await removeDir(target.outputDir)
    }
  }, [])

  return { sessions, start, generate, cancel, cancelMode, remove }
}

export { writeTextFile }
