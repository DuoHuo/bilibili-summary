# Design: 结果 Tab 懒生成

## 架构与数据流

```
提交 URL
  │
  ▼
prepareTranscript(input, deps)          ← 只做一次（detect → subtitle/whisper）
  │  落盘: {runDir}/transcript_{id}.txt + 内存返回 {title, transcript}
  ▼
Session ready：结果页 4 Tab（各自状态）
  │
  ├─ 点「摘要」→ generateMode("summary")    ─┐
  ├─ 点「全文」→ generateMode("fulltext")    ├─ 各自独立（llm+render，共享 transcript）
  ├─ 点「时间戳」→ generateMode("timestamp") ─┤
  └─ 点「自定义」→ 模板?→ generateMode("custom") ─┘
      落盘: {runDir}/{mode}.md / {mode}.html
```

### 核心拆分（core/workflow/index.ts）

```ts
// 阶段一：字幕准备（一次性）
export interface PreparedContent { title: string; transcript: Transcript }
export async function prepareTranscript(input, deps): Promise<PreparedContent>

// 阶段二：按模式生成（懒触发）
export interface GenerateModeInput {
  title: string; transcript: Transcript
  mode: PromptMode; customPrompt: string | null
  apiKey: string; model: string | null; baseUrl: string | null
  screenshot: boolean; runId: string
}
export async function generateMode(input, deps): Promise<SummarizeResult>
// 内部：build_prompt → call_llm → [timestamp 对齐/合并] → render(md/html) → 落盘 {runId}/{mode}.md/.html
```

- `runSummarize` 旧入口删除（UI 全面切换）；`api.ts` 改调两个新函数
- screenshot 逻辑移入 generateMode（截图属于渲染阶段产物，per-mode 可选）

## 数据模型（lib/sessions.ts）

```ts
export type ModeStatus = "pending" | "running" | "done" | "error"

export interface ModeEntry {
  status: ModeStatus
  error?: string
  finishedAt?: number | null
}

export interface SessionMeta {
  run_id: string
  url: string
  title: string
  status: "preparing" | "ready" | "error" | "cancelled"   // 任务级：字幕准备状态
  modes: Partial<Record<PromptMode, ModeEntry>>           // 每模式独立状态
  createdAt: number
  finishedAt: number | null
  error?: string
  outputDir: string
  stage?: string | null                                    // 准备阶段的进度阶段
}
```

- `isSessionMeta` guard 更新：`modes` 可选（兼容旧记录）；旧记录（含 `mode` 字段）迁移：视为 `modes: { [legacyMode]: { status: "done" } }`
- 产物文件映射：`{mode}.md/.html`；旧 `summary_{runId}.md` 兼容读取（fallback）

## 进程 id 与取消

- `run_external` 的 `id` 语义扩展：
  - prepare 阶段：`id = runId`
  - 模式生成：`id = ${runId}:${mode}`（kill 只杀该模式进程）
- `useSessionManager`：`cancelMode(runId, mode)` → 标记该 mode error/cancelled + `killExternal(id)`；`cancel(runId)` → 整体取消（prepare 中）

## UI（App.tsx / ResultPanel）

### 动态状态文案（不硬编码）

统一文案映射，`SessionList` 与结果区共用：

| 状态 | 文案 |
|---|---|
| preparing + stage=detect | 正在识别平台 |
| preparing + stage=fetch_subtitle | 正在抓取字幕 |
| preparing + stage=whisper | 正在本地转写 |
| generate(summary) | 正在生成摘要 |
| generate(fulltext) | 正在生成全文 |
| generate(timestamp) | 正在生成时间戳 |
| generate(custom) | 正在生成自定义 |

- `core`/`lib` 提供纯函数 `describeSessionState(session)`：preparing 阶段返回阶段文案，模式 running 返回「正在生成{模式}」
- 侧边栏 SessionList running 项显示该动态文案；结果区中间状态文字同源
- 不做任何硬编码的「生成摘要」固定文案

### 结果区结构
- **结果区重构**：`ModeResultTabs`（新组件）——`Tabs` 4 个 Trigger（摘要/全文/时间戳/自定义）+ Content：
  - pending：占位 + 「生成摘要」按钮（点击 → `onGenerate(mode)`）
  - running：转圈 + 阶段 + 「取消」
  - done：`ResultPanel`（读盘结果）
  - error：错误 + 重试
- **自定义 Tab**：pending 时若有模板 → 直接「生成」；无模板或点「编辑」→ 复用 `CustomPromptDialog`
- **模式重新生成**：done 态 Tab 提供「重新生成」按钮 → `onGenerate(mode)` 再次执行（同 session，覆盖 `{mode}.md/.html`，状态回 running → done）
- **首页**：移除 4 张模式卡片；UrlForm 提交 → `start(url)` → prepare
- **preparing 状态**：结果区显示字幕准备进度（阶段文字），侧边栏 session 显示 running
- **SessionList 调整**：移除「再次生成」按钮（多模式后语义不清）；「删除」保留
- `ResultPanel` 微调：props 增加 `onRerunMode`（可选），原单 mode 逻辑保留

## 兼容性

- 旧 session：`isSessionMeta` 迁移（单 mode → modes 快照），读取 `summary_{id}.md` fallback
- `resolve_output_dir` / `write_text_file` / `create_dir` 等 Rust 命令不变
- 截图目录 `{runDir}/images/` 不变（generateMode 内 ensureDir）

## 风险

| 项 | 说明 |
|---|---|
| mode 级取消 | 需要 id 语义 `${runId}:${mode}`，kill_external 已按 id 精确杀 |
| 旧 session 迁移 | guard 兼容 + 文件 fallback |
| 进度路由 | summary://progress 事件按 id 过滤（已有 run_id 字段，mode 生成需携带复合 id） |
| 并发模式生成 | 允许同时跑多个模式？——允许（各自独立 id），UI 各自显示 |
| 重新生成覆盖 | generateMode 再次执行直接覆盖 `{mode}.md`（写文件幂等） |

## 回滚

- workflow 拆分后 `runSummarize` 删除前保留一个提交前快照；UI 组件纯新增（ModeResultTabs），App 状态机可回退
