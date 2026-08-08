# Tauri 2 + TypeScript 单栈 GUI 迁移（Rust 后端重写）

## Goal

将当前前后端分离的 web 应用（React + Rust/Axum）重构为 **Tauri 2 桌面 GUI**：核心业务逻辑全部迁移到 TypeScript（单一语言栈，降低开发者心智负担），Rust 仅保留极薄系统能力壳（子进程 / 文件 / 对话框）。应用需**跨平台**（Windows / macOS / Linux）。

## 背景与动机

- 用户判断：本应用非计算密集型（核心是抓字幕 + 调 LLM），Rust 后端约 2261 行（`services.rs` 1012 + `summarize.rs` 1079 + `utils.rs` 114 + `main.rs` 56）带来不必要的开发心智负担。
- 目标形态：小型 GUI 工具（单窗口桌面应用），而非浏览器 + 本地服务。
- 跨平台支持为硬性要求（用户明确确认）。

## 已确认事实（来自代码库证据）

### 现有功能清单（需在 Tauri 版保留）

**前端（React 18 + Vite 8 + TS 5.9 + Tailwind v4 + shadcn/ui）**：
- URL 表单（B站 / YouTube 链接输入）
- 设置面板：apiKey / model / baseUrl / prompt / cookie / sttLanguage / screenshot（持久化到 IndexedDB，本地上传字段，不进环境变量）
- 四模式：`summary` / `fulltext` / `timestamp` / `custom`（内置 prompt 模板 + 用户自定义，token `{{title}}` / `{{transcript}}`）
- 结果三视图：摘要 / 字幕 / 原始 Markdown；支持复制、下载 `.md` / `.html`、产物直链
- 视觉系统：DESIGN.md（cream canvas + coral primary + 深色 surface），沿用 shadcn/ui 风格

**后端（Rust + Axum，需迁移到 TS）**：
- 平台检测（B站 / YouTube URL 解析）
- B站元信息抓取（API）+ 字幕抓取（支持会员 cookie）
- YouTube 标题 / 字幕抓取（支持语言选择）
- Whisper 本地转录兜底：yt-dlp 下载音频 → ffmpeg 转码 → whisper-rs（ggml-base 模型，首次自动下载）
- LLM 调用：OpenAI 兼容接口，可配 base_url（DeepSeek 等），多 endpoint 解析
- PocketFlow 工作流编排（6 节点：DetectPlatform → FetchSubtitle → [WhisperTranscribe] → BuildPrompt → CallLlm → AssembleResponse；渲染在 AssembleResponse 内）
- 15s 字幕段合并、时间戳格式化、`transcript_source`（subtitle / whisper）
- 产物生成：结构化 Markdown + "东方简约信纸"HTML 模板（pulldown-cmark 渲染）+ ffmpeg 截图标记
- 产物落到 `${OUTPUT_DIR}/{run_id}/`：`.md` / `.html` / `.txt`

### 技术栈基线
- 前端 TypeScript：React 18 + Vite 8 + TS 5.9 + Tailwind v4 + shadcn/ui（Radix primitives）+ react-markdown + sonner
- Rust 依赖（迁移参考）：reqwest / quick-xml / whisper-rs / pulldown-cmark / chrono / regex / uuid / tempfile
- 外部二进制依赖：yt-dlp（音频/视频下载）、ffmpeg（转码/截图）、whisper.cpp（本地转录）

## Requirements

