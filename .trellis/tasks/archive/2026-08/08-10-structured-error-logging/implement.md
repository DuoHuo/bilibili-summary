# 执行计划：结构化错误与诊断日志基础设施

参考 `design.md` 的模块划分。按顺序执行，每步都能独立跑通类型检查 + 相关单测。

## Step 1：`core/errors/` —— trace_id / diagnostic_id / tailLines

- 新建 `frontend/src/core/errors/trace.ts`：`generateTraceId()`（`crypto.randomUUID()`）+ `deriveDiagnosticId(traceId)`（对 traceId 做确定性映射，取 Crockford base32 字母表前 8 位；不要求密码学强度，只要求同输入同输出 + 无易混字符）
- 新建 `frontend/src/core/errors/app-error.ts`：`tailLines(text, maxLines)` 纯函数
- 单测：`trace.test.ts`（同一 traceId 两次调用 `deriveDiagnosticId` 结果一致；不同 traceId 大概率不同；输出只含 Crockford 字母表字符）、`tailLines` 边界（空/undefined、行数=maxLines、行数>maxLines、单行超长文本）

**验证**：`pnpm --filter ./frontend test core/errors`

## Step 2：`core/errors/` —— AppError + 错误码注册表

- 新建 `frontend/src/core/errors/codes.ts`：`ERROR_MESSAGES` 四个错误码（见 design.md）
- 新建 `app-error.ts` 中的 `AppError` 类：构造时用 `code` 查 `ERROR_MESSAGES`（未知 code 兜底用 code 本身当消息，不 throw，避免"抛错误时再抛一个错误"）
- 新建 `frontend/src/core/errors/index.ts` re-export
- 单测：`app-error.test.ts` —— `error.message` 包含人话/错误码/诊断ID三段；`error.code`/`error.traceId`/`error.diagnosticId`/`error.context` 字段正确；`instanceof Error` 且 `instanceof AppError`；未知错误码兜底行为

**验证**：`pnpm --filter ./frontend test core/errors`

## Step 3：`whisper/download.ts` 四处报错点改造

- `downloadAudioWithYtdlp`：函数入口生成 `traceId`；`exitCode !== 0` 分支 → `throw new AppError("WHISPER.YTDLP_DOWNLOAD_FAILED", { traceId, context: { exitCode: result.exitCode, stdoutTail: tailLines(result.stdout, 200), stderrTail: tailLines(result.stderr, 200) } })`；wav 未找到分支 → `AppError("WHISPER.WAV_NOT_FOUND", { traceId })`（无 stdout/stderr 可带，因为这是本地文件系统检查失败，不是进程失败）
- `downloadVideoWithYtdlp`：同构改造，用 `WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED` / `WHISPER.MP4_NOT_FOUND`
- 更新 `frontend/src/core/whisper/download.test.ts`：现有对精确错误消息字符串的断言（如 `.toThrow("下载音频失败，请检查 yt-dlp 输出")`）改为断言 `instanceof AppError` + `error.code === "WHISPER.YTDLP_DOWNLOAD_FAILED"`；新增用例覆盖 `context.stdoutTail`/`stderrTail` 在 `runner` mock 返回非零 exitCode + 非空 stdout/stderr 时被正确截取

**验证**：`pnpm --filter ./frontend test core/whisper` — 确认无回归，新增用例通过

## Step 3b（新增）：`core/llm/client.ts` + `core/whisper/index.ts` 共 6 处报错点改造

（Step 1-2 已完成，`core/errors/` 可直接复用；本步不依赖 Step 4-6）

