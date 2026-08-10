import { useCallback, useEffect, useMemo, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Loader2, Pencil, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ResultPanel } from "@/components/result-panel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { stripMarkdownTitle } from "@/core/render/markdown"
import { buildWhisperAudioName } from "@/core/whisper/audio"
import type { PromptMode } from "@/lib/prompts"
import type { SummarizeResult } from "@/lib/types"
import { describeSessionState, readModeOutput, type SessionMeta } from "@/lib/sessions"
import { pathIsFile } from "@/lib/tauri"

const MODE_LABEL: Record<PromptMode, string> = {
  summary: "摘要",
  fulltext: "全文",
  timestamp: "时间戳",
  custom: "自定义"
}

const TAB_ORDER: PromptMode[] = ["summary", "fulltext", "timestamp", "custom"]

interface ModeResultTabsProps {
  session: SessionMeta
  /** 初始激活的 Tab（来自首页模式卡片选择） */
  initialMode?: PromptMode
  onGenerate: (mode: PromptMode, source?: "subtitle" | "audio") => void
  onCancelMode: (mode: PromptMode) => void
  onEditCustom: () => void
}

/**
 * 结果区：4 个模式 Tab 懒生成。
 * 未生成 → 生成入口；生成中 → 动态文案 + 取消；完成 → ResultPanel + 重新生成；失败 → 重试。
 */
export function ModeResultTabs({
  session,
  initialMode = "summary",
  onGenerate,
  onCancelMode,
  onEditCustom
}: ModeResultTabsProps) {
  const [activeMode, setActiveMode] = useState<PromptMode>(initialMode)
  const [markdown, setMarkdown] = useState<string | null>(null)
  // 音频播放：whisper 产物 .wav（asset 协议加载）
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [audioOpen, setAudioOpen] = useState(false)

  const entry = session.modes[activeMode]

  // active 模式完成后从磁盘读回产物（截图相对路径 → asset 绝对路径，供预览加载）
  useEffect(() => {
    if (entry?.status !== "done") {
      setMarkdown(null)
      return
    }
    let active = true
    const load = async () => {
      const md = (await readModeOutput(session, activeMode)) ?? ""
      const withAbsImages = md.replace(
        /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
        (_m, alt: string, file: string) =>
          `![${alt}](${convertFileSrc(`${session.outputDir}/images/${file}`)})`
      )
      if (active) setMarkdown(withAbsImages)
    }
    void load()
    return () => {
      active = false
    }
  }, [session, activeMode, entry?.status])

  const result: SummarizeResult | null = useMemo(() => {
    if (!markdown) return null
    return {
      run_id: session.run_id,
      title: session.title,
      summary: "",
      markdown
    }
  }, [markdown, session])

  const normalizedMarkdown = useMemo(
    () => (result ? stripMarkdownTitle(result.markdown) : ""),
    [result]
  )

  const handleCopyMarkdown = useCallback(() => {
    if (!result) return
    void navigator.clipboard.writeText(normalizedMarkdown || result.markdown)
  }, [result, normalizedMarkdown])

  const handleDownload = useCallback(
    () => {
      if (!result) return
      void import("@/lib/tauri").then(({ saveFileDialog }) => {
        void saveFileDialog(`${session.title || "bilibili"}.md`, result.markdown)
      })
    },
    [result, session.title]
  )

  // 用系统默认浏览器打开原视频网页
  const handleOpenOriginal = useCallback(() => {
    void import("@/lib/tauri").then(({ openUrl }) => openUrl(session.url))
  }, [session.url])

  const handleOpenOutput = useCallback(() => {
    void import("@/lib/tauri").then(({ openPath }) => openPath(session.outputDir))
  }, [session.outputDir])

  // 播放音频（whisper 产物 .wav；字幕源任务无音频）
  const handlePlayAudio = useCallback(async () => {
    const wavPath = `${session.outputDir}/${buildWhisperAudioName(session.url)}.wav`
    const exists = await pathIsFile(wavPath).catch(() => false)
    if (!exists) {
      toast.info("该任务没有音频文件（可能使用了字幕源）")
      return
    }
    setAudioSrc(convertFileSrc(wavPath))
    setAudioOpen(true)
  }, [session])

  return (
    <>
      <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as PromptMode)} className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
        {TAB_ORDER.map((mode) => {
          const status = session.modes[mode]?.status ?? "pending"
          const active = activeMode === mode
          return (
            <TabsTrigger key={mode} value={mode} className={active ? "" : "text-muted"}>
              {status === "running" && <Loader2 className="mr-1 size-3 animate-spin" />}
              {MODE_LABEL[mode]}
              {status === "done" && <span className="ml-1 size-1.5 rounded-full bg-success" />}
            </TabsTrigger>
          )
        })}
        </TabsList>
      </div>

      {TAB_ORDER.map((mode) => (
        <TabsContent key={mode} value={mode}>
          <ModeBody
            session={session}
            mode={mode}
            result={activeMode === mode ? result : null}
            normalizedMarkdown={activeMode === mode ? normalizedMarkdown : ""}
            onGenerate={() => onGenerate(mode)}
            onCancelMode={() => onCancelMode(mode)}
            onEditCustom={onEditCustom}
            onCopyMarkdown={handleCopyMarkdown}
            onDownload={handleDownload}
            onOpenOriginal={handleOpenOriginal}
            onOpenOutput={handleOpenOutput}
            onPlayAudio={() => void handlePlayAudio()}
            onRerunSource={(source) => void onGenerate(mode, source)}
            subtitleDisabled={false}
          />
        </TabsContent>
      ))}
      </Tabs>

      <AudioDialog open={audioOpen} onOpenChange={setAudioOpen} src={audioSrc} />
    </>
  )
}

