import { useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"

interface TranscriptSegment {
  start: number
  end: number
  text: string
}

interface SummarizeResult {
  run_id?: string
  title: string
  summary: string
  markdown: string
  html: string
  transcript?: string | null
  transcript_segments?: TranscriptSegment[] | null
  transcript_source?: "subtitle" | "whisper" | "whisper_refined" | null
}

interface UserConfig {
  apiKey: string
  model: string
  baseUrl: string
  prompt: string
  cookie: string
  sttLanguage: "zh-cn" | "en"
  screenshot: boolean
}

const CONFIG_DB_NAME = "siriusx-summary"
const CONFIG_STORE = "user-config"

function safeParseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
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

async function openConfigDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveConfig(config: UserConfig) {
  const db = await openConfigDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readwrite")
    tx.objectStore(CONFIG_STORE).put(config, "active")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadConfig(): Promise<UserConfig | null> {
  const db = await openConfigDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readonly")
    const request = tx.objectStore(CONFIG_STORE).get("active")
    request.onsuccess = () => resolve((request.result as UserConfig) || null)
    request.onerror = () => reject(request.error)
  })
}

const DEFAULT_PROMPT =
  "你是一位擅长整理视频的助手。请根据以下内容生成结构化总结，并保留关键时间戳。\n\n标题：{{title}}\n\n字幕：\n{{transcript}}\n\n输出要求：\n- 输出 Markdown\n- 先给 1 句高密度摘要（40-60 字）\n- 再给 3-5 条要点列表，每条附带时间戳（如 01:23）\n- 单独输出“字幕摘录”小节，用项目符号逐条列出需要引用的字幕内容\n- 字幕内容必须转换为简体中文（若原字幕为繁体或混杂语言，先转为简体再输出）\n- 最后给 1 段 200-400 字的完整总结\n- 全部使用简体中文\n"

