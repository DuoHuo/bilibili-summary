import { useCallback, useEffect, useState } from "react"
import { AudioLines, ChevronDown, Clock, FileText, Home, Settings2, Sparkles, SquarePen, Trash2 } from "lucide-react"
import { toast, Toaster } from "sonner"

import { CustomPromptDialog } from "@/components/custom-prompt-dialog"
import { LoginDialog } from "@/components/login-dialog"
import { ModeResultTabs } from "@/components/mode-result-tabs"
import { SessionList } from "@/components/session-list"
import { SettingsView, type SettingsTab } from "@/components/settings-panel"
import { SpikeMark } from "@/components/spike-mark"
import { UrlForm } from "@/components/url-form"
import { DragRegion } from "@/components/window-drag-region"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { loadConfig, saveConfig } from "@/lib/config"
import { fetchNavInfo, logoutBili } from "@/lib/biliAuth"
import { LEGACY_PROMPT, type PromptMode } from "@/lib/prompts"
import type { BiliProfile, UserConfig } from "@/lib/types"
import { useSessionManager } from "@/lib/sessions"
import { testLlmConnection, type ProbeResult } from "@/lib/llmProbe"
import { DEFAULT_STT_MODEL, findSttModel, STT_MODELS } from "@/lib/stt-models"
import { tauriHttpFetch } from "@/lib/tauri"

