import type { ReactNode } from "react"

import {
  Camera,
  Cookie,
  Globe,
  KeyRound,
  Languages
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { UserConfig } from "@/lib/types"

interface SettingsViewProps {
  config: UserConfig
  onChange: (patch: Partial<UserConfig>) => void
}

export function SettingsView({ config, onChange }: SettingsViewProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16">
      <header className="mb-6 mt-2">
        <h1 className="display-sm text-ink">设置</h1>
        <p className="mt-2 text-sm text-muted">
          配置大模型端点与鉴权。设置自动保存到本地。
        </p>
      </header>

      <div className="glass card-shadow flex flex-col gap-8 rounded-2xl border border-hairline p-8">
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
            <div className="flex items-center gap-1 rounded-lg border border-hairline bg-surface-soft p-1">
              {(["zh-cn", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onChange({ sttLanguage: lang })}
                  className={
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                    (config.sttLanguage === lang
                      ? "bg-surface-cream-strong text-ink"
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
      </div>
    </div>
  )
}

/* ─── Layout primitives ─── */

function Section({
  title,
  icon: Icon,
  children
}: {
  title: string
  icon: typeof KeyRound
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
  icon: typeof KeyRound
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
