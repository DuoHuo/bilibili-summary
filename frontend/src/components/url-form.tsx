import { Clock, FileText, Loader2, Search, Settings2, Sparkles, SquarePen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PromptMode } from "@/lib/prompts"

interface UrlFormProps {
  url: string
  onUrlChange: (value: string) => void
  onSubmit: () => void
  onOpenSettings: () => void
  loading: boolean
  disabled: boolean
  promptMode: PromptMode
  onPromptModeChange: (mode: PromptMode) => void
  onOpenCustomPrompt: () => void
}

const MODE_OPTIONS: ReadonlyArray<{
  value: PromptMode
  label: string
  icon: typeof Sparkles
}> = [
  { value: "summary", label: "摘要", icon: Sparkles },
  { value: "fulltext", label: "全文", icon: FileText },
  { value: "timestamp", label: "时间戳", icon: Clock }
]

export function UrlForm({
  url,
  onUrlChange,
  onSubmit,
  onOpenSettings,
  loading,
  disabled,
  promptMode,
  onPromptModeChange,
  onOpenCustomPrompt
}: UrlFormProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-md pl-11 text-base"
            placeholder="粘贴 Bilibili / YouTube 视频 URL"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            disabled={loading}
            aria-label="视频链接"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 px-6" disabled={disabled || loading}>
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              生成中…
            </>
          ) : (
            "生成"
          )}
        </Button>
        <Button type="button" variant="secondary" size="lg" className="h-12" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          设置
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-hairline p-0.5">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = promptMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onPromptModeChange(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "text-ink hover:bg-surface-card"
                }`}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            )
          })}
        </div>
        <Button
          type="button"
          variant={promptMode === "custom" ? "primary" : "ghost"}
          size="sm"
          onClick={onOpenCustomPrompt}
        >
          <SquarePen className="size-3.5" />
          自定义模板
        </Button>
      </div>
    </div>
  )
}
