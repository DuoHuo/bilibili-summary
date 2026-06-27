import { useEffect, type ReactNode } from "react"
import {
  Camera,
  Cookie,
  Globe,
  KeyRound,
  Languages,
  Sparkles,
  SquarePen
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  resolvePrompt,
  type PromptMode
} from "@/lib/prompts"
import type { UserConfig } from "@/lib/types"

interface SettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: UserConfig
  onChange: (patch: Partial<UserConfig>) => void
}

const PROMPT_MODE_OPTIONS: ReadonlyArray<{
  value: PromptMode
  label: string
  hint: string
  icon: typeof Sparkles
}> = [
  {
    value: "summary",
    label: "总结模式",
    hint: "结构化要点 + 完整总结段落",
    icon: Sparkles
  },
  {
    value: "custom",
    label: "自定义",
    hint: "下方自由编辑模板",
    icon: SquarePen
  }
]

export function SettingsPanel({
  open,
  onOpenChange,
  config,
  onChange
}: SettingsPanelProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-8 sm:max-w-2xl md:p-10">
        <DialogHeader>
          <DialogTitle>模型与抓取设置</DialogTitle>
          <DialogDescription>
            配置大模型端点、鉴权与提示词模板。设置自动保存到本地。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-8">
          {/* ── 鉴权 ── */}
          <Section title="鉴权" icon={KeyRound}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apiKey">
                API Key <span className="text-primary">*</span>
              </Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                value={config.apiKey}
                onChange={(event) => onChange({ apiKey: event.target.value })}
              />
              <p className="text-xs text-muted">
                OpenAI 兼容密钥，仅在本地保存，不上传服务器。
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  spellCheck={false}
                  placeholder="https://api.openai.com/v1"
                  value={config.baseUrl}
                  onChange={(event) =>
                    onChange({ baseUrl: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model">模型</Label>
                <Input
                  id="model"
                  spellCheck={false}
                  placeholder="gpt-4o-mini"
                  value={config.model}
                  onChange={(event) => onChange({ model: event.target.value })}
                />
              </div>
            </div>
          </Section>

          {/* ── 字幕抓取 ── */}
          <Section title="字幕抓取" icon={Globe}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cookie" className="flex items-center gap-1.5">
                <Cookie className="size-3.5 text-muted" />
                B 站 / YouTube Cookie（可选）
              </Label>
              <Textarea
                id="cookie"
                rows={3}
                spellCheck={false}
                placeholder="粘贴完整 cookie 字符串，或填写本地 cookie 文件路径"
                value={config.cookie}
                onChange={(event) => onChange({ cookie: event.target.value })}
              />
              <p className="text-xs text-muted">
                含 "=" 与 ";" 时按请求头发送，否则按文件路径读取。用于抓取会员视频字幕。
              </p>
            </div>

            <ToggleRow
              label="Whisper 语言"
              description="无字幕时本地转录使用的语言。"
              icon={Languages}
            >
              <div className="flex items-center gap-1 rounded-md bg-surface-soft p-1">
                {(["zh-cn", "en"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => onChange({ sttLanguage: lang })}
                    className={
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                      (config.sttLanguage === lang
                        ? "bg-canvas text-ink shadow-sm"
                        : "text-muted")
                    }
                  >
                    {lang === "zh-cn" ? "中文" : "English"}
                  </button>
                ))}
              </div>
            </ToggleRow>

            <ToggleRow
              label="截图标注"
              description="让 LLM 插入时间戳截图标记，由 ffmpeg 抽帧。"
              icon={Camera}
            >
              <Switch
                id="screenshot"
                checked={config.screenshot}
                onCheckedChange={(checked) =>
                  onChange({ screenshot: checked })
                }
              />
            </ToggleRow>
          </Section>

          {/* ── 提示词模板 ── */}
          <Section title="提示词模板" icon={SquarePen}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PROMPT_MODE_OPTIONS.map((option) => {
                const selected = config.promptMode === option.value
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange({ promptMode: option.value })}
                    className={
                      "group flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all " +
                      (selected
                        ? "border-primary bg-surface-card shadow-sm"
                        : "border-hairline bg-canvas hover:border-muted-soft hover:bg-surface-soft")
                    }
                    aria-pressed={selected}
                  >
                    <Icon
                      className={
                        "size-4 transition-colors " +
                        (selected ? "text-primary" : "text-muted")
                      }
                    />
                    <span className="text-sm font-medium text-ink">
                      {option.label}
                    </span>
                    <span className="text-[11px] leading-snug text-muted">
                      {option.hint}
                    </span>
                  </button>
                )
              })}
            </div>

            {config.promptMode === "custom" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt">自定义提示词</Label>
                <Textarea
                  id="prompt"
                  rows={10}
                  spellCheck={false}
                  className="font-mono text-[13px] leading-relaxed"
                  value={config.prompt}
                  onChange={(event) =>
                    onChange({ prompt: event.target.value })
                  }
                />
                <p className="text-xs text-muted">
                  支持{" "}
                  <code className="rounded bg-surface-card px-1 py-0.5 text-ink">
                    {"{{title}}"}
                  </code>{" "}
                  与{" "}
                  <code className="rounded bg-surface-card px-1 py-0.5 text-ink">
                    {"{{transcript}}"}
                  </code>{" "}
                  模板变量。
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-muted">
                  <span>
                    {config.promptMode === "summary"
                      ? "总结模式"
                      : config.promptMode === "fulltext"
                        ? "全文模式"
                        : "校对模式"}{" "}
                    · 内置模板（只读）
                  </span>
                </Label>
                <Textarea
                  rows={10}
                  spellCheck={false}
                  readOnly
                  className="bg-surface-soft font-mono text-[13px] leading-relaxed text-muted"
                  value={resolvePrompt(config.promptMode, config.prompt)}
                />
                <p className="text-xs text-muted">
                  切到「自定义」可基于此模板修改。
                </p>
              </div>
            )}
          </Section>

          <div className="flex justify-end pt-1">
            <Button type="button" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Layout primitives ─── */

function Section({
  title,
  icon: Icon,
  children
}: {
  title: string
  icon: typeof Sparkles
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Icon className="size-3.5 text-muted-soft" />
        <span className="caption-uppercase text-muted-soft">{title}</span>
        <div className="h-px flex-1 bg-hairline" />
      </div>
      {children}
    </section>
  )
}

function ToggleRow({
  label,
  description,
  icon: Icon,
  children
}: {
  label: string
  description: string
  icon: typeof Sparkles
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted" />
          {label}
        </Label>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {children}
    </div>
  )
}
