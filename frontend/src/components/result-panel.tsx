import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircle,
  ChevronDown,
  ClipboardCopy,
  Download,
  ExternalLink,
  Link2,
  RefreshCw,
  Volume2
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs"
import type { PromptMode } from "@/lib/prompts"
import type { SummarizeResult, TranscriptSource } from "@/lib/types"
import { openUrl } from "@/lib/tauri"

interface ResultPanelProps {
  result: SummarizeResult | null
  error: string
  loading: boolean
  normalizedMarkdown: string
  mode: PromptMode
  onCopyMarkdown: () => void
  onDownloadMarkdown: () => void
  onOpenOriginal: () => void
  onOpenOutput: () => void
  /** 可选：done 态重新生成该模式（选数据源） */
  onRerunSource?: (source: "subtitle" | "audio") => void
  /** 无字幕（transcript_source=whisper）时禁用「由字幕生成」 */
  subtitleDisabled?: boolean
  /** 可选：播放 whisper 音频 */
  onPlayAudio?: () => void
}
const SOURCE_LABEL: Record<NonNullable<TranscriptSource>, string> = {
  subtitle: "官方字幕",
  whisper: "Whisper 转录"
}

export function ResultPanel({
  result,
  error,
  loading,
  normalizedMarkdown,
  mode,
  onCopyMarkdown,
  onDownloadMarkdown,
  onOpenOriginal,
  onOpenOutput,
  onRerunSource,
  subtitleDisabled = false,
  onPlayAudio
}: ResultPanelProps) {
  const source = result?.transcript_source ?? null

  const transcript = useMemo(() => {
    if (!result?.transcript_segments?.length) return null
    return result.transcript_segments
      .map((segment) => {
        const start = formatStamp(segment.start)
        const end = formatStamp(segment.end)
        return `[${start}-${end}] ${segment.text}`
      })
      .join("\n")
  }, [result])

  if (loading && !result) {
    return <LoadingFrame />
  }

  if (error) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="size-8 text-error" />
          <p className="font-serif text-xl text-ink">生成失败</p>
          <p className="max-w-md break-words text-sm text-muted">{error}</p>
        </div>
      </Frame>
    )
  }

  if (!result) {
    return (
      <Frame>
        <EmptyState />
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {source && (
              <Badge variant="coral" className="uppercase">
                {SOURCE_LABEL[source]}
              </Badge>
            )}
          </div>
          <h2 className="display-md text-ink">{result.title || "未命名视频"}</h2>
        </header>

        <Tabs defaultValue="markdown" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="markdown">预览</TabsTrigger>
              {mode === "timestamp" && <TabsTrigger value="transcript">字幕</TabsTrigger>}
              <TabsTrigger value="raw">原文</TabsTrigger>
            </TabsList>

            <div className="flex flex-wrap items-center gap-1">
              {onRerunSource && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <RefreshCw className="size-3.5" />
                      重新生成
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={subtitleDisabled}
                      onClick={() => onRerunSource("subtitle")}
                    >
                      由字幕生成
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRerunSource("audio")}>
                      由音频生成
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="ghost" size="sm" onClick={onCopyMarkdown}>
                <ClipboardCopy className="size-3.5" />
                复制
              </Button>
              <Button variant="ghost" size="sm" onClick={onDownloadMarkdown}>
                <Download className="size-3.5" />
                .md
              </Button>
              {result.run_id && (
                <>
                  <Button variant="ghost" size="sm" onClick={onOpenOriginal}>
                    <ExternalLink className="size-3.5" />
                    原网页
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onOpenOutput}>
                    <Link2 className="size-3.5" />
                    产物
                  </Button>
                  {onPlayAudio && (
                    <Button variant="ghost" size="sm" onClick={onPlayAudio}>
                      <Volume2 className="size-3.5" />
                      播放音频
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <TabsContent value="markdown">
            <article className="prosemic">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // 预览中的链接：用系统默认浏览器打开，不在 WebView 内导航
                  a: ({ href, children, ...props }) => (
                    <a
                      {...props}
                      href={href}
                      onClick={(event) => {
                        event.preventDefault()
                        if (href && /^https?:\/\//.test(href)) void openUrl(href)
                      }}
                    >
                      {children}
                    </a>
                  )
                }}
              >
                {normalizedMarkdown || result.markdown}
              </ReactMarkdown>
            </article>
          </TabsContent>

          {mode === "timestamp" && (
            <TabsContent value="transcript">
              {transcript ? (
                <pre className="overflow-x-auto rounded-lg border border-hairline-soft bg-surface-dark p-5 font-mono text-[13px] leading-relaxed text-on-dark">
                  {transcript}
                </pre>
              ) : (
                <p className="text-sm text-muted">无可用字幕。</p>
              )}
            </TabsContent>
          )}

          <TabsContent value="raw">
            <pre className="overflow-x-auto rounded-lg border border-hairline-soft bg-surface-soft p-5 font-mono text-[13px] leading-relaxed text-body">
              {result.markdown}
            </pre>
          </TabsContent>
        </Tabs>

        <Separator />

        <p className="text-xs text-muted-soft">
          产物已保存到本地目录（.md / .txt / 音频 / 截图），点击上方「产物」打开。
        </p>
      </div>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="w-full">
      <div className="raised-card p-6">
        {children}
      </div>
    </section>
  )
}

function LoadingFrame() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="size-3 animate-pulse rounded-full bg-primary" />
        <p className="font-serif text-xl text-ink">正在生成摘要…</p>
        <p className="text-sm text-muted">
          抓取字幕 → 调用模型 → 组装结果，通常 10-60 秒。
        </p>
      </div>
    </Frame>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="size-12 rounded-full border border-hairline bg-surface-soft" />
      <p className="font-serif text-xl text-ink">还没有摘要</p>
      <p className="max-w-md text-sm text-muted">
        粘贴视频链接、点击「生成摘要」即可。首次使用请先在「设置」中填入 API Key。
      </p>
    </div>
  )
}

function formatStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = String(Math.floor(total / 60)).padStart(2, "0")
  const secondsPart = String(total % 60).padStart(2, "0")
  return `${minutes}:${secondsPart}`
}