/** macOS Overlay 标题栏需为红绿灯按钮留出左侧空间 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
type View = "home" | "settings" | "session"

const MODE_CARDS: ReadonlyArray<{
  value: PromptMode
  label: string
  description: string
  icon: typeof Sparkles
}> = [
  { value: "summary", label: "摘要", description: "一键提炼核心要点", icon: Sparkles },
  { value: "fulltext", label: "全文", description: "完整结构化文稿", icon: FileText },
  { value: "timestamp", label: "时间戳", description: "带时间轴的章节拆解", icon: Clock },
  { value: "custom", label: "自定义", description: "使用自己的提示词模板", icon: SquarePen }
]

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return "夜深了"
  if (hour < 11) return "早上好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

const DEFAULT_CONFIG: UserConfig = {
  apiKey: "",
  model: "",
  baseUrl: "",
  prompt: LEGACY_PROMPT,
  promptMode: "summary",
  cookie: "",
  sttLanguage: "zh-cn",
  screenshot: false,
  biliProfile: null,
  binaryPaths: {},
  sttModel: DEFAULT_STT_MODEL,
  subtitleSource: "audio"
}

function App() {
  const [view, setView] = useState<View>("home")
  const [url, setUrl] = useState("")
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG)
  const [configReady, setConfigReady] = useState(false)
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  // 跳设置时的初始 Tab（如未填 API Key 引导到「模型」）
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("account")
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  // 首页模式卡片选中的模式：决定结果页默认激活的 Tab
  const [selectedMode, setSelectedMode] = useState<PromptMode>("summary")
  // 待确认删除的 session
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const { sessions, start, generate, cancel, cancelMode, remove } = useSessionManager({ config })

  const activeSession =
    activeRunId ? (sessions.find((s) => s.run_id === activeRunId) ?? null) : null

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

  // B 站扫码登录成功：持久化用户信息 + Cookie
  const handleLoginSuccess = useCallback(
    (profile: BiliProfile, cookie: string) => {
      patchConfig({ biliProfile: profile, cookie })
      toast.success("已登录 B 站账号", { description: `@${profile.name}` })
    },
    [patchConfig]
  )

  // 退出登录：服务端会话失效尽力而为，本地必清
  const handleLogout = useCallback(async () => {
    const cookie = config.cookie
    patchConfig({ biliProfile: null, cookie: "" })
    if (cookie) await logoutBili(tauriHttpFetch, cookie)
    toast.success("已退出登录")
  }, [config.cookie, patchConfig])

  // 启动懒校验：仅当 B 站明确判定过期（-101）时清除登录态；服务异常保留 Cookie 供下次重试
  useEffect(() => {
    if (!configReady) return
    if (!config.cookie.trim()) return
    let active = true
    fetchNavInfo(tauriHttpFetch, config.cookie)
      .then((state) => {
        if (!active) return
        if (state.status === "expired") {
          patchConfig({ biliProfile: null, cookie: "" })
          toast.error("B 站登录已过期，请重新登录")
        } else if (state.status === "active" && state.profile && !config.biliProfile) {
          // 登录态有效但本地缺档案：补全（如历史版本升级）
          patchConfig({ biliProfile: state.profile })
        }
        // serviceError：网络/服务异常，保留 Cookie 不打扰
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [configReady, config.cookie, config.biliProfile, patchConfig])

  // 测试 LLM 连接（设置页「模型」Tab）：用当前配置发最小请求
  const handleTestConnection = useCallback(async (): Promise<ProbeResult> => {
    return testLlmConnection(tauriHttpFetch, config.apiKey, config.model, config.baseUrl)
  }, [config.apiKey, config.model, config.baseUrl])

  // 提交 URL：新建任务 → 字幕准备（懒生成各模式在结果 Tab 内触发）
  const handleSubmit = useCallback(async () => {
    if (!url.trim()) {
      toast.error("请输入视频链接")
      return
    }
    if (!config.apiKey.trim()) {
      toast.error("请先在「设置」中填入 API Key")
      setSettingsInitialTab("model")
      setView("settings")
      return
    }
    setUrl("")
    // 自动生成选中模式（字幕准备完成后立即开始）；其他模式懒生成
    const runId = await start(url.trim(), selectedMode)
    if (runId) {
      setActiveRunId(runId)
      setView("session")
    }
  }, [config.apiKey, url, start, selectedMode])

  const handleSelectSession = useCallback((runId: string) => {
    setActiveRunId(runId)
    setView("session")
  }, [])

  // 侧边栏取消：preparing 整体取消；模式生成中取消该模式
  const handleCancelSession = useCallback(
    (runId: string) => {
      const s = sessions.find((x) => x.run_id === runId)
      if (!s) return
      if (s.status === "preparing") {
        void cancel(runId)
        return
      }
      const runningMode = (Object.keys(s.modes) as PromptMode[]).find(
        (m) => s.modes[m]?.status === "running"
      )
      if (runningMode) void cancelMode(runId, runningMode)
    },
    [sessions, cancel, cancelMode]
  )

  const handleRemoveSession = useCallback(
    async (runId: string) => {
      if (runId === activeRunId) {
        setActiveRunId(null)
        setView("home")
      }
      try {
        await remove(runId)
      } catch {
        toast.error("删除失败", { description: "产物目录可能被占用，请稍后重试" })
      }
    },
    [activeRunId, remove]
  )

  // 首页模式卡片：选择结果页默认 Tab；自定义卡片打开模板编辑
  const handleModeCard = useCallback((mode: PromptMode) => {
    if (mode === "custom") {
      setCustomPromptOpen(true)
      return
    }
    setSelectedMode(mode)
  }, [])

  const handleNewSummary = useCallback(() => {
    setView("home")
    setActiveRunId(null)
  }, [])

  // 确认删除：真正执行移除
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    await handleRemoveSession(pendingDelete)
    setPendingDelete(null)
  }, [pendingDelete, handleRemoveSession])

  return (
    <div className="relative flex h-screen bg-canvas text-ink">
      {/* 环境光层：玻璃面板在其上折射 */}
      <div aria-hidden className="ambient-bg pointer-events-none absolute inset-0" />

      {/* ── 侧边栏 ── */}
      <aside className="glass-strong relative z-10 flex w-[232px] shrink-0 flex-col border-r border-hairline">
        <DragRegion className={`h-12 shrink-0 select-none ${isMac ? "pl-[70px]" : ""}`} />
        <DragRegion className="flex select-none items-center gap-2 px-5 pb-5">
          <SpikeMark className="size-4 text-ink" />
          <span className="font-serif text-base font-medium tracking-tight text-ink">
            bilibili summary
          </span>
        </DragRegion>

        <nav className="flex flex-col gap-1 px-3">
          <SidebarButton
            icon={Home}
            label="新任务"
            active={view === "home"}
            onClick={handleNewSummary}
          />
        </nav>

        {/* session 列表：运行中 + 历史平铺 */}
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
          <SessionList
            sessions={sessions}
            activeRunId={activeRunId}
            onSelect={handleSelectSession}
            onCancel={handleCancelSession}
            onRemove={setPendingDelete}
          />
        </div>

        {/* 左下角：设置入口 + 状态行 */}
        <div className="flex shrink-0 flex-col gap-1 border-t border-hairline px-3 pt-2">
          <SidebarButton
            icon={Settings2}
            label="设置"
            active={view === "settings"}
            onClick={() => setView("settings")}
          />
          <div className="flex items-center gap-2 px-5 pb-5 text-xs text-muted-soft">
            <span className="size-1.5 rounded-full bg-success" />
            本地引擎就绪 · v0.1.0
          </div>
        </div>
      </aside>

      {/* ── 主工作区 ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <DragRegion className="h-12 shrink-0 select-none" />

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          {view === "settings" ? (
            <SettingsView
              key={settingsInitialTab}
              config={config}
              onChange={patchConfig}
              profile={config.biliProfile}
              onLogin={() => setLoginOpen(true)}
              onLogout={() => void handleLogout()}
              initialTab={settingsInitialTab}
              onTestConnection={handleTestConnection}
            />
          ) : view === "session" && activeSession ? (
            <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-4">
              <ModeResultTabs
                session={activeSession}
                initialMode={selectedMode}
                onGenerate={(mode, source) => void generate(activeRunId!, mode, source)}
                onCancelMode={(mode) => void cancelMode(activeRunId!, mode)}
                onEditCustom={() => setCustomPromptOpen(true)}
              />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-[880px] flex-col items-center px-6 pb-10 pt-[8vh]">
              <h1 className="display-lg text-center text-ink">
                {greeting()}，把链接交给我吧
              </h1>
              <p className="mt-3 text-center text-sm text-muted">
                粘贴视频链接，自动抓取字幕。四种模式基于同一份字幕按需生成。
              </p>

              <div className="glass card-shadow mt-8 w-full rounded-2xl border border-hairline p-4">
                <UrlForm
                  variant="hero"
                  url={url}
                  onUrlChange={setUrl}
                  onSubmit={handleSubmit}
                  loading={false}
                  disabled={!url.trim() || !config.apiKey.trim()}
                />

                {/* STT 模型选择（无字幕转写用） */}
                <div className="mt-3 flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="sm">
                        <AudioLines className="size-3.5" />
                        转写模型：{findSttModel(config.sttModel).label}
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {STT_MODELS.map((m) => (
                        <DropdownMenuItem key={m.id} onClick={() => patchConfig({ sttModel: m.id })}>
                          {m.label}
                          <span className="ml-1 text-xs text-muted-soft">{m.size}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="sm">
                        <FileText className="size-3.5" />
                        字幕来源：{config.subtitleSource === "audio" ? "音频转写" : "视频网站字幕"}
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => patchConfig({ subtitleSource: "audio" })}>
                        音频转写
                        <span className="ml-1 text-xs text-muted-soft">推荐</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => patchConfig({ subtitleSource: "subtitle" })}>
                        视频网站字幕
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-xs text-muted-soft">
                    无字幕时本地转写用 · {findSttModel(config.sttModel).size}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {MODE_CARDS.map((card) => {
                  const Icon = card.icon
                  const active = selectedMode === card.value
                  return (
                    <button
                      key={card.value}
                      type="button"
                      onClick={() => handleModeCard(card.value)}
                      className={`glass flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? "border-primary/60 bg-surface-card"
                          : "border-hairline hover:bg-surface-soft"
                      }`}
                    >
                      <Icon className={`size-4 ${active ? "text-primary" : "text-muted"}`} />
                      <span className="text-sm font-medium text-ink">{card.label}</span>
                      <span className="text-xs text-muted">{card.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <CustomPromptDialog
        open={customPromptOpen}
        onOpenChange={setCustomPromptOpen}
        value={config.prompt}
        onSave={(value) => patchConfig({ prompt: value, promptMode: "custom" })}
      />

      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        http={tauriHttpFetch}
        onSuccess={handleLoginSuccess}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除任务</DialogTitle>
            <DialogDescription>
              将删除该任务及其全部产物（摘要 / 字幕 / 音频 / 截图目录），此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              <Trash2 />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  )
}

function SidebarButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: typeof Home
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-surface-card text-ink"
          : "text-muted hover:bg-surface-soft hover:text-ink"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}

export default App
