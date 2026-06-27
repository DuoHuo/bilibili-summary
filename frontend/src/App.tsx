import { useCallback, useEffect, useMemo, useState } from "react"
import { toast, Toaster } from "sonner"

import { CustomPromptDialog } from "@/components/custom-prompt-dialog"
import { ResultPanel } from "@/components/result-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { UrlForm } from "@/components/url-form"
import { postSummarize, SummarizeError, type SummarizePayload } from "@/lib/api"
import { loadConfig, saveConfig } from "@/lib/config"
import { LEGACY_PROMPT, resolvePrompt } from "@/lib/prompts"
import type { SummarizeResult, UserConfig } from "@/lib/types"

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
  const [url, setUrl] = useState("")
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG)
  const [configReady, setConfigReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const [result, setResult] = useState<SummarizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const apiBase = useMemo(() => {
    const envBase = import.meta.env.VITE_API_BASE
    return envBase ? envBase.replace(/\/$/, "") : "http://localhost:8787"
  }, [])

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

  const patchConfig = useCallback((patch: Partial<UserConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  const normalizedMarkdown = useMemo(
    () => (result ? normalizeTranscriptSection(result.markdown) : ""),
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
      setSettingsOpen(true)
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
      const data = await postSummarize(apiBase, payload)
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
  }, [apiBase, config, url])

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
      const mime = isMarkdown ? "text/markdown" : "text/html"
      const ext = isMarkdown ? "md" : "html"
      const blob = new Blob([content], { type: `${mime};charset=utf-8` })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = `${result.title || "bilibili"}.${ext}`
      link.click()
      URL.revokeObjectURL(objectUrl)
      toast.success(`已下载 .${ext}`)
    },
    [result]
  )

  const handleOpenOutput = useCallback(() => {
    if (!result?.run_id) return
    window.open(
      `${apiBase}/output/${result.run_id}`,
      "_blank",
      "noopener,noreferrer"
    )
  }, [apiBase, result])

  const handleCopyOutput = useCallback(async () => {
    if (!result?.run_id) return
    await navigator.clipboard.writeText(`${apiBase}/output/${result.run_id}`)
    toast.success("已复制产物链接")
  }, [apiBase, result])

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <section className="mx-auto w-full max-w-[1200px] px-6 pt-20 md:pt-28">
        <div className="flex flex-col items-start gap-6">
          <span className="rounded-full bg-surface-soft px-3 py-1 text-xs font-medium text-ink">
            SiriusX Summary
          </span>
          <h1 className="display-xl text-ink">
            把一段视频，
            <br />
            浓缩成一篇可读的笔记。
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-body">
            粘贴 B 站或 YouTube 链接，自动抓取字幕（必要时本地 Whisper 转录），
            调用大模型生成结构化 Markdown 摘要，可下载、可分享、可归档。
          </p>
        </div>
        <div className="mt-10 md:mt-12">
          <UrlForm
            url={url}
            onUrlChange={setUrl}
            onSubmit={handleSubmit}
            onOpenSettings={() => setSettingsOpen(true)}
            loading={loading}
            disabled={!url.trim() || !config.apiKey.trim()}
            promptMode={config.promptMode}
            onPromptModeChange={(mode) => patchConfig({ promptMode: mode })}
            onOpenCustomPrompt={() => setCustomPromptOpen(true)}
          />
        </div>
      </section>

      <ResultPanel
        result={result}
        error={error}
        loading={loading}
        apiBase={apiBase}
        normalizedMarkdown={normalizedMarkdown}
        mode={config.promptMode}
        onCopyMarkdown={handleCopyMarkdown}
        onDownloadMarkdown={() => handleDownload("markdown")}
        onDownloadHtml={() => handleDownload("html")}
        onOpenOutput={handleOpenOutput}
        onCopyOutput={handleCopyOutput}
      />

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onChange={patchConfig}
      />

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

export default App
