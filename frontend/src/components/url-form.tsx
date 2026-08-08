import { Loader2, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface UrlFormProps {
  variant?: "hero" | "compact"
  url: string
  onUrlChange: (value: string) => void
  onSubmit: () => void
  loading: boolean
  disabled: boolean
}

export function UrlForm({
  variant = "compact",
  url,
  onUrlChange,
  onSubmit,
  loading,
  disabled
}: UrlFormProps) {
  if (variant === "hero") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        className="flex w-full flex-col gap-3"
      >
        {/* 输入框与生成按钮同一行 */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="h-12 rounded-xl border-hairline bg-transparent pl-11 text-base"
              placeholder="粘贴 Bilibili / YouTube 视频 URL"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              disabled={loading}
              aria-label="视频链接"
            />
          </div>
          <SubmitButton loading={loading} disabled={disabled} className="h-12 shrink-0 rounded-xl px-6" />
        </div>
      </form>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="flex w-full flex-wrap items-center gap-2"
    >
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-9 rounded-lg border-hairline bg-transparent pl-9 text-sm"
          placeholder="粘贴 Bilibili / YouTube 视频 URL"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          disabled={loading}
          aria-label="视频链接"
        />
      </div>
      <SubmitButton loading={loading} disabled={disabled} />
    </form>
  )
}

function SubmitButton({
  loading,
  disabled,
  className
}: {
  loading: boolean
  disabled: boolean
  className?: string
}) {
  return (
    <Button type="submit" className={cn("h-9 rounded-lg px-5", className)} disabled={disabled || loading}>
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          生成中…
        </>
      ) : (
        "生成"
      )}
    </Button>
  )
}
