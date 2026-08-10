# 结构化错误与诊断日志基础设施（Phase 0 + Phase 1）

## Goal

先修复用户实际遇到的痛点——`yt-dlp` 下载失败时只有一句"下载音频失败，请检查 yt-dlp 输出"，没有错误码、没有可复制诊断 ID、没有捕获的 stdout/stderr——再在此基础上补齐一套可复用的结构化诊断日志纯逻辑层（事件形状 / 级别 / 脱敏），为后续落盘、导出、热调级别打好地基。

本任务范围明确收敛为原始 7 条需求中的 **Phase 0 + Phase 1**：
- Phase 0：`AppError` + 错误码注册表 + `whisper/download.ts` 四处报错点携带 stdout/stderr 尾部
- Phase 0b（下述“模型调用失败”问题延伸）：`core/llm/client.ts` + `core/whisper/index.ts` 共 4 处裸 `Error` 改造为 `AppError`，区分大模型/STT 两类错误码
- Phase 1：`core/log/` 纯逻辑模块（JSON 事件组包、4 级过滤、双通路脱敏中间件、`domain.action_result` 命名）+ 单测

Phase 2（落盘 sink / 导出日志包 UI）、Phase 3（热调级别 + TTL 过期）以及审计日志管线是否需要，作为后续任务另行评估，**不在本任务范围内**。

## User Value

- 用户遇到 yt-dlp 下载失败时，看到的是**错误码 + 可复制诊断 ID + 一句人话**，而不是需要自己去猜"检查什么输出"
- 开发者排查问题时，诊断 ID 对应的 `AppError` 里带着**完整 stdout/stderr 尾部**（已脱敏），不用要求用户手动复制终端输出
- 后续任意模块要接入同一套诊断日志，直接复用 `core/log/` 纯逻辑，无需重新设计事件形状

## Confirmed Facts（代码证据）

### 现状：错误信息丢弃了 stdout/stderr
- `frontend/src/core/whisper/download.ts:72` `downloadAudioWithYtdlp`：`exitCode !== 0` 时 `throw new Error("下载音频失败，请检查 yt-dlp 输出")`，`result.stdout` / `result.stderr` 均未被使用
- 同函数 `:77`："下载音频失败，未找到 wav 文件"（wav 缺失，同样无诊断信息）
- `downloadVideoWithYtdlp`（`:96-97` `:100` 附近）同样两处：下载失败 / mp4 未找到
- `ExternalRunResult`（`core/types.ts`）已包含 `{ exitCode, stdout, stderr }`，字段齐全，只是调用方没用

### 已验证：Rust 侧输出是全量无损收集，非流式丢弃
- `src-tauri/src/commands.rs::run_external`（约 `:301-381`）：`stdout_task` / `stderr_task` 两个 tokio task 各自把逐行输出累积进本地 `collected: String`，同时经 `summary://progress` 事件转发给 `onLine` 用于实时进度展示
- 两个 task 在 `:369-370` 被 `.await`，取到的 `stdout_text` / `stderr_text` 直接装入 `:377-380` 返回的 `ExternalRunResult { stdout, stderr }`
- **结论**：`result.stdout` / `result.stderr` 已经是全量文本，失败诊断不需要新建"环形缓冲"组件——只需一个纯函数 `tailLines(text, maxLines)` 在诊断路径对已有字符串取尾部即可，零新状态、零签名改动
- 已知既有问题（本任务不修）：长时下载场景下 `collected` 无界累积在内存里，属 `run_external` 既有设计，留给 Phase 2 评估

### DI 契约与架构（单栈 TS 核心 + 极薄 Rust 壳）
- `SummarizeDeps`（`core/types.ts`）是核心层唯一依赖注入契约，`runSummarize` 为唯一入口
- `ExternalRunner`（`core/types.ts`）签名 **本任务不改动**：`(program, args, options?: { cwd, env, onLine, stage, id }) => Promise<ExternalRunResult>`；四处报错点直接对已返回的 `result.stdout/stderr` 取尾部即可，trace_id 在函数内部生成，不需要穿透 runner 签名
- `tauriRunner`（`frontend/src/lib/tauri.ts`）桥接到 Rust `run_external`，逐行输出经 `summary://progress` 事件转发到 `onLine`，`stage`/`id` 已做并发路由（本任务不涉及改动）
- 十余个现有测试文件（`whisper/*.test.ts`、`workflow/index.test.ts`、`llm/*.test.ts` 等）手写 `SummarizeDeps` fake 对象；`logger?:` 字段留到 Phase 1 再引入（Phase 0 完全不动 `SummarizeDeps`）

### trace_id 与诊断 ID 的关系
- `SummarizeRequest.run_id?` / `PrepareRequest.run_id?` 均为**可选**字段，且大量失败发生在 run_id 存在之前（`lib/llmProbe.ts`、`core/auth/bilibili.ts` OAuth、`core/platform/parse.ts`），因此 `trace_id` 不能直接等于 `run_id`
- `trace_id` 在每次可诊断操作的入口**独立生成**；`run_id`（若存在）作为日志事件的附加关联字段
- **诊断 ID 从 trace_id 派生**，不再独立生成第二个 ID：取 `trace_id` 的 base32 编码前 8 位（剔除易混字符 `0/O/1/I/L`）作为面向用户的 `diagnostic_id`。天然可反查，无需额外映射表存储