- `frontend/src/core/errors/codes.ts` 新增 6 个错误码：`LLM.CALL_FAILED` / `LLM.INVALID_ENDPOINT` / `LLM.PARSE_RESPONSE_FAILED` / `WHISPER.TRANSCRIBE_FAILED` / `WHISPER.PARSE_RESULT_FAILED` / `WHISPER.EMPTY_RESULT`（文案见 design.md）
- `core/llm/client.ts::callLlm`：函数入口生成 `traceId`；`resolveEndpoint` 抛出的 `Error("自定义端点不能为空")` 在 `callLlm` 内 catch 后 rethrow 为 `AppError("LLM.INVALID_ENDPOINT", { traceId })`；`!resp.ok` 分支 → `AppError("LLM.CALL_FAILED", { traceId, context: { status: resp.status } })`；`JSON.parse` catch 分支 → `AppError("LLM.PARSE_RESPONSE_FAILED", { traceId })`
- `core/whisper/index.ts`：`transcribeWithWhisperCli` 入口生成 `traceId`（或由调用方 `transcribeWithWhisper` 传入，保持同一次转写操作共用一个 trace_id）；`exitCode !== 0` → `AppError("WHISPER.TRANSCRIBE_FAILED", { traceId, context: { exitCode: result.exitCode } })`；`JSON.parse` catch → `AppError("WHISPER.PARSE_RESULT_FAILED", { traceId })`；`segments.length === 0` → `AppError("WHISPER.EMPTY_RESULT", { traceId })`
- 不需要 `tailLines`/`stdoutTail`/`stderrTail`（非子进程 diagnostics）
- 更新 `frontend/src/core/llm/client.test.ts`：将 `.rejects.toThrow("模型调用失败")` 类精确字符串断言改为 `instanceof AppError` + `error.code === "LLM.CALL_FAILED"`（其余两个错误分支同理）；新增/更新 `frontend/src/core/whisper/index.test.ts`（若不存在则新建）同样断言 `WHISPER.TRANSCRIBE_FAILED` / `WHISPER.PARSE_RESULT_FAILED` / `WHISPER.EMPTY_RESULT` 三种分支
- 回归确认：`frontend/src/lib/llmProbe.ts` 不需改动——它的 catch 分支用 `err instanceof Error ? err.message : ...` 兜底，`AppError extends Error`，`.message` 仍可读，`resolveEndpoint` 本身不改（仍抛普通 `Error`，只在 `callLlm` 内部做 catch-and-rethrow）

**验证**：`pnpm --filter ./frontend test core/llm core/whisper` —— 确认无回归，新增用例通过；人工确认 UI 层（`sessions.ts`/`settings-panel.tsx`）无需改动（只透传 `error.message`，文案变化自动体现）
## Step 4：`core/log/` —— levels + redact

- 新建 `frontend/src/core/log/levels.ts`：`LOG_LEVELS` + `shouldLog`
- 新建 `frontend/src/core/log/redact.ts`：`redactSensitiveKeys`（结构化键名通路）+ `redactFreeText`（自由文本正则通路，见 design.md 两条 pattern）
- 单测：`levels.test.ts`（4×4=16 组合的过滤矩阵，或至少覆盖等于/高于/低于阈值三种边界）；`redact.test.ts`（`redactSensitiveKeys` 命中 `api_key`/`apiKey`/`cookie`/`base_url`/`baseUrl` 五个键名变体 + 嵌套对象/数组场景 + 未命中字段不受影响；`redactFreeText` 命中 URL query 中 `token=`/`key=`/`sign=`/`sessdata=`/`bili_jct=` 参数值 + `SESSDATA=xxx;` 片段 + 未命中普通文本不受影响）

**验证**：`pnpm --filter ./frontend test core/log`

## Step 5：`core/log/` —— event 组包 + Logger + noop 实现

- 新建 `frontend/src/core/log/event.ts`：`LogEvent` 接口、`Logger` 接口、`buildLogEvent`（事件名校验 + `redactSensitiveKeys` + 对所有字符串字段应用 `redactFreeText` 的深度遍历辅助函数，可命名 `deepMapStrings`）、`createNoopLogger`
- 新建 `frontend/src/core/log/index.ts` re-export
- 单测：`event.test.ts` —— 合规事件名通过、不合规事件名（无点分隔/大写/单段）抛错；`buildLogEvent` 输出必含 `ts/level/event/trace_id`；传入含 `api_key` 字段的 `err.context` 时输出被脱敏；传入含 token 查询串的 `stderrTail` 时输出被脱敏；`createNoopLogger` 按阈值过滤（DEBUG 默认不过、INFO 默认放行）

**验证**：`pnpm --filter ./frontend test core/log`

## Step 6：`SummarizeDeps` 接入 + 全量回归

- `core/types.ts`：`SummarizeDeps` 新增 `logger?: Logger`（`import type { Logger } from "./log"`）
- 不修改 `runSummarize` 内部逻辑（本任务不要求接入实际日志写入点，见 design.md「数据流」小节说明）——仅确保类型接入后编译通过
- 全量验证：
  - `pnpm --filter ./frontend check`（类型检查全绿，尤其确认十余个手写 `SummarizeDeps` fake 的测试文件未受影响）
  - `pnpm --filter ./frontend test`（全量测试通过）
  - 人工确认改动文件列表不含 `Cargo.toml` / `src-tauri/src/commands.rs` / 任何 UI 组件（对齐 PRD AC7 / Out of Scope）

## 回滚点

- Step 1-2（`core/errors/`）与 Step 4-5（`core/log/`）互相独立，任一方向出问题可单独回滚而不影响另一方向
- Step 3（`download.ts` 改造）依赖 Step 1-2；若 Step 3 的测试更新出现大范围意外回归，可先回滚 Step 3 单独排查，`core/errors/`/`core/log/` 模块本身不受影响（尚未被其他代码引用）
- Step 6 是最后的集成点，改动量最小（一行类型声明），风险最低
