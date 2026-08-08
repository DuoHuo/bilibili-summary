# Tauri 2 + TypeScript 单栈 GUI 迁移 — 技术设计

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 2 WebView（单窗口，TS 全栈）                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │ UI 层（React 18 + shadcn/ui，复用现有 frontend/）   │  │
│  │  App.tsx / url-form / settings-panel / result-panel│  │
│  ├────────────────────────────────────────────────────┤  │
│  │ TS 核心层（src/core/，纯逻辑，不依赖 React/DOM）     │  │
│  │  platform / subtitle / transcript / llm / render / │  │
│  │  workflow / output                                 │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 桥接层（src/lib/tauri.ts）                          │  │
│  │  invoke(command) + plugin-http fetch + event 监听   │  │
│  └────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│  Tauri Rust 壳（src-tauri/，极薄）                        │
│  ├─ commands: run_external（spawn + 进度回调）            │
│  │             save_file（原生另存为）                    │
│  │             ensure_whisper_model（下载/定位模型）       │
│  ├─ plugins:  http（网络，绕 CORS）                       │
│  │            store（配置持久化）                         │
│  │            dialog（另存为 / 打开）                     │
│  └─ sidecar:  yt-dlp / ffmpeg / whisper-cli（CD 阶段分发）│
└──────────────────────────────────────────────────────────┘
```

- **单进程**：TS 核心层运行在 WebView 的 JS 环境内，不做 Node sidecar，不保留 Axum HTTP 服务（决策 D2）。
- **边界**：Rust 壳只做「WebView 做不到的事」——spawn 外部二进制、原生对话框、文件系统、系统网络。所有业务逻辑在 TS 层。

## 2. Rust → TypeScript 映射表

| Rust 源（backend/src/） | TS 目标（frontend/src/core/） | 说明 |
|---|---|---|
| `services.rs::detect_platform` | `platform/detect.ts` | URL host 判断 → `Bilibili\|Youtube\|Err` |
| `services.rs::parse_bilibili_id` / `parse_youtube_id` | `platform/parse.ts` | BV 段 / `watch?v=` / `shorts/` / `youtu.be` |
| `services.rs::fetch_bilibili_meta` | `subtitle/bilibili.ts` | `view` API → title + cid |
| `services.rs::fetch_bilibili_subtitles` | `subtitle/bilibili.ts` | 字幕 API + 会员 cookie |
| `services.rs::fetch_youtube_title` / `fetch_youtube_subtitles` | `subtitle/youtube.ts` | og:title + timedtext 字幕（语言选择） |
| `utils.rs::parse_youtube_subtitles_xml` | `subtitle/parse.ts` | timedtext XML → segments |
| `services.rs::transcribe_with_whisper` | `whisper/index.ts` | yt-dlp 下载 → ffmpeg 转码 → whisper-cli |
| `services.rs::prepare_ytdlp_cookies` | `whisper/cookies.ts` | cookie 串 → Netscape 临时文件 / 已有文件路径 |
| `services.rs::build_whisper_audio_name` / `download_audio_with_ytdlp` | `whisper/audio.ts` | 音频命名 + yt-dlp 参数 |
| `services.rs::resolve_whisper_model_path` / `download_whisper_model` | `whisper/model.ts` | 模型定位 + 首次下载（走 Rust command） |
| `utils.rs::format_transcript_with_timestamps` | `transcript/format.ts` | `[mm:ss] 文本` 拼接 |
| `services.rs::merge_transcript_segments` | `transcript/merge.ts` | 15s 阈值贪心合并（TIMESTAMP_MERGE_THRESHOLD_SECS=15） |
| `services.rs::build_prompt` | `llm/prompt.ts` | 四模式模板 + `{{title}}`/`{{transcript}}` 替换 |
| `services.rs::call_llm` / `resolve_endpoint` | `llm/client.ts` | OpenAI 兼容 `/chat/completions`，base_url 解析 |
| `summarize.rs` 6 节点工作流 | `workflow/index.ts` | 状态机流水线（见 §3） |
| `summarize.rs::build_output_markdown` | `render/markdown.ts` | 结构化 Markdown 组装（含截图标记段） |
| `summarize.rs::strip_markdown_title` | `render/markdown.ts` | 首行标题剥离 |
| `summarize.rs::render_markdown_html` | `render/html.ts` | GFM 渲染 + 「东方简约信纸」模板 |
| `utils.rs::extract_screenshot_markers` | `render/markers.ts` | `![...](marker:N)` 截图标记提取 |
| `services.rs::generate_screenshot` | `render/screenshots.ts` | ffmpeg 截图（走 Rust command） |
| `summarize.rs` DTO（请求/响应/错误） | `core/types.ts`（复用现有 `lib/types.ts`） | 契约不变 |

## 3. 工作流状态机（替代 PocketFlow）

现有 Rust 是 6 节点 PocketFlow（`detect_platform → fetch_subtitle → {build_prompt | whisper_transcribe → build_prompt} → call_llm → assemble_response`）。TS 侧用轻量状态机：

```ts
type Stage = "detect" | "fetch_subtitle" | "whisper" | "build_prompt" | "llm" | "render" | "done"
```

- 顺序编排 + 条件分支（`fetch_subtitle` 后按 `transcript == null` 决定是否走 whisper），不引入框架，一个 `runSummarize(input, deps)` 纯函数即可。
- **可注入依赖**（`deps`）：HTTP client、subprocess runner、event emitter —— 让核心层可单测（fake deps），也可在 web 模式复用（D2 保底）。
- **进度事件**：`runSummarize` 通过 deps.onProgress(stage, detail?) 上报，UI 订阅渲染。

## 4. Tauri 契约

### 4.1 Rust commands（`invoke`）

| command | 签名 | 职责 |
|---|---|---|
| `run_external` | `{program, args, cwd?, env?} → {exit_code, stdout, stderr}` | spawn 二进制，stdout 逐行经 event 回传（进度行） |
| `ensure_whisper_model` | `{model_dir} → {path}` | 定位/下载 ggml-base.bin（首次） |
| `save_file` | `{suggested_name, content} → {path?}` | 原生另存为 + 写入 `.md` / `.html` |
| `read_output_dir` / `resolve_output_dir` | `{run_id?} → {path}` | 产物目录定位（app data `output/{run_id}/`） |

### 4.2 进度事件（Rust/child → JS）

- 事件名：`summary://progress`
- payload：`{ stage: Stage, detail?: string, percent?: number }`
- 用途：yt-dlp 下载进度行、whisper 转写进度、LLM 流式（可选）→ UI 进度条/阶段提示

