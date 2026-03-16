import { useEffect, useMemo, useState } from "react"

interface TranscriptSegment {
  start: number
  end: number
  text: string
}

interface SummarizeResult {
  title: string
  summary: string
  markdown: string
  html: string
  transcript?: string | null
  transcript_segments?: TranscriptSegment[] | null
  transcript_source?: "subtitle" | "whisper" | null
}

interface UserConfig {
  apiKey: string
  model: string
  baseUrl: string
  prompt: string
  cookie: string
  sttLanguage: "zh-cn" | "en"
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
  "你是一位擅长整理视频的助手。请根据以下内容生成一份结构化总结，并保留关键时间戳：\n\n标题：{{title}}\n\n字幕：\n{{transcript}}\n\n总结要求：\n1. 200-400 字\n2. 列出 3-5 个关键要点\n3. 保留关键时间戳（如 01:23）\n4. 用中文输出\n"

function App() {
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [cookie, setCookie] = useState("")
  const [sttLanguage, setSttLanguage] = useState<"zh-cn" | "en">("zh-cn")
  const [result, setResult] = useState<SummarizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [configReady, setConfigReady] = useState(false)

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
      sttLanguage
    }
    saveConfig(config).catch(() => {})
  }, [apiKey, model, baseUrl, prompt, cookie, sttLanguage, configReady])

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
          refine_transcript: true
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
      </header>

      <main className="layout">
        <section className="card">
          <h2>基础配置</h2>
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

            {error ? <p className="error">{error}</p> : null}

            <button className="primary" type="submit" disabled={loading}>
              {loading ? "生成中..." : "生成总结"}
            </button>
          </form>
        </section>

        <section className="card">
          <h2>生成结果</h2>
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
                  字幕来源：{result.transcript_source === "subtitle" ? "平台字幕" : "本地 Whisper 转写"}
                </p>
              ) : null}
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
              </div>
              <pre className="markdown">{result.markdown}</pre>
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
        </section>
      </main>
    </div>
  )
}

export default App
