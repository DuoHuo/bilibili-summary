import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Clock,
  FileText,
  Home,
  Settings2,
  Sparkles,
  SquarePen
} from "lucide-react"
import { toast, Toaster } from "sonner"

import { CustomPromptDialog } from "@/components/custom-prompt-dialog"
import { ResultPanel } from "@/components/result-panel"
import { SettingsView } from "@/components/settings-panel"
import { SpikeMark } from "@/components/spike-mark"
import { UrlForm } from "@/components/url-form"
import { postSummarize, SummarizeError, type SummarizePayload } from "@/lib/api"
import { loadConfig, saveConfig } from "@/lib/config"
import { LEGACY_PROMPT, resolvePrompt, type PromptMode } from "@/lib/prompts"
import type { SummarizeResult, UserConfig } from "@/lib/types"
import { stripMarkdownTitle } from "@/core/render/markdown"
import { openPath, resolveOutputDir, saveFileDialog } from "@/lib/tauri"

/** macOS Overlay 标题栏需为红绿灯按钮留出左侧空间 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

type View = "home" | "settings"

const MODE_CARDS: ReadonlyArray<{
  value: PromptMode
  label: string
  description: string
  icon: typeof Sparkles
}> = [
  { value: "summary", label: "摘要", description: "一键提炼核心要点", icon: Sparkles },
  { value: "fulltext", label: "全文", description: "完整结构化文稿", icon: FileText },
  { value: "timestamp", label: "时间戳", description: "带时间轴的章节拆解", icon: Clock },
  { value: "custom", label: "自定义", description: "使用自己的提示词模板", icon: SquarePen }
]

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return "夜深了"
  if (hour < 11) return "早上好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

function normalizeTranscriptSection(markdown: string) {
  const timestampPattern = /\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\]/g
  const formatListBlock = (items: string[]) => `\n${items.join("\n")}\n`
  const splitTimestampLine = (line: string) => {
    const matches = Array.from(line.matchAll(/(\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\])\s*([^[]*)/g))
    if (matches.length < 1) {
      return null
    }
    const output: string[] = []
    let lastTimestamp = ""
    matches.forEach((match) => {
      const timestamp = match[1]
      const text = match[2].trim()
      if (timestamp === lastTimestamp && !text) {
        return
      }
      lastTimestamp = timestamp
      output.push(`- ${timestamp} ${text}`.trim())
    })
    return output.filter((item) => item !== "-")
  }
  const normalizeTimestampRepeats = (text: string) => {
    let result = text
    let previous = ""
    const repeatPattern = /(\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\])\s*\1/g
    while (result !== previous) {
      previous = result
      result = result.replace(repeatPattern, "$1")
    }
    return result
  }
  const normalizeLines = (text: string, forceList: boolean) => {
    const lines = text.replace(/\r\n/g, "\n").split("\n")
    const output: string[] = []
    lines.forEach((line) => {
      const trimmed = normalizeTimestampRepeats(line.trim())
      if (!trimmed) {
        return
      }
      if (/^\s*[-*]\s+/.test(trimmed)) {
        output.push(trimmed)
        return
      }
      const listItems = splitTimestampLine(trimmed)
      if (listItems) {
        output.push(...listItems)
        return
      }
      if (forceList) {
        output.push(`- ${trimmed}`)
      } else {
        output.push(trimmed)
      }
    })
    return output.join("\n")
  }

  const headingMatch = markdown.match(/^(#+)\s*字幕摘录\s*$/m)
  if (!headingMatch || headingMatch.index === undefined) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n")
    const normalized = lines
      .map((line) => {
        const normalizedLine = normalizeTimestampRepeats(line)
        const matches = normalizedLine.match(timestampPattern)
        if (matches && matches.length >= 1) {
          const listItems = splitTimestampLine(normalizedLine)
          return listItems ? formatListBlock(listItems) : normalizedLine
        }
        return normalizedLine
      })
      .join("\n")
    return normalized
  }
  const heading = headingMatch[1]
  const startIndex = headingMatch.index
  const sectionStart = startIndex + headingMatch[0].length
  const rest = markdown.slice(sectionStart)
  const nextHeadingRegex = new RegExp(`^#{1,${heading.length}}\\s+`, "m")
  const nextMatch = rest.match(nextHeadingRegex)
  const sectionEnd = nextMatch && nextMatch.index !== undefined
    ? sectionStart + nextMatch.index
    : markdown.length
  const sectionBody = markdown.slice(sectionStart, sectionEnd).trim()
  if (/^\s*[-*]\s+/m.test(sectionBody)) {
    return markdown
  }
  const normalizedBody = normalizeLines(sectionBody, true)
  return `${markdown.slice(0, sectionStart)}\n\n${normalizedBody}\n${markdown.slice(sectionEnd)}`
}

const DEFAULT_CONFIG: UserConfig = {
  apiKey: "",
  model: "",
  baseUrl: "",
  prompt: LEGACY_PROMPT,
  promptMode: "summary",
  cookie: "",
  sttLanguage: "zh-cn",
  screenshot: false
}

function App() {
  const [view, setView] = useState<View>("home")
  const [url, setUrl] = useState("")
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG)
  const [configReady, setConfigReady] = useState(false)
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const [result, setResult] = useState<SummarizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Load persisted config once.
  useEffect(() => {
    let active = true
    loadConfig()
      .then((stored) => {
        if (!active || !stored) return
        setConfig({ ...DEFAULT_CONFIG, ...stored })
      })
      .catch(() => {})
      .finally(() => {
        if (active) setConfigReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Persist config on change.
  useEffect(() => {
    if (!configReady) return
    saveConfig(config).catch(() => {})
  }, [config, configReady])

  // DEV-only：?qa 注入合成结果，便于视觉 QA（生产构建被 tree-shake）。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!new URLSearchParams(window.location.search).has("qa")) return
    setResult({
      run_id: "qa00000001",
      title: "【示例】B站视频标题：TypeScript 与 Tauri 入门",
      summary: "示例",
      markdown: [
        "# 核心摘要",
        "",
        "本视频介绍了 **TypeScript** 与 Tauri 的组合实践，覆盖：",
        "",
        "- 前端单栈：React + Vite 的类型安全",
        "- 桌面能力：yt-dlp / ffmpeg 的 sidecar 调度",
        "- 本地转录：Whisper 端侧运行",
        "",
        "## 亮点",
        "",
        "1. 依赖注入隔离核心层与系统能力",
        "2. GUI 只是薄壳，逻辑可测试",
        "",
        "> 示例数据，仅用于视觉 QA。",
        "",
        "## 字幕摘录",
        "",
        "[00:05-00:12] 今天我们来聊聊 TypeScript 与 Tauri。",
        "[00:15-00:30] GUI 只是薄壳，核心逻辑在 TS 核心层。"
      ].join("\n"),
      html: "<p>qa</p>",
      transcript_segments: [
        { start: 5, end: 12, text: "大家好，欢迎收看本期视频。" },
        { start: 15, end: 30, text: "今天我们来聊聊 TypeScript 与 Tauri。" }
      ],
      transcript_source: "subtitle"
    })
  }, [])

  const patchConfig = useCallback((patch: Partial<UserConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  const normalizedMarkdown = useMemo(
    () =>
      result
        ? normalizeTranscriptSection(stripMarkdownTitle(result.markdown))
        : "",
    [result]
  )

  const handleSubmit = useCallback(async () => {
    setError("")
    setResult(null)

    if (!url.trim()) {
      setError("请输入视频链接")
      return
    }
    if (!config.apiKey.trim()) {
      setError("请先在「设置」中填入 API Key")
      setView("settings")
      return
    }

    const payload: SummarizePayload = {
      url: url.trim(),
      api_key: config.apiKey.trim(),
      model: config.model.trim() || null,
      base_url: config.baseUrl.trim() || null,
      prompt: resolvePrompt(config.promptMode, config.prompt) || null,
      cookie: config.cookie.trim() || null,
      stt_language: config.sttLanguage,
      screenshot: config.screenshot,
      mode: config.promptMode
    }

    setLoading(true)
    try {
      const data = await postSummarize("", payload)
      setResult(data)
      toast.success("摘要生成完成", {
        description: data.title || undefined
      })
    } catch (err) {
      const message =
        err instanceof SummarizeError || err instanceof Error
          ? err.message
          : "请求失败"
      setError(message)
      toast.error("生成失败", { description: message })
    } finally {
      setLoading(false)
    }
  }, [config, url])

  const handleCopyMarkdown = useCallback(async () => {
    if (!result) return
    await navigator.clipboard.writeText(
      normalizedMarkdown || result.markdown
    )
    toast.success("已复制 Markdown 到剪贴板")
  }, [normalizedMarkdown, result])

  const handleDownload = useCallback(
    async (kind: "markdown" | "html") => {
      if (!result) return
      const isMarkdown = kind === "markdown"
      const content = isMarkdown ? result.markdown : result.html
      const ext = isMarkdown ? "md" : "html"
      const saved = await saveFileDialog(`${result.title || "bilibili"}.${ext}`, content)
      if (saved) {
        toast.success(`已保存 .${ext}`)
      }
    },
    [result]
  )

  const handleOpenOutput = useCallback(async () => {
    if (!result?.run_id) return
    const dir = await resolveOutputDir(result.run_id)
    await openPath(dir)
  }, [result])

  const handleCopyOutput = useCallback(async () => {
    if (!result?.run_id) return
    const dir = await resolveOutputDir(result.run_id)
    await navigator.clipboard.writeText(dir)
    toast.success("已复制产物目录路径")
  }, [result])

  const handleNewSummary = useCallback(() => {
    setView("home")
    setResult(null)
    setError("")
  }, [])

  const handleModeCard = useCallback(
    (mode: PromptMode) => {
      if (mode === "custom") {
        setCustomPromptOpen(true)
        return
      }
      patchConfig({ promptMode: mode })
    },
    [patchConfig]
  )

  const resultPhase = loading || result !== null || error !== ""

  return (
    <div className="relative flex h-screen bg-canvas text-ink">
      {/* 环境光层：玻璃面板在其上折射 */}
      <div aria-hidden className="ambient-bg pointer-events-none absolute inset-0" />

      {/* ── 侧边栏 ── */}
      <aside className="glass-strong relative z-10 flex w-[232px] shrink-0 flex-col border-r border-hairline">
        <div
          data-tauri-drag-region
          className={`h-12 shrink-0 select-none ${isMac ? "pl-[70px]" : ""}`}
        />
        <div data-tauri-drag-region className="flex select-none items-center gap-2 px-5 pb-5">
          <SpikeMark className="size-4 text-ink" />
          <span className="font-serif text-base font-medium tracking-tight text-ink">
            bilibili summary
          </span>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          <SidebarButton
            icon={Home}
            label="新摘要"
            active={view === "home"}
            onClick={handleNewSummary}
          />
          <SidebarButton
            icon={Settings2}
            label="设置"
            active={view === "settings"}
            onClick={() => setView("settings")}
          />
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-5 pb-5 text-xs text-muted-soft">
          <span className="size-1.5 rounded-full bg-success" />
          本地引擎就绪 · v0.1.0
        </div>
      </aside>

      {/* ── 主工作区 ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="h-12 shrink-0 select-none" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === "settings" ? (
            <SettingsView config={config} onChange={patchConfig} />
          ) : resultPhase ? (
            <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 px-6 pb-10">
              <div className="glass card-shadow rounded-2xl border border-hairline p-3">
                <UrlForm
                  variant="compact"
                  url={url}
                  onUrlChange={setUrl}
                  onSubmit={handleSubmit}
                  loading={loading}
                  disabled={!url.trim() || !config.apiKey.trim()}
                  promptMode={config.promptMode}
                  onPromptModeChange={(mode) => patchConfig({ promptMode: mode })}
                  onOpenCustomPrompt={() => setCustomPromptOpen(true)}
                />
              </div>
              <ResultPanel
                result={result}
                error={error}
                loading={loading}
                normalizedMarkdown={normalizedMarkdown}
                mode={config.promptMode}
                onCopyMarkdown={handleCopyMarkdown}
                onDownloadMarkdown={() => handleDownload("markdown")}
                onDownloadHtml={() => handleDownload("html")}
                onOpenOutput={handleOpenOutput}
                onCopyOutput={handleCopyOutput}
              />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-[880px] flex-col items-center px-6 pb-10 pt-[8vh]">
              <h1 className="display-lg text-center text-ink">
                {greeting()}，把链接交给我吧
              </h1>
              <p className="mt-3 text-center text-sm text-muted">
                粘贴视频链接，自动抓取字幕并生成结构化摘要。
              </p>

              <div className="glass card-shadow mt-8 w-full rounded-2xl border border-hairline p-4">
                <UrlForm
                  variant="hero"
                  url={url}
                  onUrlChange={setUrl}
                  onSubmit={handleSubmit}
                  loading={loading}
                  disabled={!url.trim() || !config.apiKey.trim()}
                  promptMode={config.promptMode}
                  onPromptModeChange={(mode) => patchConfig({ promptMode: mode })}
                  onOpenCustomPrompt={() => setCustomPromptOpen(true)}
                />
              </div>

              <div className="mt-4 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {MODE_CARDS.map((card) => {
                  const Icon = card.icon
                  const active =
                    card.value === "custom"
                      ? config.promptMode === "custom"
                      : config.promptMode === card.value
                  return (
                    <button
                      key={card.value}
                      type="button"
                      onClick={() => handleModeCard(card.value)}
                      className={`glass flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? "border-primary/60 bg-surface-card"
                          : "border-hairline hover:bg-surface-soft"
                      }`}
                    >
                      <Icon className={`size-4 ${active ? "text-primary" : "text-muted"}`} />
                      <span className="text-sm font-medium text-ink">{card.label}</span>
                      <span className="text-xs text-muted">{card.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <CustomPromptDialog
        open={customPromptOpen}
        onOpenChange={setCustomPromptOpen}
        value={config.prompt}
        onSave={(value) => patchConfig({ prompt: value, promptMode: "custom" })}
      />

      <Toaster />
    </div>
  )
}

function SidebarButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: typeof Home
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-surface-card text-ink"
          : "text-muted hover:bg-surface-soft hover:text-ink"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}


export default App
