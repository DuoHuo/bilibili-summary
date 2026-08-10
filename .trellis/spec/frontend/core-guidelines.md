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
├── errors/           # AppError + 错误码注册表 + trace_id/diagnostic_id + tailLines（纯函数）
├── log/              # 结构化诊断日志纯逻辑：级别过滤 / 双通路脱敏 / 事件组包（纯函数，不做文件 I/O）
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
4. **可诊断错误**：需要错误码/诊断信息的失败路径（如外部子进程调用失败）throw `AppError`（`core/errors/`），不直接 `throw new Error(...)`。`AppError.message` 自包含人话+错误码+8 位诊断 ID 三段，因为 `lib/api.ts` 的 `SummarizeError` 包装层只透传 `err.message`，其余字段会丢失。非进程类错误（参数校验/业务逻辑失败）仍可用普通 `Error`。
5. **日志事件**：若需记结构化诊断日志，统一经 `core/log/buildLogEvent` 组包输出（强制脱敏出口，不可绕过），不要自己拼接 JSON 或直接 `console.*`。事件名字格式 `domain.action_result`。`SummarizeDeps.logger?` 为可选字段，未提供时用 `createNoopLogger()` 兜底。
6. **进度上报**：`deps.onProgress(stage, detail?)`，stage 枚举见 `types.ts` 的 `Stage`；子进程逐行进度由 `runner` 的 `onLine` 转发。

## 错误与诊断日志约定（`core/errors/` + `core/log/`）

- `AppError(code, { traceId, context?, cause? })`：`code` 查 `errors/codes.ts` 的 `ERROR_MESSAGES` 注册表得到人话文案，未知 code 兜底用 code 本身当消息（不会因报错而再抛错）。
- `trace_id`（`errors/trace.ts::generateTraceId()`）在每次可诊断操作的**入口**独立生成，**不能**直接用 `run_id` 代替（`run_id` 可选且大量失败发生在 run_id 存在之前，如 `llmProbe.ts`/OAuth/URL 解析）。面向用户的 `diagnosticId` 由 `deriveDiagnosticId(traceId)` 派生（Crockford base32 前 8 位，剔除易混字符），不单独生成第二个 ID。
- 子进程调用失败时，不要新建缓冲区收集输出：`ExternalRunResult.stdout/stderr` 已是（Rust `run_external` 侧）全量无损文本，直接用 `errors/app-error.ts::tailLines(text, maxLines)` 对已返回字符串取尾部即可，装入 `AppError.context.stdoutTail`/`stderrTail`。
- 敏感字段脱敏双通路（`log/redact.ts`）：结构化键名（`api_key`/`cookie`/`base_url` 等）用 `redactSensitiveKeys`；自由文本（如 `stdoutTail`/`stderrTail` 里的 URL token/SESSDATA 片段）用 `redactFreeText` 正则匹配。新增敏感字段/模式时两路都要考虑，单靠键名规则拦不住自由文本里的值。
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
