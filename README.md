# Video Summary

输入一条 B 站 / YouTube 链接，自动生成结构化视频摘要。前端 Anthropic 风格暖色编辑设计，后端 Rust 工作流编排（平台识别 → 字幕抓取 / Whisper 转录 → LLM 总结 → Markdown / HTML 产物）。

- **Frontend**: React 18 + Vite 8 + TypeScript 5.9 + Tailwind v4 + shadcn/ui
- **Backend**: Rust (edition 2024) + Axum 0.7 + Tokio + PocketFlow
- **Package manager**: pnpm (前端) + cargo (后端)

> 设计参考 [BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) 与 [BiliNote](https://github.com/JefferyHcool/BiliNote)；视觉系统见 [`DESIGN.md`](./DESIGN.md)（cream canvas + coral primary + 深色 surface）。

## 功能概览

- 支持 Bilibili / YouTube 链接（自动识别平台）
- 优先抓取官方字幕，无字幕时回退到本地 Whisper 转录
- OpenAI 兼容接口（默认 `gpt-4o-mini`，可改 `base_url` 接 DeepSeek 等）
- 可选二次字幕润色、ffmpeg 截图标注
- 结构化 Markdown + HTML（"东方简约信纸"模板）输出
- 配置持久化到浏览器 IndexedDB，不上传服务器
- 三视图切换：摘要 / 字幕 / 原始 Markdown；支持复制、下载、产物直链

## 目录结构

```
video-summary/
├── frontend/                 # React + Vite + Tailwind + shadcn/ui
│   ├── src/
│   │   ├── App.tsx           # 顶层布局 + 状态 + API 编排
│   │   ├── main.tsx          # 挂载点
│   │   ├── index.css         # Tailwind v4 @theme tokens（DESIGN.md 色板）
│   │   ├── components/
│   │   │   ├── ui/           # shadcn 原语（button/input/dialog/...）
│   │   │   ├── top-nav.tsx
│   │   │   ├── hero.tsx
│   │   │   ├── url-form.tsx
│   │   │   ├── settings-panel.tsx
│   │   │   ├── result-panel.tsx
│   │   │   ├── footer.tsx
│   │   │   └── spike-mark.tsx
│   │   └── lib/              # utils / types / api / config / transcript
│   ├── components.json       # shadcn 配置
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                  # Rust + Axum + PocketFlow
│   ├── src/
│   │   ├── main.rs           # 路由 + CORS + ServeDir，绑 0.0.0.0:8787
│   │   ├── summarize.rs      # DTO + PocketFlow 工作流 + HTML 渲染
│   │   ├── services.rs       # 平台/字幕/Whisper/LLM/yt-dlp/ffmpeg
│   │   └── utils.rs          # 时间戳/XML/正则工具
│   ├── Cargo.toml
│   └── models/               # ggml-base.bin（gitignored，自动下载）
├── Makefile                  # 顶层编排（推荐入口）
├── start.sh                  # 旧版一键启动脚本（保留）
├── DESIGN.md                 # 设计系统规范
├── AGENTS.md                 # AI 助手开发指南
└── docs/harness/records/     # 变更记录
```

## 快速开始

### 依赖准备

| 工具 | 用途 | 安装 |
| --- | --- | --- |
| Node ≥ 20 + pnpm | 前端 | https://nodejs.org + `npm i -g pnpm` |
| Rust (stable) | 后端 | https://rustup.rs |
| yt-dlp | 音频下载（Whisper 路径） | `brew install yt-dlp` |
| ffmpeg | 音频转码 / 视频截图 | `brew install ffmpeg` |

Whisper 模型首次使用时自动从 HuggingFace 下载到 `backend/models/ggml-base.bin`，可用 `WHISPER_MODEL_PATH` 改路径。

### 一键启动（推荐）

```bash
make install     # 首次：pnpm install + cargo fetch
make dev         # 并行启动前后端，Ctrl-C 同时退出
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:8787>

### 手动启动

```bash
# 后端
cd backend && cargo run           # 监听 0.0.0.0:8787

# 前端（另起一个终端）
cd frontend && pnpm install && pnpm dev
```

### 旧版脚本

```bash
bash start.sh                     # 仍可用，行为同 make install + make dev
```

## 常用 make 目标

```bash
make help         # 列出全部目标
make install      # 安装前后端依赖
make dev          # 并行启动开发服务
make build        # 生产构建（cargo build --release + vite build）
make run          # 跑生产构建产物
make check        # 快速类型检查（cargo check + tsc --noEmit）
make test         # 跑测试（当前 0 个，详见 AGENTS.md）
make clean        # 清理所有构建产物
```

可用变量：`FRONTEND_PORT=5173 BACKEND_PORT=8787 VITE_API_BASE=...`，例如 `make dev FRONTEND_PORT=3000`。

## 环境变量

| 变量 | 端 | 默认 | 作用 |
| --- | --- | --- | --- |
| `VITE_API_BASE` | 前端 | `http://localhost:8787` | 后端地址（`make dev` 自动设置） |
| `OUTPUT_DIR` | 后端 | `output` | 产物输出目录，挂在 `/output/*` |
| `RUST_LOG` | 后端 | `info` | tracing 日志级别 |
| `WHISPER_MODEL_PATH` | 后端 | `models/ggml-base.bin` | Whisper 模型路径 |
| `SUMMARY_HTML_SUBTITLE` | 后端 | `东方简约信纸 · Video Summary` | HTML 模板副标题 |
| `SUMMARY_HTML_STAMP` | 后端 | `摘要` | HTML 模板印章文字 |

> LLM 的 `api_key` / `base_url` / `model` / `prompt` / `cookie` 是**每次请求**的字段，在 UI「设置」面板里填写，不会进环境变量。

## 使用流程

1. 打开 <http://localhost:5173>
2. 点击「设置」填入 API Key（必填），可按需填 Base URL、模型、Cookie、提示词等
3. 粘贴 B 站 / YouTube 链接，点击「生成摘要」
4. 在结果区切 Tab 查看 摘要 / 字幕 / 原始 Markdown，复制或下载 `.md` / `.html`

## API 说明

### `POST /api/summarize`

请求体：

```json
{
  "url": "https://www.bilibili.com/video/BV1xx4y1x7xx",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "base_url": "https://api.openai.com/v1",
  "prompt": "（可选，支持 {{title}} / {{transcript}} 模板）",
  "cookie": "（可选，B 站会员字幕用）",
  "stt_language": "zh-cn",
  "refine_transcript": true,
  "screenshot": false
}
```

只有 `url` 与 `api_key` 必填，其余可省。

响应体：

```json
{
  "run_id": "20260326-123456-abc123",
  "title": "视频标题",
  "summary": "一句话高密度摘要",
  "markdown": "# 标题\n\n...",
  "html": "<!doctype html>...",
  "html_subtitle": "东方简约信纸 · Video Summary",
  "html_stamp": "摘要",
  "transcript": "完整字幕拼接文本",
  "transcript_segments": [
    { "start": 12.3, "end": 15.4, "text": "字幕片段" }
  ],
  "transcript_source": "subtitle"
}
```

`transcript_source` ∈ `subtitle | whisper | whisper_refined`。所有失败统一返回 `HTTP 400 + {"message": "..."}`。

产物文件落到 `${OUTPUT_DIR}/{run_id}/`：`summary_{run_id}.md`、`summary_{run_id}.html`、`transcript_{run_id}.txt`，通过 `GET /output/{run_id}/` 访问。

## 许可与致谢

灵感来自 [BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) 与 [BiliNote](https://github.com/JefferyHcool/BiliNote)。视觉设计参照 Anthropic Claude 的暖色编辑风格（详见 `DESIGN.md`）。
