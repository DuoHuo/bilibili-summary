# Design: Multi-session Management with History

## Architecture Overview

当前是"单结果"架构：`App.tsx` 持有一个 `SummarizeResult | null`，运行完就结束。改造目标是把"运行"提升为一等公民 —— 每个运行是一个 `Session`，由 **session 存储层**统一管理（运行中状态 + 持久化），UI 从存储层读取列表与详情。

```
App.tsx
  └─ useSessionManager()  (新 hook，frontend/src/lib/sessions.ts)
       ├─ state: sessions: SessionMeta[]  （含 running 任务，内存 + 持久化镜像）
       ├─ actions: start(url) / cancel(runId) / remove(runId) / rerun(sessionId)
       └─ 内部: 调用 runSummarize + 进度订阅 + 状态落盘
```

三层职责：
1. **core 层**：不改 `runSummarize` 主流程；新增**取消信号**支持（AbortSignal-like）与**音频缓存复用**参数
2. **lib 层**：`sessions.ts` 管理 session 索引（plugin-store 持久化）+ 并发任务编排；`tauri.ts` 增加 kill 命令桥接
3. **UI 层**：侧边栏平铺 session 列表（运行中 + 历史），主区回看详情

---

## Data Model

### SessionMeta（索引记录，持久化）

```ts
interface SessionMeta {
  run_id: string            // UUID v4，与产物目录同名
  url: string               // 原始 URL
  title: string             // 视频标题（运行中可为 ""，成功后回填）
  mode: PromptMode          // 当时的 prompt 模式
  status: "running" | "done" | "error" | "cancelled"
  createdAt: number         // epoch ms
  finishedAt: number | null
  error?: string            // status=error/cancelled 时的消息
  outputDir: string         // 产物目录绝对路径（resolveOutputDir 结果）
}
```

### 存储

- 新 plugin-store 文件 `sessions.json`，key `list` → `SessionMeta[]`（按 createdAt 倒序）
- 存**元数据索引**，不存完整结果；回看时按 `outputDir` 从磁盘读 md/html/transcript（已有 `readTextFile`）
- 与现有 `user-config.json` 并列，互不干扰
- 每次 status 变化（start/done/error/cancelled）写一次 store；批量更新用一次 `store.save()`

### 产物目录（复用现有结构）

```
{app_data}/output/{run_id}/
├── summary_{run_id}.md / .html / transcript_{run_id}.txt   (现有)
└── resources/               (现有：wav 音频 + mp4 截图视频)
```

删除 session = 删除索引记录 + 递归删除 `outputDir`。需新增 Rust command `remove_dir`（现有命令无目录删除能力）。

---

## Audio Cache Design (R4)

**缓存键 = 视频稳定 ID**（已有现成函数 `buildWhisperAudioName(url)`）：
- B 站 → `BVxxxx`；YouTube → `youtube-{id}`；解析失败 → 不缓存（回退现状）

**复用路径**：重新生成同一视频时，workflow 第 3 步（whisper）前先检查缓存；命中则跳过 yt-dlp 下载，直接转写。

**缓存位置**：集中式 `{app_data}/cache/audio/{key}.wav`（独立于 session 产物目录）。
- 理由：同一视频多次运行共享一份音频，避免 N 份拷贝；session 产物目录仍保留自己的引用（不再冗余存音频）
- 迁移：首次运行时把旧 session 的 `resources/*.wav` 按 key 拷入 cache（可选，见 implement 分期）

**实现**：core 层 `transcribeWithWhisper` 增加可选参数 `cachedAudioPath`（或抽象为 `resolveAudioCache(url, cookie) → { path, reused }`）。workflow 注入 `resolveCacheDir` 依赖（tauri 桥接新增 command `resolve_cache_dir`）。

> 设计取舍：严格来说缓存属于"同一视频 + 相同 cookie"才安全（会员视频）。MVP 以 URL 为键，cookie 变化时可能误用缓存；记录为已知限制（见 Risks）。

---

## Concurrency & Cancellation (R1/R3)

### 并发

