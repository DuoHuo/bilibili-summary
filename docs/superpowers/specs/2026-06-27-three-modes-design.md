# 三模式分流设计

**Date**: 2026-06-27
**Status**: Approved (pending spec review)
**Scope**: 前端模式选择 + 后端 mode 分发 + 三套 prompt 重写 + timestamp 模式的代码合并

---

## 1. 背景与动机

当前实现存在三个核心问题：

1. **"摘要"不是摘要**：默认 prompt 过弱，LLM 直接逐句重述字幕，没有抽象。
2. **字幕碎片化**：Whisper 输出 1-2 秒/段；现有 `refine_transcript_with_llm` 强制"行数对齐"，把碎片原样保留，只逐行润色，结果不可读。
3. **架构错配**：前端已有 `summary/transcript/custom` 三模式但只是切换 prompt 文本，后端完全无模式感知，且对所有 Whisper 来源强制跑 `refine_transcript_with_llm`，与用户意图脱钩。

用户的真实需求是按场景选产物形态，而不是选 prompt 文本。

## 2. 目标 / 非目标

**目标**：
- 三种主模式 + custom，每种产物形态明确、互不重叠
- 摘要模式产出真正的主题级抽象，无时间戳
- 全文模式产出流畅文章，无时间戳
- 时间戳模式产出可读的 15s 颗粒度时间字幕，时间精确、文本经过语义修正
- 模式选择器从设置面板移到主页 URL 表单旁

**非目标**：
- 不重做 HTML 信纸模板的视觉
- 不改字幕抓取 / Whisper 转写链路
- 不引入新的 LLM 提供商或 model 字段
- 不做模式相关的 A/B 测试或埋点

## 3. 模式定义

|模式键|UI 标签|产物形态|LLM 调用|时间戳|
|---|---|---|---|---|
|`summary`|摘要|核心论点 / 关键要点 / 启示——主题级抽象|1 次|无|
|`fulltext`|全文|流畅文章，按话题分 3-6 段，带 H3 小标题|1 次|无|
|`timestamp`|时间戳|`[mm:ss-mm:ss]` 整理后文本，每段 ≥15s|1 次（1:1 修正）+ 代码合并|有|
|`custom`|自定义|用户自编辑 prompt 决定|1 次|由 prompt 决定|

默认 `summary`。

## 4. 关键架构决策

### 4.1 后端只在 timestamp 模式感知 mode

`summary / fulltext / custom` 仍是"前端选 prompt 文本 → 后端通用 LLM 调用"的纯流水线，后端**无需理解** mode。

`timestamp` 需要做"1:1 段级修正 + 代码合并"两步，所以后端必须感知。新增 `SummarizeRequest.mode` 字段，**仅 `timestamp` 走特殊分支**，其他模式忽略该字段。

这样最小化后端侵入：4 个模式中 3 个仍是 prompt-in-text-out。

### 4.2 删除 `refine_transcript_with_llm`

现有对所有 Whisper 来源强制的 `refine_transcript_with_llm` 被新模式体系完全替代：
- 想要"修正 Whisper 错字"的用户 → 选 `timestamp` 或 `fulltext`
- 想要"摘要"的用户 → 选 `summary`（不再被强制先跑一次 refine）

删除后 `TranscriptSource::WhisperRefined` 也随之消失。

### 4.3 Timestamp 模式的两步流程

**Step 1 — LLM 1:1 段级修正**：
- 输入：标题 + 带行号的字幕段（每行一段）
- Prompt 约束：每行输入对应一行输出，**不合并、不拆分、不增删行**
- LLM 利用标题与上下文修正同音错字、专有名词（"家底谈"→"Karpathy"、"爆破大叔"→"Uncle Bob"）

**Step 2 — 代码合并**（新 helper `merge_transcript_segments`）：

贪心算法（伪代码）：

```
chunks = []
cur = segments[0]
for next in segments[1:]:
    if next.end - cur.start < target_duration_secs:
        cur = merge(cur, next)   # cur.text += " " + next.text; cur.end = next.end
    else:
        chunks.push(cur)
        cur = next
chunks.push(cur)
```

规则一句话：**累计时长达到 15s 就切新段**。单段已超 15s 则独立成 chunk（不会强行截断）；最后一段可短。文本用单个空格连接（保留 LLM 修正后的标点）。时间戳取 chunk 内首段的 `start` 与末段的 `end`。

阈值常量：`const TIMESTAMP_MERGE_THRESHOLD_SECS: f64 = 15.0;`

