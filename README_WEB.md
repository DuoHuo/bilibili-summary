# Memflow Web (Frontend + Rust Backend)

本项目将原浏览器扩展改造为前后端可部署应用：
- 前端：React + Vite
- 后端：Rust + Axum

## 目录结构

```
memflow/
├── frontend/   # React + Vite
└── backend/    # Rust + Axum
```

## 后端启动

```bash
cd backend
cargo run
```

默认服务端口：`http://localhost:8787`

## 前端启动

```bash
cd frontend
pnpm install
pnpm dev
```

前端默认端口：`http://localhost:5173`

## 环境变量

前端通过 `VITE_API_BASE` 指定后端地址，例如：

```bash
VITE_API_BASE=http://localhost:8787
```

## 依赖准备

后端本地转写依赖以下工具：

- `yt-dlp`：用于下载 B 站 / YouTube 音频
- `ffmpeg`：用于音频转码（`yt-dlp` 需要）
- Whisper 模型：默认读取 `models/ggml-base.bin`，可通过 `WHISPER_MODEL_PATH` 指定

```bash
# Mac (Homebrew)
brew install yt-dlp ffmpeg
```

## 使用流程

1. 打开前端页面
2. 输入 B 站或 YouTube 视频链接
3. 选择模型提供商（OpenAI / DeepSeek）
4. 输入 API Key
5. 点击生成，返回摘要与 Markdown

## API 说明

`POST /api/summarize`

请求体：

```json
{
  "url": "https://www.bilibili.com/video/BV1xx4y1x7xx",
  "api_key": "你的APIKey",
  "model": "可选",
  "base_url": "可选，自定义端点 Base URL（会自动拼接 /chat/completions）",
  "prompt": "可选"
}
```

响应体：

```json
{
  "title": "视频标题",
  "summary": "摘要文本",
  "markdown": "Markdown内容",
  "transcript": "字幕内容(可为空)",
  "transcript_segments": [
    {
      "start": 12.3,
      "end": 15.4,
      "text": "字幕片段"
    }
  ],
  "transcript_source": "subtitle"
}
```