- 无上限、无队列：每个 `start()` 直接触发 `runSummarize`（已是 async），互不阻塞
- `sessions` state 天然支持多任务：每条 running session 独立持 progress 状态

### 进度

现有 `summary://progress` 事件是**全局广播**（只带 stage/detail，无 run_id）——并发下无法区分属于哪个任务。**必须扩展**：事件 payload 增加 `run_id` 字段。

改造点：
- Rust `run_external` 的 `stage` 参数改为携带 `run_id`（或新增字段），emit 时带上
- 前端 `tauriRunner` 的 `listen` 过滤增加 run_id 匹配
- core `runSummarize` 的 `onProgress` 回调不变（上层已按任务隔离）

### 取消

现状：`run_external` 阻塞等待子进程结束，无终止能力。**需新增 Rust command**：

```rust
// 进程注册表：command_id → Child
static CHILDREN: Mutex<HashMap<String, Child>>
```

- `run_external` 接收可选 `id` 参数，spawn 后注册；`kill_external(id)` 遍历 `kill()` + `wait()`
- 前端 `tauri.ts` 增加 `killExternal(id)` 桥接
- 取消流程：`cancel(runId)` → 标记 session `cancelled` + 调用 `killExternal` 终止当前子进程 → 进程退出后 `runSummarize` 抛出（或检测到 cancelled 标志提前返回）→ session 落盘 `cancelled`

> 设计取舍：取消是"尽力而为"——只保证终止**当前**子进程（yt-dlp/whisper/截图）。若取消发生在 LLM HTTP 请求阶段（无子进程），依赖 fetch 自然返回后标记。这是 MVP 可接受的边界，记录在 Risks。

---

## UI Design (R2/R3)

沿用现有侧边栏布局（`App.tsx`），结构改造：

```
<aside>                                    (现有 glass-strong 侧边栏)
  ├─ logo 区（不变）
  ├─ nav：新摘要 / 设置（不变，固定置顶）
  ├─ flex-1 滚动区：SessionList（新）
  │    └─ 平铺 SessionItem：色点 + 标题 + 时间 + 状态
  │         running: 显示当前 stage + 取消按钮
  │         done: 显示"再次生成"按钮
  └─ footer 状态条（不变）
```

主区（view 逻辑扩展）：
- `view: "home" | "settings" | "session"`，`session` 携带 `activeRunId`
- home：现有 hero 表单 + 模式卡片；提交后自动创建 session 并跳转/高亮
- session：回看详情 = 现有 `ResultPanel` 复用（从磁盘读回 result 后渲染）
- 运行中点击 session → 实时进度视图（stage 徽标 + detail 滚动）

色点映射：`running`→灰、`done`→绿、`error`/`cancelled`→红（已有 `--color-success` / `--color-error` / muted token）。

---

## Tauri Commands (new/modified)

| Command | 类型 | 用途 |
|---|---|---|
| `resolve_cache_dir` | 新增 | 返回 `{app_data}/cache/audio`，创建目录 |
| `kill_external(id)` | 新增 | 终止注册表内子进程 |
| `remove_dir(path)` | 新增 | 递归删除目录（session 删除用） |
| `run_external` | 修改 | `req` 增加 `id` 字段；emit progress 带 run_id |
| `resolve_output_dir` | 不变 | 产物目录 |

---

## Compatibility & Migration

- 旧 session 产物目录保留在 `output/`，新索引从空开始（不做自动导入，MVP 范围外）
- 现有单结果流程（hero 表单）无缝升级为 session 流程，行为兼容
- plugin-store 新增文件，不影响现有 `user-config.json`

## Risks / Deferred

1. **缓存与 cookie 绑定**：MVP 仅按 URL 复用音频；会员视频换 cookie 后可能复用旧音频 → 记录限制，后续加 cookie hash 进缓存键
2. **取消边界**：LLM HTTP 阶段取消不终止请求，只标记状态 → 接受
3. **并发资源**：无上限并发可能打满 CPU/带宽 → 用户自行管理（PRD 已定）
4. **进度事件兼容**：`summary://progress` payload 增加 run_id 是 breaking change，但只影响本应用内部，无外部消费者 → 低风险