LLM 只做语义修正（擅长），代码做时间算术（确定）。

## 5. Prompt 模板

### 5.1 `summary` 模板（`SUMMARY_PROMPT`）

```
你是视频内容摘要助手。请基于以下视频标题与字幕，输出一份结构化摘要。

标题：{{title}}

字幕：
{{transcript}}

输出（Markdown 格式）：

## 核心论点

一句话（40-60 字）概括视频最核心的观点或结论。

## 关键要点

3-5 条 bullet，列出视频中最重要的论点、证据或结论。每条 1-2 句，不要简单重复字幕原文。

## 启示

一段 100-200 字的反思，说明这些要点为何重要、对读者意味着什么。

要求：
- 全部用简体中文
- 不要逐句重述字幕
- 不要带时间戳
- 不要编造字幕里不存在的内容
```

### 5.2 `fulltext` 模板（`FULLTEXT_PROMPT`，新增）

```
你是字幕改写助手。请把以下视频字幕改写成一篇流畅可读的文章。

标题：{{title}}

原始字幕：
{{transcript}}

改写要求：
1. 按话题分 3-6 段，每段加 H3 小标题（###）
2. 用标题和上下文修正专有名词、同音错字、口误
3. 去掉语气词、重复、明显口误
4. 不新增字幕里不存在的事实、观点、例子
5. 不带时间戳
6. 全部转为简体中文
7. 输出 Markdown
```

### 5.3 `timestamp` 模板（`TIMESTAMP_PROMPT`，1:1 段级修正）

```
你是字幕校对助手。请对以下字幕做 1:1 段级校对。

标题：{{title}}

字幕（每行一段，严格对齐）：
{{transcript}}

校对要求：
1. 每行输入对应一行输出，**不要合并、拆分、增删行**
2. 利用标题和上下文修正同音错字、专有名词（如 "家底谈" 修正为 "Karpathy"，"爆破大叔" 修正为 "Uncle Bob"）
3. 修正明显口误、错别字、标点
4. 保持原意，不改变语气
5. 全部转为简体中文

输出：每行一段，行数与输入严格一致。不要输出任何解释、行号或前缀。
```

**`{{transcript}}` 填入格式按 mode 分流**（由后端 `BuildPromptNode` 决定）：
- `summary` / `fulltext` / `custom`：沿用现有 `format_transcript_with_timestamps`（`utils.rs`），即带 `[mm:ss]` 前缀的逐段文本——上下文越完整，LLM 改写越好
- `timestamp`：**不带时间戳**，纯文本每行一段（`segments[i].text` 用 `\n` 连接），方便 LLM 1:1 对齐输出

### 5.4 `custom` 模板

保留 `LEGACY_PROMPT` 作为 custom 模式的初始值。custom 模式不参与主页 segmented control，由独立弹窗编辑。

## 6. 前端 UX 变更

### 6.1 主页加 segmented control

`UrlForm` 下方加一行 3 选 1 按钮组：`摘要 / 全文 / 时间戳`。
绑定到 `config.promptMode`（值集变更：`summary | fulltext | timestamp | custom`）。

### 6.2 custom 模式独立弹窗

- segmented control 旁边加一个"自定义模板"次级按钮（或文字链）
- 点击后弹出 `CustomPromptDialog`（新组件）：内嵌 textarea 编辑 `config.prompt`，保存即把 `promptMode` 设为 `custom`
- 从 custom 切回三个主模式任意一个，`promptMode` 变更但 `prompt` 字段保留（下次切回 custom 仍在）

### 6.3 设置面板瘦身

`SettingsPanel` 中关于 prompt mode 的整个 Section（radio cards + textarea）**全部移除**。设置面板只保留：鉴权、Base URL/Model、cookie、STT 语言、screenshot 开关。

### 6.4 类型变更

```ts
// frontend/src/lib/prompts.ts
export type PromptMode = "summary" | "fulltext" | "timestamp" | "custom"

// 新增 FULLTEXT_PROMPT、TIMESTAMP_PROMPT
// 重写 SUMMARY_PROMPT（去时间戳要求）
// 保留 LEGACY_PROMPT
// resolvePrompt 改为 4 路分支
```

```ts
// frontend/src/lib/types.ts
// UserConfig.promptMode 类型同步扩展
// isUserConfig 的 PROMPT_MODES 数组扩展
// 旧值 "transcript" → 在 loadConfig 时迁移为 "timestamp"
```

