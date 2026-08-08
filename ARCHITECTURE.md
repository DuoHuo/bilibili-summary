# Video Summary Architecture

## 总览

Video Summary 是一个 **Tauri 2 桌面应用**（单窗口）：核心业务逻辑全部 TypeScript（`frontend/src/core/`），Rust 仅保留极薄系统能力壳（`src-tauri/`）。用户输入 B 站或 YouTube 链接，应用完成字幕获取/Whisper 转写、调用大模型生成摘要与 Markdown/HTML 产物。

## 核心流程

1. UI 层提交视频链接与模型配置（设置持久化在应用数据目录）
2. TS 核心层识别平台并拉取字幕或元信息（B站 API / YouTube oEmbed+timedtext）
3. 若字幕缺失，使用 whisper.cpp 本地转录兜底（yt-dlp 下载音频 → ffmpeg 转码 → whisper-cli）
4. 构建提示词并调用 OpenAI 兼容接口生成摘要（timestamp 模式含 1:1 行修正 + 15s 段合并）
5. 组装 Markdown / HTML 产物，落盘到应用数据目录 `output/{run_id}/`

## 模块分层

### 1. UI 层（`frontend/src/components` + `App.tsx`）

- React 18 + shadcn/ui；紧凑桌面布局（顶栏 + 输入条 + 撑满结果区）
- 仅做展示与交互，业务逻辑全部委托 core 层

### 2. TS 核心层（`frontend/src/core/`）

- `platform/`：URL 解析与平台识别（纯函数）
- `subtitle/`：B站 / YouTube 字幕抓取（依赖注入 `http`）
- `transcript/`：时间戳格式化、15s 段合并（纯函数）
- `whisper/`：yt-dlp 下载、whisper-cli 转写、cookie 处理（依赖注入 `runner`）
- `llm/`：提示词构建、OpenAI 兼容调用
- `render/`：Markdown 组装、HTML 模板（marked）、截图标记与 ffmpeg 截图
- `workflow/`：`runSummarize(input, deps)` 流水线编排（唯一入口）
- 依赖注入契约：`core/types.ts` 的 `SummarizeDeps`（http / runner / 文件系统 / 进度事件）

### 3. Tauri Rust 壳（`src-tauri/`）

- `src/commands.rs`：`run_external`（sidecar/PATH 解析 + 进度事件）、`save_file`（原生另存为）、`ensure_whisper_model`、`resolve_output_dir`、文件读写
- plugins：http（网络绕 CORS）、store（配置持久化）、dialog、opener
- sidecar：yt-dlp / ffmpeg / whisper-cli（打包/CD 阶段由 `scripts/fetch-binaries.sh` 拉取）

## 关键设计点

- **单栈 TypeScript**：核心业务逻辑与 UI 同语言，Rust 壳只做 WebView 做不到的事
- **依赖注入**：核心层可单测（fake deps），未来可复用（如抽独立 package + HTTP adapter）
- **平台检测与转写兜底**：字幕不可用时自动 Whisper 转录，保证可用性
- **进度事件**：子进程逐行经 `summary://progress` 事件转发到 UI
- **跨平台打包**：GitHub Actions 三平台构建 + sidecar 二进制分发（GitHub Release）

## Harness 对齐

- Harness 记录目录：`docs/harness/records/`
- 任务收尾提醒（Harness 同步）：完成改动后执行 `harness-doc-sync`

## L0-L3 架构标记

- L0: 用户入口与前端体验（UI 层）
- L1: 工作流编排与系统能力桥接（workflow / Tauri commands）
- L2: 业务服务与外部依赖（平台/模型/Whisper/渲染）
- L3: 工具与格式化层（transcript / parse / markers 纯函数）