### 4.3 网络（plugin-http）

- 所有第三方 HTTP（B站 view/字幕 API、YouTube、OpenAI 兼容端点）走 `@tauri-apps/plugin-http` 的 `fetch`，绕开 WebView CORS。
- B站 API 需要的 UA / Referer header 由 TS 层显式传入（与现有 Rust 行为对齐）。
- LLM 端点解析逻辑保持：`base_url` 有值 → `{base}/chat/completions`；否则 `https://api.openai.com/v1/chat/completions`；默认 model `gpt-4o-mini`。

### 4.4 配置持久化（plugin-store）

- 从 IndexedDB 迁移到 `@tauri-apps/plugin-store`（JSON 文件，存 app config dir）。
- `UserConfig` 结构不变（apiKey/model/baseUrl/prompt/cookie/sttLanguage/screenshot/promptMode），保留 `transcript → timestamp` 旧值迁移逻辑。

### 4.5 产物与下载

- 每次运行写入 app data `output/{run_id}/`：`summary_{run_id}.md`、`summary_{run_id}.html`、`transcript_{run_id}.txt`（沿用现有命名）。
- 「下载」→ 改为原生另存为（dialog + `save_file`）；「产物直链」语义改为「打开产物目录」（`opener` plugin 或 command）。

## 5. 外部二进制策略（sidecar / CD 分发）

| 二进制 | 开发期 | 打包期（CD） |
|---|---|---|
| yt-dlp | 系统 PATH 查找（`which yt-dlp`） | 从 GitHub releases 下载三平台可执行 → `src-tauri/binaries/yt-dlp-{target-triple}` |
| ffmpeg | 系统 PATH 查找 | 静态构建（BtbN/ffmpeg-builds 等）→ sidecar |
| whisper-cli（whisper.cpp） | 系统 PATH 查找 | whisper.cpp 官方 releases 三平台 → sidecar |

- Tauri sidecar 命名规则：`{name}-{target-triple}`，构建时自动选当前平台。
- 开发期优先系统安装（README 提示 brew/apt/choco），打包期 CD 脚本统一拉取（决策 D1：开发期不提交二进制，CD 阶段分发）。
- `run_external` 在 Rust 侧做解析顺序：sidecar 资源 → PATH。

## 6. Markdown → HTML 渲染选型

- Rust 用 pulldown-cmark（ENABLE_STRIKETHROUGH/TABLES/TASKLISTS）。
- TS 选 **`marked`**（内置 GFM，零插件，输出与 pulldown-cmark 语义对齐）；若需逐字节对齐再补小差异层。
- 产物 HTML 模板（东方简约信纸：Ma Shan Zheng + Noto Serif SC、`--paper`/`--edge`/`--accent` 变量）**原样移植**，作 fixture 逐字节对照。
- UI 内 Markdown 预览继续用现有 react-markdown + remark-gfm，不共用渲染器（产物 HTML 与 UI 预览是两种上下文）。

