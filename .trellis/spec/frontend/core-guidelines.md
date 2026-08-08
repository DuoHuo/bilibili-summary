# Core Layer Guidelines (TS 核心层)

> `frontend/src/core/` — 纯业务逻辑层，不依赖 React/DOM，通过依赖注入与 UI 解耦。
> 2026-08 Tauri 迁移后新增（替代原 Rust 后端业务逻辑）。

---

## 目录结构

```
src/core/
├── types.ts          # 核心类型 + 依赖注入契约（SummarizeDeps）
├── platform/         # URL 解析 / 平台识别（纯函数）
├── subtitle/         # B站 / YouTube 字幕抓取（依赖 http）
├── transcript/       # 时间戳格式化 / 15s 段合并（纯函数）
├── whisper/          # yt-dlp 下载 / whisper-cli 转写 / cookie（依赖 runner）
├── llm/              # 提示词构建 / OpenAI 兼容调用（依赖 http）
├── render/           # Markdown 组装 / HTML 模板 / 截图标记 / 截图
├── workflow/         # 摘要流水线编排（runSummarize）
└── __fixtures__/     # 回归测试样本（B站/YouTube/LLM 响应 + golden HTML）
```

## 分层规则

1. **不 import React / DOM**：core 层只依赖 `@/lib/prompts`（纯常量模板）与自身模块。
2. **依赖注入**：网络、子进程、文件系统全部通过 `SummarizeDeps`（`types.ts`）注入——
   `http` / `runner` / `writeFile` / `readFile` / `isFile` / `resolveOutputDir` / `resolveModelPath`。
   测试用 fake deps，Tauri 运行用 `@/lib/tauri` 桥接。
3. **纯函数优先**：`platform/parse`、`transcript/*`、`render/markdown`、`render/markers` 均为无副作用纯函数，先行编写并单测。
4. **错误消息**：与旧 Rust 版保持一致（用户可读中文消息），由 `workflow` 向外抛出，UI 层 `SummarizeError` 包装。
5. **进度上报**：`deps.onProgress(stage, detail?)`，stage 枚举见 `types.ts` 的 `Stage`；子进程逐行进度由 `runner` 的 `onLine` 转发。

## 移植约定

- 每个模块头部注释标注移植来源（如 `移植自 backend/src/services.rs::xxx`），便于回归对照。
- HTML 模板与 Rust 版逐字节对齐，差异记录在 `render/README.md` 白名单。
- `workflow/index.ts` 是唯一编排入口：`runSummarize(input, deps) → SummarizeOutput`，UI 层不得绕过它直接调用各模块。

## 测试要求

- 纯函数模块：vitest 直接断言。
- 网络模块：mock `HttpFetch` 返回 `__fixtures__/` 样本。
- 子进程模块：fake `runner` 断言命令序列与参数。
- workflow：全链路 fake deps（字幕路径 + whisper 路径至少各一条）。
- golden 对照：`render/html.test.ts` 用 `normalizeWhitespace` 对齐 marked 与 pulldown-cmark 的表格换行差异。
