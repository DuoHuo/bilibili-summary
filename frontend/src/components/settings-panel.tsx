import { useCallback, useEffect, useState, type ReactNode } from "react"

import {
  AudioLines,
  Camera,
  CheckCircle2,
  Cookie,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  PlugZap,
  RefreshCw,
  Sparkles,
  UserRound,
  Wrench
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { BiliProfile, UserConfig } from "@/lib/types"
import type { ProbeResult } from "@/lib/llmProbe"
import { STT_MODELS } from "@/lib/stt-models"
import { checkExternalBinary, checkWhisperModel, ensureExternalBinary, ensureWhisperModel, openUrl } from "@/lib/tauri"
import type { UpdateInfo } from "@/lib/updater"

export type SettingsTab = "account" | "model" | "processing" | "engine"

interface SettingsViewProps {
  config: UserConfig
  onChange: (patch: Partial<UserConfig>) => void
  profile: BiliProfile | null
  onLogin: () => void
  onLogout: () => void
  /** 初始激活的 Tab（App 引导场景，如未填 API Key 定位到「模型」）；默认「账号」。 */
  initialTab?: SettingsTab
  /** 测试 LLM 连接（由 App 注入，使用当前配置） */
  onTestConnection: () => Promise<ProbeResult>
  /** 检查更新结果；hasUpdate=true 时设置页出现下载按钮 */
  updateInfo?: UpdateInfo | null
}

export function SettingsView({
  config,
  onChange,
  profile,
  onLogin,
  onLogout,
  initialTab = "account",
  onTestConnection,
  updateInfo
}: SettingsViewProps) {
  const [testing, setTesting] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    setProbeResult(null)
    try {
      setProbeResult(await onTestConnection())
    } finally {
      setTesting(false)
    }
  }

  // 设置页右上角「下载新版本」按钮：仅当启动后台检查到新 release 时显示
  const releaseUrl = updateInfo?.hasUpdate ? updateInfo.htmlUrl : null
  const releaseVersion = updateInfo?.hasUpdate ? updateInfo.latestVersion : null

  return (
    // 水平居中，垂直顶部对齐：垂直居中会因各 Tab 内容高度不同而忽上忽下
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-6">
        <h1 className="display-sm text-ink">设置</h1>
      </header>

      <Tabs defaultValue={initialTab}>
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="account">账号</TabsTrigger>
            <TabsTrigger value="model">模型</TabsTrigger>
            <TabsTrigger value="processing">内容处理</TabsTrigger>
            <TabsTrigger value="engine">引擎</TabsTrigger>
          </TabsList>
          {releaseUrl ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openUrl(releaseUrl)}
            >
              <Download className="size-3.5" />
              下载 v{releaseVersion}
            </Button>
          ) : null}
        </div>

        <TabsContent value="account">
          <div className="raised-card flex flex-col gap-8 p-8">
            <Section title="B 站账号" icon={UserRound}>
              {profile ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-ink">@{profile.name}</span>
                    <span className="text-xs text-muted">UID {profile.uid}</span>
                  </div>
                  <Button variant="secondary" onClick={onLogout}>
                    <LogOut />
                    退出登录
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-muted">
                    使用 B 站账号登录，自动填充下方 Cookie，解锁会员视频字幕抓取。
                  </p>
                  <Button onClick={onLogin}>
                    <UserRound />
                    登录 B 站账号
                  </Button>
                </div>
              )}
            </Section>

            <Section title="Cookie" icon={Cookie}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cookie" className="flex items-center gap-1.5">
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
              </div>
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="model">
          <div className="raised-card flex flex-col gap-8 p-8">
            <Section title="AI" icon={Sparkles}>
              <FieldGroup>
                <FieldRow htmlFor="baseUrl" label="Base URL">
                  <Input
                    id="baseUrl"
                    spellCheck={false}
                    placeholder="https://api.openai.com/v1"
                    value={config.baseUrl}
                    onChange={(event) => onChange({ baseUrl: event.target.value })}
                    className={FIELD_INPUT}
                  />
                </FieldRow>
                <FieldRow htmlFor="apiKey" label="API Key" required>
                  <div className="relative w-full">
                    <Input
                      id="apiKey"
                      type={showApiKey ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-…"
                      value={config.apiKey}
                      onChange={(event) => onChange({ apiKey: event.target.value })}
                      className={`${FIELD_INPUT} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-soft transition-colors hover:text-ink"
                    >
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </FieldRow>
                <FieldRow htmlFor="model" label="模型">
                  <Input
                    id="model"
                    spellCheck={false}
                    placeholder="gpt-4o-mini"
                    value={config.model}
                    onChange={(event) => onChange({ model: event.target.value })}
                    className={FIELD_INPUT}
                  />
                </FieldRow>

                {/* 动作行：与被校验的字段同属一个容器，而非游离在外 */}
                <div className="flex items-center justify-between gap-3 bg-surface-soft px-4 py-2.5">
                  <span
                    className={`min-w-0 truncate text-xs ${
                      probeResult
                        ? probeResult.ok
                          ? "text-success"
                          : "text-error"
                        : "text-muted-soft"
                    }`}
                  >
                    {probeResult ? probeResult.message : "填好后可验证端点连通性"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted hover:text-ink"
                    onClick={() => void handleTest()}
                    disabled={testing}
                  >
                    {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
                    测试连接
                  </Button>
                </div>
              </FieldGroup>
            </Section>

            <SttModelsTab config={config} onChange={onChange} />
          </div>
        </TabsContent>

        <TabsContent value="processing">
          <div className="raised-card flex flex-col gap-8 p-8">
            <Section title="转写与生成" icon={Globe}>
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
                  onCheckedChange={(checked) => onChange({ screenshot: checked })}
                />
              </ToggleRow>
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="engine">
          <div className="raised-card flex flex-col gap-8 p-8">
            <EngineTab config={config} onChange={onChange} />
          </div>
        </TabsContent>
      </Tabs>
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

/** 分组字段容器：多个字段共用一圈描边，内部用发丝线分隔（macOS 系统设置风格）。
 *  bg-canvas 比外层 raised-card 更暗，整组读作下沉的字段井。 */
function FieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-hairline-soft overflow-hidden rounded-xl border border-hairline bg-canvas">
      {children}
    </div>
  )
}

/** 字段行：左侧固定宽标签 + 右侧无边框输入。焦点反馈由整行底色提供。 */
function FieldRow({
  htmlFor,
  label,
  required,
  children
}: {
  htmlFor: string
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-4 px-4 transition-colors focus-within:bg-surface-soft">
      <Label htmlFor={htmlFor} className="w-[92px] shrink-0 text-muted">
        {label}
        {required && <span className="ml-0.5 text-primary">*</span>}
      </Label>
      {children}
    </div>
  )
}

/** 分组字段内的无边框输入样式（抹除 Input 自带的框、底色、焦点环）。 */
const FIELD_INPUT =
  "h-12 border-0 bg-transparent px-0 text-sm focus-visible:border-0 focus-visible:ring-0"

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

/** 引擎检测：项目所需外部二进制（非模型）——手动路径 / 检测 / 按需下载。 */
const ENGINE_BINARIES: ReadonlyArray<{ program: string; label: string; description: string }> = [
  { program: "yt-dlp", label: "yt-dlp", description: "视频 / 音频下载" },
  { program: "ffmpeg", label: "ffmpeg", description: "音频转码 / 截图抽帧" },
  { program: "whisper-cli", label: "whisper-cli", description: "本地语音转写" }
]

interface EngineState {
  available: boolean
  path: string | null
  error: string | null
  checking: boolean
  downloading: boolean
}

function EngineTab({ config, onChange }: { config: UserConfig; onChange: (patch: Partial<UserConfig>) => void }) {
  const [states, setStates] = useState<Partial<Record<string, EngineState>>>({})

  const checkOne = useCallback(
    async (program: string) => {
      setStates((prev) => ({ ...prev, [program]: { ...prev[program], checking: true } as EngineState }))
      const res = await checkExternalBinary(program, config.binaryPaths?.[program])
      setStates((prev) => ({
        ...prev,
        [program]: { available: res.available, path: res.path, error: res.error, checking: false, downloading: false }
      }))
    },
    [config.binaryPaths]
  )

  // 进入时全量检测
  useEffect(() => {
    for (const b of ENGINE_BINARIES) void checkOne(b.program)
  }, [checkOne])

  const handleDownload = useCallback(
    async (program: string) => {
      setStates((prev) => ({ ...prev, [program]: { ...prev[program], downloading: true } as EngineState }))
      try {
        const path = await ensureExternalBinary(program)
        // 下载成功：清除手动路径覆盖，使用自动定位
        onChange({ binaryPaths: { ...config.binaryPaths, [program]: "" } })
        toast.success(`${program} 已就绪`, { description: path })
      } catch (err) {
        toast.error(`${program} 下载失败`, { description: err instanceof Error ? err.message : String(err) })
      } finally {
        await checkOne(program)
      }
    },
    [checkOne, config.binaryPaths, onChange]
  )

  return (
    <Section title="引擎" icon={Wrench}>
      {ENGINE_BINARIES.map((bin) => {
        const state = states[bin.program]
        const customPath = config.binaryPaths?.[bin.program] ?? ""
        return (
          <div key={bin.program} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {state?.checking ? (
                <Loader2 className="size-3.5 animate-spin text-muted" />
              ) : state?.available ? (
                <CheckCircle2 className="size-3.5 text-success" />
              ) : (
                <span className="size-3.5 rounded-full bg-error/70" />
              )}
              <span className="text-sm font-medium text-ink">{bin.label}</span>
              <span className="text-xs text-muted-soft">{bin.description}</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 flex-1 text-xs"
                placeholder={
                  state?.checking
                    ? "检测中…"
                    : state?.available && state?.path
                      ? state.path
                      : state?.error || "留空自动检测；或输入自定义路径"
                }
                spellCheck={false}
                value={customPath}
                onChange={(e) => onChange({ binaryPaths: { ...config.binaryPaths, [bin.program]: e.target.value } })}
              />
              <Button variant="secondary" size="sm" onClick={() => void checkOne(bin.program)} disabled={state?.checking}>
                {state?.checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                检测
              </Button>
              <Button size="sm" onClick={() => void handleDownload(bin.program)} disabled={state?.downloading}>
                {state?.downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                下载
              </Button>
            </div>
          </div>
        )
      })}
    </Section>
  )
}

/** STT 模型管理：选择 + 大小标注 + 状态 + 按需下载。 */
function SttModelsTab({ config, onChange }: { config: UserConfig; onChange: (patch: Partial<UserConfig>) => void }) {
  const [states, setStates] = useState<Partial<Record<string, { available: boolean; checking: boolean; downloading: boolean }>>>({})

  const refresh = useCallback(async () => {
    for (const m of STT_MODELS) {
      setStates((prev) => ({ ...prev, [m.id]: { ...prev[m.id], checking: true } as never }))
      const available = await checkWhisperModel(m.id).catch(() => false)
      setStates((prev) => ({ ...prev, [m.id]: { available, checking: false, downloading: false } }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleDownload = useCallback(
    async (modelId: string) => {
      setStates((prev) => ({ ...prev, [modelId]: { ...prev[modelId], downloading: true } as never }))
      try {
        await ensureWhisperModel(modelId)
        toast.success(`模型 ${modelId} 下载完成`)
      } catch (err) {
        toast.error(`模型 ${modelId} 下载失败`, { description: err instanceof Error ? err.message : String(err) })
      } finally {
        await refresh()
      }
    },
    [refresh]
  )

  return (
    <Section title="语音转写 (STT)" icon={AudioLines}>
      <FieldGroup>
        {STT_MODELS.map((m) => {
          const st = states[m.id]
          const selected = config.sttModel === m.id
          return (
            <div
              key={m.id}
              className={`flex items-stretch transition-colors ${
                selected ? "bg-surface-card" : "hover:bg-surface-soft"
              }`}
            >
              {/* 选择区：占满剩余宽度，与下载按钮互不嵌套（button 不可嵌套） */}
              <button
                type="button"
                onClick={() => onChange({ sttModel: m.id })}
                aria-pressed={selected}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
              >
                {/* 选中指示：实心圆环，未选中仅留描边 */}
                <span
                  className={`size-3.5 shrink-0 rounded-full border-2 transition-colors ${
                    selected ? "border-primary bg-primary/30" : "border-hairline"
                  }`}
                />
                <span className="w-[76px] shrink-0 text-sm font-medium text-ink">{m.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-soft">
                  {m.size} · {m.description}
                </span>
              </button>

              {/* 右侧状态位：撑满行高后内部居中，使对勾 / 转圈 / 下载按钮 三种不同高度的元素基线一致 */}
              <div className="flex w-[104px] shrink-0 items-center justify-end self-stretch pr-4">
                {st?.checking ? (
                  <Loader2 className="size-3.5 animate-spin text-muted" />
                ) : st?.available ? (
                  <CheckCircle2 className="size-3.5 text-success" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted hover:text-ink"
                    disabled={st?.downloading}
                    onClick={() => void handleDownload(m.id)}
                  >
                    {st?.downloading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    下载
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </FieldGroup>
    </Section>
  )
}
