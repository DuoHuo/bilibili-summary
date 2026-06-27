# Repository Guidelines

## Project Overview

**Video Summary** 是一个前后端可部署的视频摘要应用：输入 B 站 / YouTube 链接，自动识别平台 → 抓取字幕（无字幕回退本地 Whisper）→ 调 OpenAI 兼容 LLM → 生成 Markdown / HTML 摘要。视觉系统遵循 `DESIGN.md`（Anthropic Claude 风格的暖色编辑设计）。

- **Frontend**: React 18 + Vite 8 + TypeScript 5.9 (strict) + **Tailwind v4 + shadcn/ui** + Radix + Sonner
- **Backend**: Rust (edition 2024) + Axum 0.7 + Tokio + PocketFlow
- **Package manager**: pnpm (前端) + cargo (后端)
- **Top-level orchestration**: `Makefile`（推荐入口）；`start.sh` 是旧版兼容脚本

## Architecture & Data Flow

```
Browser ──POST /api/summarize──▶ Axum (0.0.0.0:8787)
                                  │
                                  ▼
                         pocketflow_rs::Flow
   DetectPlatform ─▶ FetchSubtitle ─┬─▶ SubtitleReady ─▶ BuildPrompt ─▶ CallLlm ─▶ AssembleResponse
                                     └─▶ NeedWhisper ─▶ WhisperTranscribe ─┘
```

- **Platform detect** (`services.rs`): `bilibili.com` / `youtube.com|youtu.be` via `url::Url` host match.
- **Subtitle fetch**: Bilibili `api.bilibili.com/x/web-interface/view` + `/x/player/v2`; YouTube `oembed` + `video.google.com/timedtext` (srv3 XML parsed in `utils.rs`).
- **Whisper fallback**: `yt-dlp` 下载 16 kHz 单声道 WAV → `whisper-rs` (Greedy, `best_of=1`) 转录。模型 `ggml-base.bin` 首次使用时从 HuggingFace 自动下载到 `backend/models/`。
- **LLM call**: `POST {base_url}/chat/completions` (OpenAI 兼容，默认 `gpt-4o-mini`)。可选二次字幕润色 `refine_transcript_with_llm`，以及 `generate_html_labels` 生成 HTML 模板标签。
- **Assemble**: 在 `${OUTPUT_DIR}/{run_id}/` 写出 `summary_{run_id}.md` / `.html` / `transcript_{run_id}.txt`，然后返回 JSON。请求带 `screenshot: true` 时用 `ffmpeg -ss … -frames:v 1` 抽帧。

**Async / errors**: `#[tokio::main]` + `reqwest` async；`yt-dlp` / `ffmpeg` / Whisper 是阻塞的 `std::process::Command`。错误两层 — `services.rs` 用 `Result<T, String>`（中文消息）→ 工作流节点用 `anyhow::Error` → `summarize` handler 把**所有**失败统一塌成 `HTTP 400 + {"message": "..."}`。没有状态码区分，把 400 当作"出错了"。

## Key Directories

| Path | Purpose |
| --- | --- |
| `Makefile` | **顶层编排（推荐入口）**：`make dev` / `make build` / `make check` 等 |
| `backend/src/` | Rust crate `video-summary-backend`，扁平结构（见下） |
| `backend/src/main.rs` | 入口。Router、CORS（allow-any）、`/output` 上的 `ServeDir`，绑 `0.0.0.0:8787`。 |
| `backend/src/summarize.rs` | HTTP DTO + `summarize` handler + PocketFlow 工作流 + Markdown→HTML（`pulldown-cmark` + "东方简约信纸" 模板）。 |
| `backend/src/services.rs` | 外部集成：平台识别、B 站/YouTube 字幕、Whisper、`call_llm`、`yt-dlp`/`ffmpeg`、截图。 |
| `backend/src/utils.rs` | 纯函数：时间戳格式化、YouTube srv3 XML 解析、截图标记正则。 |
| `frontend/src/main.tsx` | Vite SPA 入口，挂 `<App/>`。 |
| `frontend/src/App.tsx` | 顶层布局、状态、IndexedDB 持久化、API 编排。 |
| `frontend/src/index.css` | **Tailwind v4 `@theme` tokens**（DESIGN.md 色板）+ shadcn bridge + `.prosemic` markdown 样式。 |
| `frontend/src/components/ui/` | **shadcn 原语**（button/input/textarea/card/dialog/label/badge/tabs/separator/switch/sonner）。 |
| `frontend/src/components/` | 业务组件：`top-nav` / `hero` / `url-form` / `settings-panel` / `result-panel` / `footer` / `spike-mark`。 |
| `frontend/src/lib/` | `utils.ts`（`cn()`）/ `types.ts`（含 `isSummarizeResult` guard）/ `api.ts`（`postSummarize`）/ `config.ts`（IndexedDB）/ `transcript.ts`（字幕段落规整）。 |
| `frontend/components.json` | shadcn CLI 配置（style: new-york，base color: stone）。 |
| `backend/models/` | Whisper 模型 `ggml-base.bin` — gitignored，自动下载。 |
| `backend/output/` | 每次 `run_id` 的产物 — gitignored，挂在 `/output/*`。 |
| `docs/harness/records/` | 变更记录，文件名 `YYYYMMDD-HHMMSS-摘要.md`。 |
| `ref/` | **vendored 参考仓库**（BilibiliSummarier / BibiGPT-v1 / BiliNote）— 不参与构建，gitignored。 |
| `example/example.html` | 独立的 "信纸风格" 视觉原型。 |
| `start.sh` | 旧版一键启动脚本，保留兼容（行为同 `make install + make dev`）。 |