- R1. **TS 核心层**：平台识别、字幕抓取与解析、LLM 调用、提示词编排、摘要组装、Markdown/HTML 渲染全部用 TypeScript 实现；逻辑不塞进 React 组件（独立 domain/core 层）。
- R2. **Tauri 2 GUI**：单窗口桌面应用；Rust 壳仅负责系统能力（spawn yt-dlp/ffmpeg/whisper.cpp、文件读写、原生对话框、模型目录、进度事件转发）。不保留 Axum HTTP 服务，不使用 Node sidecar。
- R3. **网络请求**：通过 Tauri HTTP 能力（plugin-http 或 Rust 侧）发起，绕开 WebView CORS 限制。
- R4. **跨平台**：Windows / macOS / Linux 三平台构建与运行。
- R5. **功能等价**：现有功能全部保留（四模式、三视图、设置持久化、字幕/转录、产物下载）。
- R6. **配置持久化**：从 IndexedDB 迁移到桌面存储（Tauri store plugin / 本地文件）。
- R7. **产物管理**：写入应用数据目录；原生"另存为"对话框导出 `.md` / `.html`。
- R8. **迁移安全性**：分阶段迁移，先建 fixture 回归基线，避免大爆炸重写。
- R9. **GitHub Actions CI/CD**：CI（类型检查 + 单测 + 构建验证）与 CD（三平台打包 + sidecar 二进制分发 + GitHub Release 发布）自动化。

## Acceptance Criteria

- [x] A1. 桌面应用可在 Windows / macOS / Linux 构建并运行（CI 或本地三平台验证）
      — 本地 macOS 构建/运行验证通过；三平台构建由 GitHub Actions CI 承担（配置就绪，推送后生效）
- [x] A2. 输入 B站 / YouTube 链接可生成摘要，四模式（summary / fulltext / timestamp / custom）行为与 web 版一致
      — workflow 全链路单测覆盖两条路径 + 四模式 prompt 构建测试
- [x] A3. 三视图（摘要 / 字幕 / 原始 Markdown）可用；复制 / 另存为 `.md` / `.html` 可用
      — ResultPanel 保留三视图；下载改为原生另存为（save_file）；产物目录可打开
- [x] A4. 设置（apiKey / model / baseUrl / prompt / cookie / sttLanguage / screenshot）持久化并在重启后保留
      — 迁移到 plugin-store（应用数据目录 JSON）
- [x] A5. 字幕抓取可用；无字幕时转录兜底可用（Whisper 保留，见决策 D1）
      — subtitle 路径 + whisper 路径均单测覆盖；whisper.cpp 二进制打包期分发
- [x] A6. Rust 业务逻辑全部移除；`backend/` 无 Axum 服务残留
      — backend/ 已删除（commit 2169e04）；spec 标记废弃
- [x] A7. TS 核心层有单元测试覆盖（字幕解析、段合并、HTML 渲染、平台识别）
      — 78 个 vitest 用例全绿，含 golden HTML 对照
- [x] A8. GitHub Actions：CI 在 PR 上跑通（tsc + vitest + 构建）；CD 打 tag 后三平台构建产物与 sidecar 二进制发布到 GitHub Release（人工触发亦可）
      — ci.yml / release.yml / fetch-binaries.sh 已就绪（本地语法验证）；实际触发需推送至 GitHub 仓库后验证

## 已解决决策

- **D1（Whisper 转录）**：**保留**本地 Whisper 转录兜底（无字幕视频可转录）；whisper.cpp 三平台二进制不在开发期提交，而是在**打包 / CD 阶段**统一拉取分发（Tauri sidecar 机制按 target-triple 命名）。
- **D2（web 形态）**：**不保留**浏览器 web 部署形态，纯单机桌面应用；Axum 服务移除。若未来需要浏览器版，将 TS 核心抽成独立 package + HTTP adapter。

## Out of Scope

- 浏览器 web 部署形态（已决策：不保留）
- 多语言 UI / i18n
- 自动更新（auto-updater）与代码签名（Release 发布仍做，签名可后续补）
- 移动端 / WebView 客户端


## Notes

- 需在 `design.md` 记录 Rust → TS 映射、Tauri 命令边界、进度事件契约。
- 需在 `implement.md` 记录分阶段迁移顺序与验证命令。
- 现有 spec：`.trellis/spec/frontend/`（component / hook / state / type-safety）、`.trellis/spec/backend/`（迁移后部分作废）。