function App() {
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [cookie, setCookie] = useState("")
  const [sttLanguage, setSttLanguage] = useState<"zh-cn" | "en">("zh-cn")
  const [screenshot, setScreenshot] = useState(false)
  const [result, setResult] = useState<SummarizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [configReady, setConfigReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    let isActive = true
    loadConfig()
      .then((config) => {
        if (!isActive) {
          return
        }
        if (!config) {
          setConfigReady(true)
          return
        }
        setApiKey(config.apiKey)
        setModel(config.model)
        setBaseUrl(config.baseUrl)
        setPrompt(config.prompt || DEFAULT_PROMPT)
        setCookie(config.cookie || "")
        setSttLanguage(config.sttLanguage || "zh-cn")
        setScreenshot(Boolean(config.screenshot))
        setConfigReady(true)
      })
      .catch(() => {
        if (isActive) {
          setConfigReady(true)
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!configReady) {
      return
    }
    const config: UserConfig = {
      apiKey,
      model,
      baseUrl,
      prompt,
      cookie,
      sttLanguage,
      screenshot
    }
    saveConfig(config).catch(() => {})
  }, [apiKey, model, baseUrl, prompt, cookie, sttLanguage, screenshot, configReady])

  const apiBase = useMemo(() => {
    const envBase = import.meta.env.VITE_API_BASE
    return envBase ? envBase.replace(/\/$/, "") : "http://localhost:8787"
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setResult(null)

    if (!url.trim()) {
      setError("请输入视频链接")
      return
    }
    if (!apiKey.trim()) {
      setError("请输入大模型 API Key")
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
          body: JSON.stringify({
            url,
            api_key: apiKey,
            model: model || null,
            base_url: baseUrl || null,
            prompt: prompt || null,
            cookie: cookie || null,
            stt_language: sttLanguage,
            refine_transcript: true,
            screenshot
          })
        })

      const rawText = await response.text()
      const payload = rawText ? safeParseJson(rawText) : null
      if (!response.ok) {
        const message = (payload && typeof payload === "object" && "message" in payload)
          ? String(payload.message)
          : rawText || "请求失败"
        throw new Error(message)
      }

      if (!payload || typeof payload !== "object") {
        throw new Error("服务端响应格式异常")
      }

      setResult(payload as SummarizeResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : "请求失败"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!result) {
      return
    }
    await navigator.clipboard.writeText(result.markdown)
  }

  const handleOpenOutput = () => {
    if (!result?.run_id) {
      return
    }
    const outputUrl = `${apiBase}/output/${result.run_id}`
    window.open(outputUrl, "_blank", "noopener,noreferrer")
  }

  const handleCopyOutput = async () => {
    if (!result?.run_id) {
      return
    }
    const outputUrl = `${apiBase}/output/${result.run_id}`
    await navigator.clipboard.writeText(outputUrl)
  }

  const handleDownload = () => {
    if (!result) {
      return
    }
    const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${result.title || "bilibili"}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadHtml = () => {
    if (!result) {
      return
    }
    const blob = new Blob([result.html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${result.title || "bilibili"}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="badge">SiriusX Summary</p>
          <h1>B 站 / YouTube 视频 AI 总结</h1>
          <p className="subtitle">输入链接与 API Key，即可生成结构化总结</p>
        </div>
        <button
          className="settings-button"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="打开设置"
        >
          设置
        </button>
      </header>

      <main className="layout">
        <section className="card main-card">
          <form className="form" onSubmit={handleSubmit}>
            <label className="field">
              <span>视频链接</span>
              <input
                type="url"
                placeholder="https://www.bilibili.com/video/BV... 或 https://youtu.be/..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
                spellCheck={false}
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>模型 (可选)</span>
                <input
                  type="text"
                  placeholder="留空使用默认模型"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>转写语言</span>
                <select
                  value={sttLanguage}
                  onChange={(event) => setSttLanguage(event.target.value as "zh-cn" | "en")}
                >
                  <option value="zh-cn">中文（简体）</option>
                  <option value="en">英文</option>
                </select>
              </label>
            </div>

            <label className="field checkbox-field">
              <span>插入截图（可选）</span>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  checked={screenshot}
                  onChange={(event) => setScreenshot(event.target.checked)}
                />
                <span>在笔记中插入截图提示并自动截取图片（需要 ffmpeg）</span>
              </div>
            </label>

            {error ? <p className="error">{error}</p> : null}

            <button className="primary" type="submit" disabled={loading}>
              {loading ? "生成中..." : "生成总结"}
            </button>
          </form>

          <div className="result-card">
            {!result && !loading ? (
              <div className="empty">等待输入视频链接与 API Key</div>
            ) : null}
            {loading ? <div className="empty">正在生成总结，请稍候...</div> : null}
            {result ? (
              <div className="result">
                <h3>{result.title}</h3>
                <p className="summary">{result.summary}</p>
                {result.transcript_source ? (
                  <p className="summary">
                    字幕来源：
                    {result.transcript_source === "subtitle"
                      ? "平台字幕"
                      : result.transcript_source === "whisper_refined"
                        ? "本地 Whisper 转写（模型润色）"
                        : "本地 Whisper 转写"}
                  </p>
                ) : null}
                {result.run_id ? <p className="summary">Run ID：{result.run_id}</p> : null}
                <div className="actions">
                  <button type="button" onClick={handleCopy}>
                    复制 Markdown
                  </button>
                  <button type="button" onClick={handleDownload}>
                    下载 Markdown
                  </button>
                  <button type="button" onClick={handleDownloadHtml}>
                    下载 HTML
                  </button>
                  {result.run_id ? (
                    <>
                      <button type="button" onClick={handleOpenOutput}>
                        打开产物目录
                      </button>
                      <button type="button" onClick={handleCopyOutput}>
                        复制产物链接
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="markdown">
                  <ReactMarkdown>{normalizeTranscriptSection(result.markdown)}</ReactMarkdown>
                </div>
                <details className="transcript">
                  <summary>预览 HTML</summary>
                  <pre>{result.html}</pre>
                </details>
                {result.transcript ? (
                  <details className="transcript">
                    <summary>查看字幕</summary>
                    <pre>{result.transcript}</pre>
                  </details>
                ) : null}
                {result.transcript_segments && result.transcript_segments.length > 0 ? (
                  <details className="transcript">
                    <summary>查看时间戳片段</summary>
                    <pre>
                      {result.transcript_segments
                        .map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.text}`)
                        .join("\n")}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </main>

      {settingsOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>设置</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  placeholder="输入你的 API Key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  required
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>自定义端点 Base URL (可选)</span>
                <input
                  type="text"
                  placeholder="例如 https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>B 站 Cookie (可选)</span>
                <textarea
                  rows={3}
                  placeholder="可填写 cookie 文件路径，或直接粘贴完整 cookie 字符串（自动转成请求头）"
                  value={cookie}
                  onChange={(event) => setCookie(event.target.value)}
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>总结提示词</span>
                <textarea
                  rows={6}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