## Development Commands

```bash
# 推荐：通过 Makefile
make install        # pnpm install + cargo fetch
make dev            # 并行启动前后端（Ctrl-C 同时退出）
make build          # cargo build --release + tsc + vite build
make run            # 跑生产构建产物
make check          # 快速类型检查（cargo check + tsc --noEmit）
make test           # 跑测试（当前 0 个 — 见 Testing & QA）
make clean          # 清理所有构建产物
make help           # 列出全部目标

# 或者直接用底层工具
cd backend  && cargo run            # 0.0.0.0:8787（hardcoded）
cd frontend && pnpm install
cd frontend && pnpm dev             # Vite 默认 5173
cd frontend && pnpm build           # tsc && vite build — 唯一的质量门
```

**External binaries**: `pnpm`、`cargo`、`yt-dlp`、`ffmpeg`。Whisper 模型首次使用时自动下载；用 `WHISPER_MODEL_PATH` 覆盖路径。

**Environment variables**:

| Var | Side | Default | Effect |
| --- | --- | --- | --- |
| `VITE_API_BASE` | frontend | `http://localhost:8787` | 后端地址，在 `frontend/src/App.tsx` 解析。 |
| `OUTPUT_DIR` | backend | `output` | 产物目录，挂在 `/output`。 |
| `SUMMARY_HTML_SUBTITLE` | backend | `东方简约信纸 · Video Summary` | HTML 模板副标题。 |
| `SUMMARY_HTML_STAMP` | backend | `摘要` | HTML 模板印章文字。 |
| `RUST_LOG` | backend | `info` | `tracing_subscriber` 过滤级别。 |
| `WHISPER_MODEL_PATH` | backend | `models/ggml-base.bin` | Whisper 模型路径。 |

LLM 的 `base_url` / `model` / `api_key` / `prompt` / `cookie` 是**每次请求**字段（在 `SummarizeRequest` 上），不是环境变量。

## Code Conventions & Common Patterns

**TypeScript** — 适用于 `frontend/src/`：
- **无分号**（ASI）、**双引号**、**2-space 缩进**。
- **路径别名 `@/*`**（在 `vite.config.ts` 与 `tsconfig.json` 同时配置），指向 `src/*`。`import type` 用于纯类型导入（`verbatimModuleSyntax: true`）。
- `tsconfig.json` 全开严格：`strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`verbatimModuleSyntax`、`erasableSyntaxOnly`、`moduleResolution: bundler`、`target: ES2024`（**ES2024 是为了用 `Promise.withResolvers`**）、`jsx: react-jsx`。
- **Tailwind v4 CSS-first**：颜色 / 字体 / 圆角 token 在 `src/index.css` 的 `@theme` 块里直接定义，命名照搬 `DESIGN.md`（`bg-canvas` / `text-ink` / `bg-primary` / `bg-surface-card` / `bg-surface-dark` / `border-hairline` 等），**不**走 shadcn 的 `bg-background` / `text-foreground` 间接层。新组件请直接用这些 token 名。
- **shadcn 原语**在 `components/ui/`：button / input / textarea / card / dialog / label / badge / tabs / separator / switch / sonner。修改时遵循 DESIGN.md 的"cream canvas + 珊瑚主 CTA + 深色 surface 节奏"原则。
- 字体：**Cormorant Garamond**（衬线，DESIGN.md 中 Copernicus 的开源替代）/ **Inter**（正文，StyreneB 替代）/ **JetBrains Mono**（代码），在 `index.html` 通过 Google Fonts 引入。
- 状态：单个 `<App>` 组件用 `useState` + `useCallback` / `useMemo`，配置持久化走 IndexedDB（`video-summary` / `user-config` / key `active`，见 `lib/config.ts`）。无 router、无全局 store。
- **不使用 `new Promise((resolve, reject) => ...)`** — 项目规则要求 `Promise.withResolvers()`（见 `lib/config.ts`）。
- **不使用 `(value as { x }).x` 行内 cast 读字段** — 网络/持久化边界的数据要用运行时 guard（见 `lib/types.ts` 的 `isSummarizeResult` 与 `lib/config.ts` 的 `isUserConfig`）。

**Rust** — 适用于 `backend/src/`：
- `snake_case`，`anyhow::Error` + `?` 传播，`tracing::{info,warn,error}` 带表情前缀和中文注释。
- 公共流程是 `pocketflow_rs::Flow<WorkflowState>` — 加新行为通过引入新 node + edge，而不是改 handler。
- 所有 HTTP 错误统一塌成 `400 + {"message": ...}`，不要随意新增状态码。
- HTTP 层不读敏感信息环境变量：`api_key` / `cookie` / `base_url` / `model` / `prompt` 走 `SummarizeRequest` 请求体。

**Design system** (`DESIGN.md`) — Anthropic Claude 风格的"暖色编辑"视觉系统，**已落地**（前端 `index.css` 实现）：
- 必守：canvas 是 `#faf9f5`（禁纯白 / 冷灰）；coral `#cc785c` 只用于主 CTA / badge / 链接；衬线大标题 weight 500 + 负字距；表面节奏 cream → cream-card → dark footer。
- 圆角阶梯：button/input 8px、card 12px、hero badge pill。
- 不引入第四种表面色（没有紫色卡片、没有绿色区块）。

