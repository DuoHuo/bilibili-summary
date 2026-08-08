import { useCallback, useEffect, useMemo, useState } from "react"
import { Settings2 } from "lucide-react"
import { toast, Toaster } from "sonner"

import { CustomPromptDialog } from "@/components/custom-prompt-dialog"
import { ResultPanel } from "@/components/result-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { SpikeMark } from "@/components/spike-mark"
import { Button } from "@/components/ui/button"
import { UrlForm } from "@/components/url-form"
import { postSummarize, SummarizeError, type SummarizePayload } from "@/lib/api"
import { loadConfig, saveConfig } from "@/lib/config"
import { LEGACY_PROMPT, resolvePrompt } from "@/lib/prompts"
import type { SummarizeResult, UserConfig } from "@/lib/types"
import { stripMarkdownTitle } from "@/core/render/markdown"
import { openPath, resolveOutputDir, saveFileDialog } from "@/lib/tauri"

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

  return (
    <div className="flex h-screen flex-col bg-canvas">
      {/* 顶部工具栏：紧凑，设置入口在此 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hairline px-4">
        <div className="flex items-center gap-2">
          <SpikeMark className="size-4 text-ink" />
          <span className="font-serif text-base font-medium tracking-tight text-ink">
            Video Summary
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" />
          设置
        </Button>
      </header>

      {/* 输入区：紧凑，不再是大 hero */}
      <div className="shrink-0 border-b border-hairline px-4 py-3">
        <UrlForm
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

      {/* 结果区：占满剩余空间并内部滚动 */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
      </main>

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