### Phase 0b：“模型调用失败”文案模糊问题（主人实测）
- 本机 `sessions.json` 历史记录只有一行 `"error": "模型调用失败"`，无任何其他诊断信息；本机系统日志（`log show`）中也无任何应用层错误细节——因为目前只有 `whisper/download.ts` 接了 `AppError`，其余调用点仍是裸 `Error`，无法落盘也无法区分。
- `"模型调用失败"` 在代码库中**只有一处来源**：`frontend/src/core/llm/client.ts:51` `callLlm` 函数 `if (!resp.ok) throw new Error("模型调用失败")`，专门调大模型接口，不会被 STT/Whisper 路径调用——代码路径本身未混，但文案用词模糊（“模型”在本 App 同时指大模型/Whisper 模型）。
- 真正的 STT 失败在 `frontend/src/core/whisper/index.ts`，共 3 处裸 `Error`：`:31 "Whisper 转写失败"`（whisper-cli exitCode 非零）、`:38 "解析 Whisper 转写结果失败"`（JSON 解析失败）、`:71 "Whisper 转写结果为空"`（segments 为空）。这 3 处 + `llm/client.ts` 1 处，共 4 处，都未接入 `AppError` 体系。
- 注意：`llm/client.ts:16` 的 `"自定义端点不能为空"` 与 `:57` 的 `"解析模型响应失败"` 是参数校验/解析错误（非外部进程调用失败），本次阶段一并改造为 `AppError`保持错误分类一致性，但不需要 stdout/stderr context（非子进程调用）。
### 敏感字段清单（本项目实际敏感面，非通用模板）
- `SummarizeRequest.api_key`：LLM API Key，明文流转（结构化字段，键名可匹配）
- `SummarizeRequest.cookie` / `GenerateRequest.cookie`：B 站 Cookie（含 SESSDATA / bili_jct），明文流转（结构化字段，键名可匹配）
- `SummarizeRequest.base_url`：自定义 API 地址，可能内嵌 token 查询参数（结构化字段，键名可匹配）
- 字幕/转写全文（`Transcript.text`、`TranscriptSegment.text`）：用户内容，禁止整体入日志
- **`stdoutTail` / `stderrTail` 是自由文本，键名匹配拦不住**：yt-dlp 输出里会出现带签名参数的媒体 URL（B 站 upos 鉴权参数）、`--cookies` 指向的文件路径、`SESSDATA=...` 片段等，必须靠正则值匹配拦截，键名规则对此无效
- "身份证"等字段在本项目**不存在**，不纳入脱敏规则（避免维护无意义规则）

### 未决问题（已问过用户，"开始吧"视为接受 advisor 收敛建议）
- 审计日志：不在本任务建立独立管线；后续任务视需要再评估
- 是否引入 `tauri-plugin-log`：本任务的 Phase 1 仅做纯逻辑（不落盘），落盘选型留给 Phase 2 任务评估

## Requirements

### Phase 0：AppError + 错误码 + stdout/stderr 尾部
- [ ] R1：新增 `AppError`（错误码 + 消息 + trace_id + diagnostic_id + 可选 context），定义于 core 层，供各模块 throw；`SummarizeDeps` / `ExternalRunner` 签名均不改动
- [ ] R2：建立错误码注册表（如 `WHISPER.YTDLP_DOWNLOAD_FAILED` / `WHISPER.WAV_NOT_FOUND` / `WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED` / `WHISPER.MP4_NOT_FOUND`），每个错误码对应一句人话文案
- [ ] R3：新增纯函数 `tailLines(text, maxLines)`：失败时（`exitCode !== 0`）分别对 `result.stdout` / `result.stderr` 取末 200 行，装入 `AppError` 的 `stdoutTail` / `stderrTail` context 字段（yt-dlp 进度/部分诊断在 stdout，`ERROR:` 与 ffmpeg postprocessor 报错在 stderr，两路都要取）
- [ ] R4：`whisper/download.ts` 四处报错点（`downloadAudioWithYtdlp` 两处、`downloadVideoWithYtdlp` 两处）改为 throw `AppError`，携带 trace_id、diagnostic_id、错误码、exitCode、`stdoutTail`/`stderrTail`
- [ ] R5：`trace_id` 在每次可诊断操作入口生成；`diagnostic_id` 由 `trace_id` 派生（base32 前 8 位，剔除 `0/O/1/I/L`），`AppError` 同时携带两者