## Important Files

- **Backend 入口**: `backend/src/main.rs:45` — `SocketAddr::from(([0,0,0,0], 8787))`。
- **Backend handler**: `backend/src/summarize.rs:64` — `async fn summarize(State, Json<SummarizeRequest>) -> Result<Json<SummarizeResponse>, (StatusCode, Json<ErrorResponse>)>`。
- **Frontend 入口**: `frontend/src/main.tsx` — `createRoot(...).render(<App/>)`。
- **Frontend API 调用**: `frontend/src/lib/api.ts` 的 `postSummarize` — `POST ${VITE_API_BASE||http://localhost:8787}/api/summarize`，响应通过 `isSummarizeResult` guard 校验。
- **Frontend 配置持久化**: `frontend/src/lib/config.ts` — IndexedDB `loadConfig` / `saveConfig`，均用 `Promise.withResolvers()`。
- **顶层编排**: `Makefile` — `make help` 看全部目标。
- **API 契约**（与 `README.md` 同步）：request `{url, api_key, model?, base_url?, prompt?, cookie?, stt_language?, refine_transcript?, screenshot?}` → response `{run_id, title, summary, markdown, html, html_subtitle?, html_stamp?, transcript?, transcript_segments?[{start,end,text}], transcript_source}`。`transcript_source` ∈ `subtitle | whisper | whisper_refined`（snake_case serde）。
- **Configs**: `backend/Cargo.toml`、`frontend/package.json`、`frontend/tsconfig.json`、`frontend/vite.config.ts`、`frontend/components.json`、`Makefile`、`start.sh`、根 `.gitignore`（额外忽略 `ref/`、`models/`、`output/`、`backend/target/`、`backend/models/`、`backend/resources/`）。

## Runtime / Tooling Preferences

- **Frontend runtime**: Node ≥ 20（需要原生 `Promise.withResolvers`，ES2024）+ pnpm。无 `.nvmrc` / `engines` / `packageManager` field。
- **Backend runtime**: Rust stable，edition 2024。无 `rust-toolchain.toml`。
- **无根 workspace** `Cargo.toml` — `frontend/` 与 `backend/` 是两个独立项目。
- **路径别名** `@/*` → `src/*`（已配）。
- **无 ESLint / Prettier / rustfmt / clippy 配置** — 手工对齐周边风格。（`ref/` 下的配置属于上游参考仓库，与本项目无关。）
- **shadcn CLI**：要加新原语时跑 `npx shadcn@latest add <component>`，配置已就绪（`components.json`）。

## Testing & QA

**基线：实质为零。** 实话实说，不要美化。

- **Backend**：没有 `#[cfg(test)]`、没有 `#[test]`、没有 `backend/tests/` 目录、`Cargo.toml` 没有 `[dev-dependencies]`。`cargo test` 编译通过但跑不到任何测试。
- **Frontend**：没有 `*.test.ts(x)` / `*.spec.ts` / `__tests__/`；没装 vitest / jest / testing-library；`package.json` 没有 `test` / `lint` / `format` 脚本。
- **CI**：不存在 — 没有 `.github/`、`.gitlab-ci.yml`、`Justfile`。
- **Lint / format**：两侧都没配置。
- **唯一质量门**：`tsc` 通过 `pnpm build` / `make check` 调用。只要能编译，bug 就能上线。

改动时：优先为新行为加聚焦的测试（Rust 模块内 `#[cfg(test)]` 单测，或 `backend/tests/` 针对 handler 的集成测试），完成前跑 `make check` 与 `make test`。不要 mock LLM 与字幕抓取 — 测 `utils.rs` 的纯函数和工作流节点装配。

## Harness Alignment

- 变更记录在 `docs/harness/records/`，文件名 `YYYYMMDD-HHMMSS-摘要.md`（见 `docs/README.md`）。
- 非平凡改动后跑 `harness-doc-sync` 并追加一条记录。`TODO.md` 里的 open item："Harness 文档对齐与校验"。
- 注意：旧记录 `20260316-142836` 引用了已不存在的文件（`backend/src/models/`、`backend/src/routes/`、`README_WEB.md`）— 那是后来重构到当前扁平 `backend/src/{main,summarize,services,utils}.rs` 之前的残留。以当前代码树为准。