## 7. 后端变更

### 7.1 API 契约

```rust
// SummarizeRequest 新增字段
pub mode: Option<String>,
```

接受 `"summary" | "fulltext" | "timestamp" | "custom"`。缺失或未识别值当 `"summary"`。

响应 `SummarizeResponse` 形状不变（`summary`、`markdown`、`html`、`transcript_segments` 等），内容随 mode 变化。

### 7.2 工作流分发

`build_flow_context` 把 `mode` 写入 Context。

`BuildPromptNode`：
- 仍负责把 `{{title}}` / `{{transcript}}` 替换为最终 prompt 文本
- timestamp 模式时，`transcript` 用"每行一段"格式（仅文本，无时间戳）
- 其他模式用 `format_transcript_with_timestamps`（现有 utils 函数）或类似格式

`CallLlmNode`：
- **删除** `refine_transcript` 分支（不再无条件对 Whisper 来源跑 refine）
- timestamp 模式时：
  1. 用 LLM 做 1:1 修正
  2. 调 `merge_transcript_segments` 合并
  3. 把合并后的 segments 写回 Context
- 其他模式：单次 LLM 调用，原样返回

### 7.3 新 helper：`merge_transcript_segments`

`services.rs` 新增纯函数：

```rust
fn merge_transcript_segments(
    segments: Vec<TranscriptSegment>,
    target_duration_secs: f64
) -> Vec<TranscriptSegment>
```

算法见 §4.3 Step 2。阈值常量：`const TIMESTAMP_MERGE_THRESHOLD_SECS: f64 = 15.0;`

### 7.4 删除清单

|符号|位置|原因|
|---|---|---|
|`refine_transcript_with_llm`|summarize.rs:492-516|被 timestamp 模式替代|
|`apply_refined_transcript`|summarize.rs:519-544|同上|
|`TranscriptSource::WhisperRefined`|services.rs:37|润色概念不再存在|
|`format_transcript_source` 中 `WhisperRefined` 分支|services.rs:915|同上|
|`CallLlmNode` 中 `refine_transcript` / `refined_*` 全部逻辑|summarize.rs:799-830|解耦|
|前端 `TranscriptSource` 类型 `"whisper_refined"`|types.ts:12|同上|

## 8. 迁移

### 8.1 IndexedDB 配置

`loadConfig`（`frontend/src/lib/config.ts`）在返回前做映射：
- `promptMode === "transcript"` → 改写为 `"timestamp"`
- `promptMode === "summary"` → 保留
- `promptMode === "custom"` → 保留
- `promptMode === "fulltext"` → 保留（虽然旧配置不会有）
- 缺失 → 默认 `"summary"`

### 8.2 后端 mode 字段

缺失或未识别值 → `"summary"`。

### 8.3 输出产物兼容

- `transcript_segments` 在 `summary` / `fulltext` / `custom` 模式：返回原始 Whisper segments（不再 refine）
- `timestamp` 模式：返回合并后的 segments
- `transcript_source`：只剩 `"subtitle" | "whisper" | null`

## 9. 验证计划

- **单元测试**（新增，`backend/src/services.rs` 内 `#[cfg(test)]`）：
  - `merge_transcript_segments` 输入空、单段、恰好 15s、单段超 15s、跨多段合并
- **手动端到端**：
  - 同一视频（`BV16WEg6GEgZ`）跑 4 种模式，确认产物形态符合表格定义
  - timestamp 模式产物：检查段数 ≈ 视频时长 / 15s、文本含修正后的专有名词（如 "Karpathy"）、无 1-2s 碎片
  - summary 模式产物：含三个 H2 小节、无时间戳、无逐句重述
- **回归**：`make check` 通过；前端 `pnpm build` 通过

## 10. 未来工作（明确不在本次范围）

- HTML 信纸模板视觉重做
- 摘要模式支持"挂关键时间锚点"（曾被讨论，本轮已去掉）
- 自定义模板的版本管理 / 分享
- 模式切换的键盘快捷键

---

## 附录：决策日志

- **Q1 时间戳模式走 LLM 吗** → 走（用户决策：很多字符需语义推断）
- **Q2 摘要 / 全文带时间戳吗** → 不带（用户决策）
- **Q3 模式选择器位置** → 主页（用户决策）
- **Q4 custom 模式保留吗** → 保留，独立弹窗配置（用户决策）
- **Q5 timestamp 合并阈值** → 15s（用户决策）