### Phase 0b：大模型/STT 错误码区分
- [ ] R5b：新增错误码 `LLM.CALL_FAILED`（人话文案“大模型调用失败，请检查 API Key/Base URL/网络”），`core/llm/client.ts:51` 改为 throw `AppError`，携带 trace_id（入口生成）。
- [ ] R5c：`core/llm/client.ts` 剩余两处（`:16` 自定义端点为空、`:57` 解析响应失败）同步改为 `AppError`，新增错误码 `LLM.INVALID_ENDPOINT` / `LLM.PARSE_RESPONSE_FAILED`。
- [ ] R5d：新增错误码 `WHISPER.TRANSCRIBE_FAILED`（人话文案“语音转写失败，请检查音频文件或模型配置”）、`WHISPER.PARSE_RESULT_FAILED`、`WHISPER.EMPTY_RESULT`，`core/whisper/index.ts` 3 处裸 `Error`（`:31`/`:38`/`:71`）改为 throw `AppError`，携带 trace_id。
- [ ] R5e：以上 6 处均不需要 `stdoutTail`/`stderrTail`（非外部子进程调用失败），`AppError.context` 可为空或仅携带业务相关字段（如 HTTP status）。
### Phase 1：core/log/ 纯逻辑
- [ ] R6：`SummarizeDeps` 新增 `logger?:` **可选**字段（避免击穿现有测试 fake），并导出 `createNoopLogger()` 作为默认实现
- [ ] R7：新增 `frontend/src/core/log/` 模块，定义结构化日志事件的固定字段：`ts / level / event / trace_id / err`（`err` 为可选，仅错误事件携带）
- [ ] R8：事件命名规则校验/约束为 `domain.action_result` 形式（如 `whisper.download_failed`），可变信息放独立字段，不拼接进事件名或消息字符串
- [ ] R9：4 级实现：`ERROR / WARN / INFO / DEBUG`，纯函数级别过滤（给定当前级别阈值，判断某条日志是否应输出）
- [ ] R10：脱敏中间件，两条通路，在事件构造出口处强制应用、调用方无法绕过：
  - 结构化字段：递归遍历对象，键名命中 `api_key` / `cookie` / `base_url` 时整体替换为占位符
  - 自由文本：对字符串类字段（含 `stdoutTail` / `stderrTail` 等长文本）做正则值匹配，至少覆盖 URL 查询串中 `token|key|sign|sessdata|bili_jct` 参数的值、`SESSDATA=...` 片段
- [ ] R11：`core/log/` 所有函数均为纯函数（不做实际文件 I/O），可被单测直接调用而不需要 mock 文件系统

## Acceptance Criteria

- [x] AC1：`yt-dlp` 音频下载失败时，用户看到的错误包含错误码 + 8 字符诊断 ID + 一句人话；不再是裸的 `"下载音频失败，请检查 yt-dlp 输出"`
- [x] AC2：`AppError` 携带的 `stdoutTail` / `stderrTail` 均为非空时行数 ≤200（取尾部逻辑正确），且已经过脱敏中间件处理（不包含明文 token/cookie/sessdata 片段）
- [x] AC3：`downloadAudioWithYtdlp` / `downloadVideoWithYtdlp` 四处报错点全部改造完成，行为通过现有 + 新增单测验证
- [x] AC3b：`core/llm/client.ts`（3 处）+ `core/whisper/index.ts`（3 处）共 6 处报错点全部改为 `AppError`，`error.message` 能明确区分“大模型调用失败”与“语音转写失败”（不再是歧义的“模型调用失败”），行为通过现有 + 新增单测验证
- [x] AC4：Phase 0 不改动 `SummarizeDeps` / `ExternalRunner` 签名；Phase 1 新增的 `logger?:` 字段为可选，现有全部测试文件（`whisper/*.test.ts`、`workflow/index.test.ts`、`llm/*.test.ts` 等）无需改动即可通过编译与测试
- [x] AC5：`core/log/` 模块对以下场景有单测覆盖：级别过滤（4 档边界）、脱敏命中（结构化键名 `api_key`/`cookie`/`base_url` + 自由文本中的 token/sessdata 值）与未命中（不误伤正常字段）、事件字段完整性（`ts/level/event/trace_id` 必填、`err` 按需）
- [x] AC6：`pnpm --filter ./frontend check` 与 `pnpm --filter ./frontend test` 全绿
- [x] AC7：本任务不引入任何文件落盘逻辑、不修改 `Cargo.toml`、不新增 Rust 依赖、不改动 `src-tauri/src/commands.rs`（Phase 2 范围）

## Out of Scope（明确排除，供后续任务参照）

- 审计日志独立存储管线
- 文件滚动写入（10MB×7）、异步 buffered writer、`tauri-plugin-log` 选型
- 一键导出日志包 UI、上报授权流程
- 按模块热调 DEBUG 级别 + TTL 自动过期（配置读取与运行时下发）
- 原 7 条需求中的"采样/去重"机制（已被 advisor 判定为反模式：诊断日志采样会丢失解释失败原因的关键行；本任务改用尾部截断 + 脱敏替代）
- `run_external`（`commands.rs`）对长时下载的 stdout/stderr 无界内存累积——属既有设计问题，本任务不修
