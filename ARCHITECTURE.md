# Video Summary Architecture

## 总览

Video Summary 是一个前后端可部署的摘要应用：前端采用 React + Vite，后端采用 Rust + Axum。用户在前端输入 B 站或 YouTube 链接，后端完成字幕获取/转写、调用大模型生成摘要与 Markdown，并将结果返回前端展示。

## 核心流程

1. 前端输入视频链接与模型配置，提交到后端 `/api/summarize`
2. 后端识别平台并拉取字幕或元信息
3. 若字幕缺失，使用本地 Whisper 进行转写
4. 构建提示词并调用大模型生成摘要
5. 组装 Markdown 与元数据，返回前端渲染

## 模块分层

### 1. Frontend（`frontend/`）

- `src/main.tsx`：前端入口，挂载 React 应用
- `src/App.tsx`：核心 UI 与交互逻辑
- `src/style.css`：样式文件

### 2. Backend（`backend/`）

- `src/main.rs`：服务入口，注册路由与 CORS
- `src/summarize.rs`：`POST /api/summarize`，PocketFlow 工作流与接口模型
- `src/services.rs`：业务服务层（平台解析、字幕获取、Whisper 转写、模型调用）
- `src/utils.rs`：格式化与字幕解析工具

## 关键设计点

- **前后端分离**：前端仅负责输入与展示，后端集中处理摘要逻辑
- **平台检测与转写兜底**：字幕不可用时自动转写，保证可用性
- **统一 Markdown 组装**：后端输出结构化 Markdown，前端直接渲染
- **Rust 服务稳定性**：Axum + async 处理并发，日志记录关键流程

## Harness 对齐

- Harness 记录目录：`docs/harness/records/`
- 任务收尾提醒（Harness 同步）：完成改动后执行 `harness-doc-sync`

## L0-L3 架构标记

- L0: 用户入口与前端体验
- L1: 后端 API 与工作流编排
- L2: 业务服务与外部依赖（平台/模型/Whisper）
- L3: 工具与格式化层
