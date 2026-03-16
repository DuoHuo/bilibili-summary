# SiriusX Summary Web

SiriusX Summary Web 是一个前后端可部署的摘要应用：
- 前端：React + Vite
- 后端：Rust + Axum

本项目在思路与体验上受到 [BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) 与 [BiliNote](https://github.com/JefferyHcool/BiliNote) 启发，感谢这些开源项目的探索与贡献。

## 功能概览

- 支持 B 站 / YouTube 链接摘要
- 生成摘要与结构化 Markdown
- 支持自定义模型与 API Endpoint
- 支持本地字幕/音频转写

## 目录结构

```
siriusx-summary/
├── frontend/   # React + Vite
├── backend/    # Rust + Axum
└── start.sh    # 一键启动脚本
```

## 一键启动

```bash
bash start.sh
```

脚本会自动完成：
1. 安装前端依赖
2. 构建后端依赖
3. 启动后端服务
4. 启动前端开发服务器

## 手动启动

### 后端

```bash
cd backend
cargo run
```

默认端口：`http://localhost:8787`

### 前端

```bash
cd frontend
pnpm install
pnpm dev
```

默认端口：`http://localhost:5173`

## 环境变量

前端通过 `VITE_API_BASE` 指定后端地址，例如：

```bash
VITE_API_BASE=http://localhost:8787
```

## 依赖准备

后端本地转写依赖：

- `yt-dlp`：下载音频
- `ffmpeg`：音频转码
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