## 7. 迁移与兼容性

- **保留** `frontend/src/components/*`、`lib/prompts.ts`、`lib/types.ts`（契约不变）。
- **替换** `lib/api.ts`（HTTP → workflow 调用）、`lib/config.ts`（IndexedDB → plugin-store）。
- **新增** `core/`（TS 核心层）、`lib/tauri.ts`（桥接）。
- **移除** `backend/` 全部 Rust（迁移完成、A6 验证后）。
- 根目录 `Makefile` / `start.sh` / README 更新为 Tauri 命令（`pnpm tauri dev` / `pnpm tauri build`）。
- 现有 `.trellis/spec/backend/` 规范在迁移完成后标记废弃或改写为「Tauri 壳规范」。

## 7b. CI/CD（GitHub Actions）设计

### 7b.1 CI workflow（`.github/workflows/ci.yml`）

- **触发**：`push` + `pull_request`（main）。
- **Matrix**：`ubuntu-latest` / `macos-latest` / `windows-latest`。
- **Steps**：checkout → setup-node + pnpm → `pnpm install --frozen-lockfile` → `pnpm test`（vitest）→ `pnpm build`（tsc + vite）→ `cargo check`（src-tauri，确保 Rust 壳可编译）。
- **目的**：PR 门禁，快速失败；不做打包。

### 7b.2 CD workflow（`.github/workflows/release.yml`）

- **触发**：打 tag（`v*`）或 `workflow_dispatch`（手动，供无 tag 时发版）。
- **Matrix**：`ubuntu-latest`（x86_64）、`windows-latest`（x86_64）、`macos-latest`（x86_64 + aarch64 双 target）。
- **Steps**：
  1. checkout + setup（node/pnpm/rust）
  2. 运行 `scripts/fetch-binaries.sh`：按当前 target-triple 下载 yt-dlp / ffmpeg（静态）/ whisper.cpp 二进制 → `src-tauri/binaries/{name}-{target-triple}`
  3. `tauri-apps/tauri-action`：`pnpm tauri build` + 自动创建/更新 GitHub Release（`tagName: ${{ github.ref_name }}`），上传三平台安装包（.msi/.exe、.dmg/.app、.deb/.AppImage）
  4. 上传构建 artifacts（供调试）
- **sidecar 二进制来源（验证点）**：
  - yt-dlp：`https://github.com/yt-dlp/yt-dlp/releases/latest`（`yt-dlp` / `yt-dlp.exe`）
  - ffmpeg：`https://github.com/BtbN/FFmpeg-Builds/releases`（win64 / linux64 / macos64 静态构建）
  - whisper.cpp：`https://github.com/ggerganov/whisper.cpp/releases`（`whisper-bin-{arch}.zip`，需验证三平台产物命名）

### 7b.3 本地构建可复现
- `scripts/fetch-binaries.sh` 同时供本地 `pnpm tauri build` 与 CI 使用（单一脚本，DRY）。
- 开发期不下载（走 PATH），仅打包前调用；脚本幂等（已存在则跳过）。

## 8. 重要权衡

| 决策 | 权衡 |
|---|---|
| TS 核心跑 WebView（无 Node sidecar） | ✅ 单进程、无 Node runtime、分发小；❌ 与 UI 同包，需严格分层防耦合 |
| plugin-http 替代 reqwest | ✅ 绕 CORS、跨平台一致；❌ 大响应（长字幕）内存占用略高 |
| whisper.cpp sidecar + CD 分发 | ✅ 保留本地转录能力；❌ 三平台二进制维护 + 打包脚本成本 |
| marked 替代 pulldown-cmark | ✅ 生态成熟；❌ 极少数渲染细节需对齐 fixture |
| 配置明文存储（plugin-store JSON） | ✅ 简单；❌ API key 明文落盘（本地单机可接受，不引入 keyring，YAGNI） |

## 9. 风险与回滚

- **风险**：B站/YouTube 反爬策略变化（现有逻辑已含 cookie/UA 处理，保持对齐）；plugin-http 与浏览器 fetch 行为差异（用 fixture 回归）；whisper.cpp 二进制在 CD 阶段可用性（需在 implement.md 中列 release URL 验证点）。
- **回滚**：分阶段提交，每阶段一个可 revert 的 commit；`backend/` 在 A6 验证前保留；核心层纯函数化使回归测试可快速定位差异。