function ModeBody({
  session,
  mode,
  result,
  normalizedMarkdown,
  onGenerate,
  onCancelMode,
  onEditCustom,
  onCopyMarkdown,
  onDownload,
  onOpenOriginal,
  onOpenOutput,
  onPlayAudio,
  onRerunSource,
  subtitleDisabled
}: {
  session: SessionMeta
  mode: PromptMode
  result: SummarizeResult | null
  normalizedMarkdown: string
  onGenerate: () => void
  onCancelMode: () => void
  onEditCustom: () => void
  onCopyMarkdown: () => void
  onDownload: () => void
  onOpenOriginal: () => void
  onOpenOutput: () => void
  onPlayAudio: () => void
  onRerunSource: (source: "subtitle" | "audio") => void
  subtitleDisabled: boolean
}) {
  const entry = session.modes[mode]
  const label = MODE_LABEL[mode]

  if (session.status === "preparing") {
    return (
      <div className="glass card-shadow rounded-2xl border border-hairline p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted" />
          <p className="text-sm text-muted">{describeSessionState(session)}</p>
        </div>
      </div>
    )
  }

  if (entry?.status === "running") {
    return (
      <div className="glass card-shadow rounded-2xl border border-hairline p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted" />
          <p className="font-serif text-xl text-ink">{describeSessionState(session)}</p>
          <Button variant="secondary" size="sm" onClick={onCancelMode}>
            <XCircle />
            取消
          </Button>
        </div>
      </div>
    )
  }

  if (entry?.status === "error") {
    return (
      <div className="glass card-shadow rounded-2xl border border-hairline p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-error">{entry.error || "生成失败"}</p>
          <Button variant="secondary" size="sm" onClick={onGenerate}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (entry?.status === "done" && result) {
    return (
      <ResultPanel
        result={result}
        error=""
        loading={false}
        normalizedMarkdown={normalizedMarkdown}
        mode={mode}
        onCopyMarkdown={onCopyMarkdown}
        onDownloadMarkdown={onDownload}
        onOpenOriginal={onOpenOriginal}
        onOpenOutput={onOpenOutput}
        onRerunSource={onRerunSource}
        subtitleDisabled={subtitleDisabled}
        onPlayAudio={onPlayAudio}
      />
    )
  }

  // pending（未生成）
  return (
    <div className="glass card-shadow rounded-2xl border border-hairline p-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted">该模式尚未生成，基于同一份字幕生成{label}。</p>
        <div className="flex items-center gap-2">
          <Button onClick={onGenerate}>生成{label}</Button>
          {mode === "custom" && (
            <Button variant="secondary" onClick={onEditCustom}>
              <Pencil />
              编辑模板
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 音频播放对话框：whisper 产物 .wav 经 asset 协议播放。 */
function AudioDialog({ open, onOpenChange, src }: { open: boolean; onOpenChange: (v: boolean) => void; src: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>播放音频</DialogTitle>
          <DialogDescription>Whisper 转写用音频（产物目录 .wav）。</DialogDescription>
        </DialogHeader>
        {src && <audio controls autoPlay src={src} className="w-full" />}
      </DialogContent>
    </Dialog>
  )
}
