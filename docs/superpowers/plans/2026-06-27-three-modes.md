# 三模式分流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有"前端切 prompt 文本、后端无模式感知"重构为四模式（summary / fulltext / timestamp / custom），其中 timestamp 走 LLM 1:1 修正 + 代码合并的专用流水线，删除强制 refine 链路。

**Architecture:** 后端只在 `timestamp` 模式感知 `mode`（其他模式保持 prompt-in-text-out 纯流水线）。新增 `merge_transcript_segments` 纯函数（贪心 15s 合并）+ 配套单元测试。删除 `refine_transcript_with_llm` + `apply_refined_transcript` + `TranscriptSource::WhisperRefined`。前端把模式选择器从 SettingsPanel 移到 UrlForm，custom 模式独立弹窗。

**Tech Stack:** Rust 2024 + Axum + PocketFlow（后端）；React 18 + Vite + TypeScript 5.9 strict + Tailwind v4 + shadcn/ui（前端）。

## Global Constraints

- **Rust style**: `snake_case`、`anyhow::Error + ?` 传播、`tracing::{info,warn,error}` 带表情前缀和中文注释
- **TypeScript style**: 无分号（ASI）、双引号、2-space 缩进、`@/*` 路径别名指向 `src/*`、`import type` 用于纯类型导入
- **TypeScript runtime rule**: 不使用 `new Promise((resolve, reject) => ...)`；用 `Promise.withResolvers()`
- **API error contract**: 所有 HTTP 错误统一塌成 `400 + {"message": ...}`，不新增状态码
- **Tests**: 项目当前 0 测试；本计划在 `services.rs` 内加 `#[cfg(test)] mod tests`（无需新 dev-dependencies）
- **Mode values**: `"summary" | "fulltext" | "timestamp" | "custom"`，未识别值当 `"summary"`
- **Merge threshold**: `TIMESTAMP_MERGE_THRESHOLD_SECS = 15.0`
- **No backward-compat shims**: 删除的代码彻底删，不留 alias / re-export / TODO 注释

**Spec reference**: `docs/superpowers/specs/2026-06-27-three-modes-design.md`

---

## File Structure

**Backend (Rust)**
- `backend/src/services.rs` — 删除 `TranscriptSource::WhisperRefined` + 对应 `format_transcript_source` 分支；新增 `merge_transcript_segments` + `TIMESTAMP_MERGE_THRESHOLD_SECS`；新增 `#[cfg(test)] mod tests`
- `backend/src/summarize.rs` — `SummarizeRequest` 加 `mode`；`build_flow_context` 写入 `mode`；`BuildPromptNode` 按 mode 分流 transcript 格式；`CallLlmNode` 按 mode 分发并删除 refine 分支；删除 `refine_transcript_with_llm` + `apply_refined_transcript`

**Frontend (TypeScript)**
- `frontend/src/lib/prompts.ts` — `PromptMode` 类型扩展；重写 `SUMMARY_PROMPT`；新增 `FULLTEXT_PROMPT`；`TRANSCRIPT_PROMPT` 改名 `TIMESTAMP_PROMPT` + 重写；`resolvePrompt` 4 路分支
- `frontend/src/lib/types.ts` — `TranscriptSource` 移除 `"whisper_refined"`；`PROMPT_MODES` 数组扩展
- `frontend/src/lib/config.ts` — `loadConfig` 加 `"transcript" → "timestamp"` 迁移
- `frontend/src/lib/api.ts` — `postSummarize` payload 加 `mode` 字段
- `frontend/src/components/custom-prompt-dialog.tsx` — 新组件，编辑 custom prompt
- `frontend/src/components/url-form.tsx` — 加 segmented control + 自定义模板按钮
- `frontend/src/components/settings-panel.tsx` — 删除 prompt mode Section
- `frontend/src/App.tsx` — 接 custom dialog 状态、传 `promptMode` 给 UrlForm

---

### Task 1: Backend `merge_transcript_segments` 纯函数 + 单元测试

**Files:**
- Modify: `backend/src/services.rs`（在文件末尾追加）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn merge_transcript_segments(segments: Vec<TranscriptSegment>, target_duration_secs: f64) -> Vec<TranscriptSegment>` 和 `const TIMESTAMP_MERGE_THRESHOLD_SECS: f64 = 15.0`

- [ ] **Step 1: 在 `services.rs` 末尾追加失败测试**

在 `backend/src/services.rs` 末尾追加（紧接 `format_transcript_source` 函数后）：

```rust
#[cfg(test)]
mod tests {
  use super::*;

  fn seg(start: f64, end: f64, text: &str) -> TranscriptSegment {
    TranscriptSegment { start, end, text: text.to_string() }
  }

  #[test]
  fn merge_empty_returns_empty() {
    assert!(merge_transcript_segments(vec![], 15.0).is_empty());
  }

  #[test]
  fn merge_single_short_segment_kept_as_is() {
    let result = merge_transcript_segments(vec![seg(0.0, 2.0, "你好")], 15.0);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].start, 0.0);
    assert_eq!(result[0].end, 2.0);
    assert_eq!(result[0].text, "你好");
  }

  #[test]
  fn merge_single_segment_over_threshold_kept_as_is() {
    let result = merge_transcript_segments(vec![seg(0.0, 20.0, "长段")], 15.0);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].end, 20.0);
    assert_eq!(result[0].text, "长段");
  }

  #[test]
  fn merge_concatenates_until_threshold_reached() {
    // A(0-3) B(3-7) C(7-12) D(12-18)
    // 加 B: 7-0=7 < 15 → merge AB(0-7)
    // 加 C: 12-0=12 < 15 → merge ABC(0-12)
    // 加 D: 18-0=18 ≥ 15 → push ABC, cur=D(12-18)
    // 末尾 push D
    let inputs = vec![
      seg(0.0, 3.0, "A"),
      seg(3.0, 7.0, "B"),
      seg(7.0, 12.0, "C"),
      seg(12.0, 18.0, "D")
    ];
    let result = merge_transcript_segments(inputs, 15.0);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].start, 0.0);
    assert_eq!(result[0].end, 12.0);
    assert_eq!(result[0].text, "A B C");
    assert_eq!(result[1].start, 12.0);
    assert_eq!(result[1].end, 18.0);
    assert_eq!(result[1].text, "D");
  }

  #[test]
  fn merge_last_chunk_can_be_short() {
    // A(0-5) B(5-10) C(10-15) D(15-17)
    // 加 B: 10-0=10 < 15 → merge AB(0-10)
    // 加 C: 15-0=15 ≥ 15 → push AB, cur=C(10-15)
    // 加 D: 17-10=7 < 15 → merge CD(10-17)
    let inputs = vec![
      seg(0.0, 5.0, "A"),
      seg(5.0, 10.0, "B"),
      seg(10.0, 15.0, "C"),
      seg(15.0, 17.0, "D")
    ];
    let result = merge_transcript_segments(inputs, 15.0);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].text, "A B");
    assert_eq!(result[1].text, "C D");
  }
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && cargo test merge_
```

Expected: 编译失败，`cannot find function merge_transcript_segments`。

- [ ] **Step 3: 在 `services.rs` 实现 `merge_transcript_segments`**

在 `format_transcript_source` 函数之前（约 services.rs:910 附近）插入：

```rust
/// Timestamp 模式：贪心合并相邻 segment 直到累计时长达到阈值。
/// 见 `docs/superpowers/specs/2026-06-27-three-modes-design.md` §4.3 Step 2。
const TIMESTAMP_MERGE_THRESHOLD_SECS: f64 = 15.0;

fn merge_transcript_segments(
  segments: Vec<TranscriptSegment>,
  target_duration_secs: f64
) -> Vec<TranscriptSegment> {
  if segments.is_empty() {
    return vec![];
  }
  let mut chunks: Vec<TranscriptSegment> = Vec::new();
  let mut cur = segments[0].clone();
  for next in segments.into_iter().skip(1) {
    if next.end - cur.start < target_duration_secs {
      cur.text.push(' ');
      cur.text.push_str(&next.text);
      cur.end = next.end;
    } else {
      chunks.push(std::mem::replace(&mut cur, next));
    }
  }
  chunks.push(cur);
  chunks
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && cargo test merge_
```

Expected: 5 个 test 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/services.rs
git commit -m "feat(backend): add merge_transcript_segments helper + unit tests

贪心合并 Whisper 相邻 segment 到 ≥15s 的 chunk，为 timestamp 模式做准备。
建立项目的第一个 #[cfg(test)] mod tests 模块。"
```

---

### Task 2: Backend 加 `SummarizeRequest.mode` 字段（无行为变更）

**Files:**
- Modify: `backend/src/summarize.rs`（`SummarizeRequest` 结构体 + `build_flow_context`）

**Interfaces:**
- Produces: `SummarizeRequest.mode: Option<String>`；Context key `"mode"`（值为 `"summary" | "fulltext" | "timestamp" | "custom"`，缺省 `"summary"`）

- [ ] **Step 1: 在 `SummarizeRequest` 加 `mode` 字段**

找到 `pub struct SummarizeRequest` 定义（约 `summarize.rs:37-47`），在 `screenshot` 字段后加：

```rust
  pub mode: Option<String>,
```

- [ ] **Step 2: 在 `build_flow_context` 写入 `mode` Context**

找到 `build_flow_context` 函数末尾（约 `summarize.rs:432-437`），在 `context.set("screenshot", ...)` 后加：

```rust
  let mode = request.mode.as_deref()
    .filter(|s| matches!(s, "summary" | "fulltext" | "timestamp" | "custom"))
    .unwrap_or("summary");
  context.set("mode", json!(mode));
```

- [ ] **Step 3: 验证编译**

```bash
cd backend && cargo check
```

Expected: 通过（新字段未被消费，但 `cargo check` 不报 unused）。

- [ ] **Step 4: Commit**

```bash
git add backend/src/summarize.rs
git commit -m "feat(backend): add mode field to SummarizeRequest + Context

未消费，仅声明。Task 3-4 开始按 mode 分发。"
```

---

### Task 3: Backend 删除 `refine_transcript` 代码路径

**Files:**
- Modify: `backend/src/services.rs`（删 enum variant + format 分支）
- Modify: `backend/src/summarize.rs`（删两个 helper + `CallLlmNode` 的 refine 分支）

**Interfaces:**
- Removes: `refine_transcript_with_llm`, `apply_refined_transcript`, `TranscriptSource::WhisperRefined`, `format_transcript_source` 的 `WhisperRefined` 分支
- CallLlmNode 不再无条件对 Whisper 来源跑 refine

- [ ] **Step 1: 删除 `services.rs` 中的 `TranscriptSource::WhisperRefined`**

找到 `pub enum TranscriptSource`（约 services.rs:34-38），删掉 `WhisperRefined` 这一行。

找到 `pub fn format_transcript_source`（约 services.rs:910-917），删掉 `TranscriptSource::WhisperRefined => "本地 Whisper 转写（模型润色）"` 这个 match arm。

- [ ] **Step 2: 删除 `summarize.rs` 的 `refine_transcript_with_llm` 和 `apply_refined_transcript`**

找到这两个函数（约 `summarize.rs:491-544`），整段删除（包括前面的注释 `// 调用大模型润色 Whisper 字幕` 和 `// 将润色后的文本回填到片段文本中`）。

- [ ] **Step 3: 简化 `CallLlmNode::execute`**

找到 `CallLlmNode::execute`（约 `summarize.rs:786-877`），删除以下变量与逻辑：

```rust
// 删除这些行（约 summarize.rs:799-830）
let refine_transcript = context_optional_bool(context, "refine_transcript");
let mut refined_text = None;
let mut refined_segments = None;
let mut refined_source = transcript_source;

if refine_transcript && matches!(transcript_source, TranscriptSource::Whisper) {
  // ... 整个 if 块
}
```

同时删除：
- `let transcript_source = context_optional_source(...)?;` 这行（不再被使用）
- 返回的 `json!` 中 `refined_transcript_text` / `refined_transcript_segments` / `refined_transcript_source` 三个字段
- `post_process` 中写回 `refined_*` 的逻辑（如果有）

保留 `CallLlmNode` 中 `generate_html_labels` 部分（独立功能）。

- [ ] **Step 4: 验证编译**

```bash
cd backend && cargo check 2>&1 | grep -E "warning|error" | head -20
```

Expected: 通过；可能出现 `transcript_source` 未使用 warning，Task 4 会重新用到。若报 unused variable，用 `let _transcript_source = ...` 或下划线前缀暂存。

- [ ] **Step 5: Commit**

```bash
git add backend/src/services.rs backend/src/summarize.rs
git commit -m "refactor(backend): remove refine_transcript code path

WhisperRefined / refine_transcript_with_llm / apply_refined_transcript 全部删除。
CallLlmNode 不再无条件对 Whisper 来源跑 refine，为 Task 4 的 mode 分发让路。"
```

---

### Task 4: Backend 按 mode 分发 timestamp 模式的合并逻辑

**Files:**
- Modify: `backend/src/summarize.rs`（`BuildPromptNode` + `CallLlmNode`）

**Interfaces:**
- Consumes: `merge_transcript_segments` (Task 1), `Context["mode"]` (Task 2)
- Produces: `BuildPromptNode` 按 mode 决定 `transcript` 格式；`CallLlmNode` 在 timestamp 模式后处理合并 segments 写回 Context

- [ ] **Step 1: `BuildPromptNode` 按 mode 分流 transcript 格式**

找到 `BuildPromptNode::execute`（约 `summarize.rs:741-780`）。当前会用 `format_transcript_with_timestamps` 把 segments 转成文本。改为：

```rust
let mode = context_optional_string(context, "mode").unwrap_or_else(|| "summary".to_string());
let transcript_text = if mode == "timestamp" {
  // 1:1 段级对齐：每行一段，无时间戳前缀
  segments
    .iter()
    .map(|s| s.text.as_str())
    .collect::<Vec<_>>()
    .join("\n")
} else {
  // 其他模式：保留时间戳前缀，方便 LLM 理解全局
  format_transcript_with_timestamps(&segments)
};
```

注意：保留原 `format_transcript_with_timestamps` 调用作为非 timestamp 模式的默认。

- [ ] **Step 2: `CallLlmNode` 在 timestamp 模式后处理合并**

在 `CallLlmNode::execute`（Task 3 简化后的版本）的 LLM 调用之后、`generate_html_labels` 之前，加入合并逻辑：

```rust
let mode = context_optional_string(context, "mode").unwrap_or_else(|| "summary".to_string());
let mut final_segments: Option<Vec<TranscriptSegment>> = None;

if mode == "timestamp" {
  // 1. 把 LLM 1:1 修正后的输出按行 split
  let corrected_lines: Vec<&str> = summary
    .lines()
    .map(|line| line.trim())
    .filter(|line| !line.is_empty())
    .collect();

  // 2. 用原始 segments 的时间戳 + 修正后的文本重建 segment list
  let original_segments = context_optional_segments(context, "transcript_segments")
    .ok_or_else(|| anyhow!("timestamp 模式需要 transcript_segments"))?;
  let corrected_segments: Vec<TranscriptSegment> = original_segments
    .iter()
    .enumerate()
    .map(|(i, seg)| TranscriptSegment {
      start: seg.start,
      end: seg.end,
      text: corrected_lines.get(i).map(|s| s.to_string()).unwrap_or_else(|| seg.text.clone())
    })
    .collect();

  // 3. 合并到 15s 颗粒
  let merged = merge_transcript_segments(corrected_segments, TIMESTAMP_MERGE_THRESHOLD_SECS);
  info!("⏱️ timestamp 模式合并完成: {} 段 → {} 段", original_segments.len(), merged.len());
  final_segments = Some(merged);
}

// summary 字段在 timestamp 模式下应该改写为带时间戳的格式
let summary_text = if mode == "timestamp" {
  final_segments.as_ref().map(|segs| {
    segs.iter()
      .map(|s| format!("[{:02}:{:02}-{:02}:{:02}] {}",
        (s.start as u64) / 60, (s.start as u64) % 60,
        (s.end as u64) / 60, (s.end as u64) % 60,
        s.text))
      .collect::<Vec<_>>()
      .join("\n\n")
  }).unwrap_or_else(|| summary.clone())
} else {
  summary
};
```

把 `summary` 在后续 json! 中替换为 `summary_text`，并把 `final_segments` 加入 json!：

```rust
Ok(json!({
  "summary": summary_text,
  "transcript_segments_merged": final_segments,
  "html_subtitle": html_subtitle,
  "html_stamp": html_stamp
}))
```

- [ ] **Step 3: `AssembleResponseNode` 优先使用 merged segments**

找到 `AssembleResponseNode`（约 `summarize.rs:935+`）。让 `transcript_segments` 优先取 Context 里的 `transcript_segments_merged`，没有则回退到原始 `transcript_segments`。

- [ ] **Step 4: 端到端验证 timestamp 模式**

启动后端，用 Python 发请求（参考已有的冒烟测试代码），指定 `"mode": "timestamp"`：

```python
import urllib.request, json
body = json.dumps({
  "url": "https://www.bilibili.com/video/BV16WEg6GEgZ",
  "cookie": "<你的完整 cookie 串>",
  "mode": "timestamp",
  "stt_language": "zh-cn",
  "base_url": "<你的 LLM base_url>",
  "model": "gpt-4o-mini",
  "api_key": "<你的 key>"
}).encode()
req = urllib.request.Request("http://127.0.0.1:8787/api/summarize", data=body, headers={"Content-Type":"application/json"})
print(urllib.request.urlopen(req, timeout=300).read().decode()[:500])
```

Expected：
- backend 日志出现 `⏱️ timestamp 模式合并完成: N 段 → M 段`（M ≈ N / 8 左右）
- 响应里 `transcript_segments` 长度变少，每段约 15s 长
- 文本含修正后的专有名词（如 "Karpathy"）

- [ ] **Step 5: Commit**

```bash
git add backend/src/summarize.rs
git commit -m "feat(backend): timestamp mode dispatch with 1:1 LLM fix + 15s merge

BuildPromptNode 按 mode 分流 transcript 格式。
CallLlmNode 在 timestamp 模式下做 1:1 LLM 修正 + merge_transcript_segments 合并。"
```

---

### Task 5: Frontend prompts 模块更新（类型 + 3 个新模板）

**Files:**
- Modify: `frontend/src/lib/prompts.ts`（整文件改写类型 + 模板）
- Modify: `frontend/src/lib/types.ts`（同步 PromptMode 派生）
- Modify: `frontend/src/lib/config.ts`（loadConfig 迁移）

**Interfaces:**
- Produces: `PromptMode = "summary" | "fulltext" | "timestamp" | "custom"`；`SUMMARY_PROMPT` / `FULLTEXT_PROMPT` / `TIMESTAMP_PROMPT` / `LEGACY_PROMPT`；`resolvePrompt(mode, customPrompt)`

- [ ] **Step 1: 改写 `prompts.ts`**

整体替换 `frontend/src/lib/prompts.ts` 内容为：

```ts
/**
 * 内置 prompt 模板。后端通过 `str::replace` 替换 `{{title}}` / `{{transcript}}`，
 * 请保持这两个 token 原样。
 *
 * 四模式：
 *   - "summary"   → SUMMARY_PROMPT     主题级抽象摘要
 *   - "fulltext"  → FULLTEXT_PROMPT    流畅文章改写
 *   - "timestamp" → TIMESTAMP_PROMPT   1:1 段级校对（后端再做 15s 合并）
 *   - "custom"    → 用户自由编辑（初始值 = LEGACY_PROMPT）
 *
 * 详细设计：docs/superpowers/specs/2026-06-27-three-modes-design.md
 */

export type PromptMode = "summary" | "fulltext" | "timestamp" | "custom"

export const SUMMARY_PROMPT = `你是视频内容摘要助手。请基于以下视频标题与字幕，输出一份结构化摘要。

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
- 不要编造字幕里不存在的内容`

export const FULLTEXT_PROMPT = `你是字幕改写助手。请把以下视频字幕改写成一篇流畅可读的文章。

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
7. 输出 Markdown`

export const TIMESTAMP_PROMPT = `你是字幕校对助手。请对以下字幕做 1:1 段级校对。

标题：{{title}}

字幕（每行一段，严格对齐）：
{{transcript}}

校对要求：
1. 每行输入对应一行输出，**不要合并、拆分、增删行**
2. 利用标题和上下文修正同音错字、专有名词（如 "家底谈" 修正为 "Karpathy"，"爆破大叔" 修正为 "Uncle Bob"）
3. 修正明显口误、错别字、标点
4. 保持原意，不改变语气
5. 全部转为简体中文

输出：每行一段，行数与输入严格一致。不要输出任何解释、行号或前缀。`

/** Pre-mode 旧默认模板，作为 custom 模式的初始值保留。 */
export const LEGACY_PROMPT = `你是一位擅长整理视频的助手。请根据以下内容生成结构化总结，并保留关键时间戳。

标题：{{title}}

字幕：
{{transcript}}

输出要求：
- 输出 Markdown
- 先给 1 句高密度摘要（40-60 字）
- 再给 3-5 条要点列表，每条附带时间戳（如 01:23）
- 单独输出"字幕摘录"小节，用项目符号逐条列出需要引用的字幕内容
- 字幕内容必须转换为简体中文（若原字幕为繁体或混杂语言，先转为简体再输出）
- 最后给 1 段 200-400 字的完整总结
- 全部使用简体中文
`

/** 解析指定模式对应的 prompt 文本。custom 模式空字符串回退到 SUMMARY_PROMPT。 */
export function resolvePrompt(
  mode: PromptMode,
  customPrompt: string
): string {
  switch (mode) {
    case "summary":
      return SUMMARY_PROMPT
    case "fulltext":
      return FULLTEXT_PROMPT
    case "timestamp":
      return TIMESTAMP_PROMPT
    case "custom":
      return customPrompt.trim() || SUMMARY_PROMPT
  }
}
```

- [ ] **Step 2: 更新 `types.ts` 的 `TranscriptSource` 和 `PROMPT_MODES`**

在 `frontend/src/lib/types.ts`：

找到 `export type TranscriptSource`，删掉 `"whisper_refined"` 这一行，变为：

```ts
export type TranscriptSource =
  | "subtitle"
  | "whisper"
  | null
```

找到 `const PROMPT_MODES`（约 types.ts:56），更新为：

```ts
const PROMPT_MODES: readonly PromptMode[] = ["summary", "fulltext", "timestamp", "custom"]
```

`isValidPromptMode` 和 `isUserConfig` 函数无需改动（它们用 `PROMPT_MODES` 数组）。

- [ ] **Step 3: 在 `config.ts` 加 `"transcript" → "timestamp"` 迁移**

找到 `loadConfig` 函数（约 `frontend/src/lib/config.ts`）。在 `isUserConfig(config)` 校验通过、返回前加：

```ts
// 旧配置 "transcript" → 新 "timestamp"
if (config.promptMode === "transcript" as PromptMode) {
  config = { ...config, promptMode: "timestamp" }
}
```

注意 `PromptMode` 类型从 `./prompts` 导入，确保 import 已存在。

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd frontend && pnpm build
```

Expected: tsc 通过，vite build 成功。若 `settings-panel.tsx` 因 PROMPT_MODE_OPTIONS 类型变化报错，先注释掉报错项（Task 7 会删整个 Section）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/prompts.ts frontend/src/lib/types.ts frontend/src/lib/config.ts
git commit -m "feat(frontend): three-mode prompt templates + config migration

SUMMARY_PROMPT 改为无时间戳抽象；新增 FULLTEXT_PROMPT；
TRANSCRIPT_PROMPT 替换为 TIMESTAMP_PROMPT（1:1 段级校对）。
loadConfig 自动迁移旧 transcript → timestamp。"
```

---

### Task 6: Frontend 新建 `CustomPromptDialog` 组件

**Files:**
- Create: `frontend/src/components/custom-prompt-dialog.tsx`

**Interfaces:**
- Props: `{ open: boolean; onOpenChange: (open: boolean) => void; value: string; onSave: (value: string) => void }`
- 行为：textarea 编辑 prompt 文本；保存按钮触发 `onSave(value)` 并关闭；取消按钮直接关闭

- [ ] **Step 1: 创建 `custom-prompt-dialog.tsx`**

```tsx
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

interface CustomPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onSave: (value: string) => void
}

export function CustomPromptDialog({
  open,
  onOpenChange,
  value,
  onSave
}: CustomPromptDialogProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const handleSave = () => {
    onSave(draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-8 sm:max-w-2xl md:p-10">
        <DialogHeader>
          <DialogTitle>自定义 Prompt 模板</DialogTitle>
          <DialogDescription>
            编辑自定义模板。支持 <code>{"{{title}}"}</code> 与 <code>{"{{transcript}}"}</code> 两个占位符，后端会原样替换。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-[60vh] font-mono text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存并使用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && pnpm build
```

Expected: 编译通过（新组件尚未被引用，但 tsc 不会因未引用文件报错）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/custom-prompt-dialog.tsx
git commit -m "feat(frontend): add CustomPromptDialog component"
```

---

### Task 7: Frontend UrlForm 加 segmented control + SettingsPanel 瘦身 + App 接线

**Files:**
- Modify: `frontend/src/components/url-form.tsx`（加 segmented control + 自定义按钮）
- Modify: `frontend/src/components/settings-panel.tsx`（删 prompt mode Section + 相关 import）
- Modify: `frontend/src/App.tsx`（custom dialog 状态、UrlForm props、render）
- Modify: `frontend/src/lib/api.ts`（payload 加 `mode` 字段）

**Interfaces:**
- UrlForm 新 props: `promptMode: PromptMode`, `onPromptModeChange: (mode: PromptMode) => void`, `onOpenCustomPrompt: () => void`

- [ ] **Step 1: 改写 `url-form.tsx`**

整体替换为：

```tsx
import { FileText, Loader2, Search, Settings2, Sparkles, SquarePen, Timestamp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PromptMode } from "@/lib/prompts"

interface UrlFormProps {
  url: string
  onUrlChange: (value: string) => void
  onSubmit: () => void
  onOpenSettings: () => void
  loading: boolean
  disabled: boolean
  promptMode: PromptMode
  onPromptModeChange: (mode: PromptMode) => void
  onOpenCustomPrompt: () => void
}

const MODE_OPTIONS: ReadonlyArray<{
  value: PromptMode
  label: string
  icon: typeof Sparkles
}> = [
  { value: "summary", label: "摘要", icon: Sparkles },
  { value: "fulltext", label: "全文", icon: FileText },
  { value: "timestamp", label: "时间戳", icon: Timestamp }
]

export function UrlForm({
  url,
  onUrlChange,
  onSubmit,
  onOpenSettings,
  loading,
  disabled,
  promptMode,
  onPromptModeChange,
  onOpenCustomPrompt
}: UrlFormProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-md pl-11 text-base"
            placeholder="粘贴 Bilibili / YouTube 视频 URL"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            disabled={loading}
            aria-label="视频链接"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 px-6" disabled={disabled || loading}>
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              生成中…
            </>
          ) : (
            "生成"
          )}
        </Button>
        <Button type="button" variant="secondary" size="lg" className="h-12" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          设置
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-hairline p-0.5">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = promptMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onPromptModeChange(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "text-ink hover:bg-surface-card"
                }`}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            )
          })}
        </div>
        <Button
          type="button"
          variant={promptMode === "custom" ? "default" : "ghost"}
          size="sm"
          onClick={onOpenCustomPrompt}
        >
          <SquarePen className="size-3.5" />
          自定义模板
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 删除 `settings-panel.tsx` 的 prompt mode Section**

在 `frontend/src/components/settings-panel.tsx`：
- 删除 `SUMMARY_PROMPT`、`TRANSCRIPT_PROMPT`、`PromptMode` 的 import（保留其他 lucide-react 图标）
- 删除 `AlignLeft`、`Sparkles`、`SquarePen` 等只被 prompt mode Section 使用的图标 import
- 删除整个 `PROMPT_MODE_OPTIONS` 常量数组
- 删除 JSX 中渲染 prompt mode radio cards + textarea 的整个 Section 块（找到 `<Section title="提示词模板"` 或类似标签）

- [ ] **Step 3: 改 `App.tsx` 加 custom dialog 状态和 wiring**

在 `frontend/src/App.tsx`：

加 import：
```tsx
import { CustomPromptDialog } from "@/components/custom-prompt-dialog"
```

加 state（与其他 useState 并列）：
```tsx
const [customPromptOpen, setCustomPromptOpen] = useState(false)
```

改 `<UrlForm>` 调用，加三个新 prop：
```tsx
<UrlForm
  url={url}
  onUrlChange={setUrl}
  onSubmit={handleSubmit}
  onOpenSettings={() => setSettingsOpen(true)}
  loading={loading}
  disabled={!url.trim() || !config.apiKey.trim()}
  promptMode={config.promptMode}
  onPromptModeChange={(mode) => patchConfig({ promptMode: mode })}
  onOpenCustomPrompt={() => setCustomPromptOpen(true)}
/>
```

在 JSX 末尾（与 `<SettingsPanel>` 并列）加：
```tsx
<CustomPromptDialog
  open={customPromptOpen}
  onOpenChange={setCustomPromptOpen}
  value={config.prompt}
  onSave={(value) => patchConfig({ prompt: value, promptMode: "custom" })}
/>
```

- [ ] **Step 4: `api.ts` payload 加 `mode` 字段**

在 `frontend/src/lib/api.ts`，找到 `postSummarize` 函数。payload 里加：

```ts
mode: payload.promptMode
```

（假设 `SummarizePayload` 已有 `promptMode`；如果没有，加到类型定义里）

- [ ] **Step 5: 验证 TypeScript 编译 + 启动**

```bash
cd frontend && pnpm build
```

Expected: tsc + vite build 通过。

启动 `make dev`，浏览器访问，确认：
- 主页 URL 表单下方出现 3 按钮的 segmented control（摘要/全文/时间戳）
- 旁边有"自定义模板"按钮
- 点"自定义模板"弹出 dialog，编辑后保存，segmented control 切换到 custom（无视觉高亮，但内部状态变了）
- 设置面板不再有 prompt mode radio cards

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/url-form.tsx frontend/src/components/settings-panel.tsx frontend/src/App.tsx frontend/src/lib/api.ts
git commit -m "feat(frontend): mode segmented control on main page + custom dialog

移除 SettingsPanel 中的 prompt mode Section。
UrlForm 加 3 选 1 segmented control + 自定义模板按钮。
App.tsx 接 CustomPromptDialog 状态。
api.ts payload 加 mode 字段。"
```

---

### Task 8: 端到端验证 + 清理

**Files:** 无新文件，仅手动验证

- [ ] **Step 1: 后端单元测试通过**

```bash
cd backend && cargo test
```

Expected: Task 1 的 5 个 `merge_*` 测试全 PASS。

- [ ] **Step 2: 类型检查通过**

```bash
make check
```

Expected: cargo check + tsc --noEmit 都通过。

- [ ] **Step 3: 前端构建通过**

```bash
cd frontend && pnpm build
```

Expected: tsc + vite build 成功，无 warning 除项目原有的几个。

- [ ] **Step 4: 手动跑 4 种模式（同一视频）**

启动 `make dev`，对 `BV16WEg6GEgZ` 跑 4 次：

|模式|期望|
|---|---|
|summary|输出含 `## 核心论点` / `## 关键要点` / `## 启示` 三节，无时间戳，无逐句重述|
|fulltext|输出含 3-6 个 `###` 小标题的流畅文章，无时间戳|
|timestamp|`transcript_segments` 段数 ≈ 视频时长 / 15，文本含修正后的专有名词（如 "Karpathy"），无 1-2s 碎片|
|custom|按用户编辑的 LEGACY_PROMPT 输出|

任一模式失败：检查 backend 日志、frontend network tab、对应 prompt。

- [ ] **Step 5: 删除 Task 3 留下的临时下划线前缀**

Task 3 Step 3 如果有 `let _transcript_source = ...` 暂存，Task 4 应该已经消费了它。最后用 LSP 查找 `_transcript_source` 是否还有残留，若有则改名或删除。

```bash
cd backend && cargo check 2>&1 | grep "_transcript_source"
```

Expected: 无输出（说明无残留）。

- [ ] **Step 6: 文档同步**

在 `docs/harness/records/` 加一条变更记录（文件名 `YYYYMMDD-HHMMSS-三模式分流.md`），简要记录：
- 新增四模式（summary/fulltext/timestamp/custom）
- 新增 `merge_transcript_segments` 函数 + 单元测试
- 删除 `refine_transcript_with_llm` / `apply_refined_transcript` / `TranscriptSource::WhisperRefined`
- 前端模式选择器从 SettingsPanel 移到 UrlForm

- [ ] **Step 7: Final commit**

```bash
git add docs/harness/records/
git commit -m "docs: add record for three-modes refactor"
```

---

## Self-Review

**Spec coverage:**
- §3 模式定义 → Task 5 (frontend types) + Task 7 (UI) + Task 4 (backend dispatch) ✓
- §4.1 后端只在 timestamp 感知 mode → Task 4 ✓
- §4.2 删除 refine_transcript → Task 3 ✓
- §4.3 timestamp 两步流程 → Task 1 (merge fn) + Task 4 (wiring) ✓
- §5.1-5.3 三个 prompt 模板 → Task 5 ✓
- §5.4 custom → Task 6 (dialog) + Task 7 (wiring) ✓
- §6.1 主页 segmented control → Task 7 ✓
- §6.2 custom 独立弹窗 → Task 6 + Task 7 ✓
- §6.3 设置面板瘦身 → Task 7 ✓
- §6.4 类型变更 → Task 5 ✓
- §7.1 API 契约 mode 字段 → Task 2 + Task 7 (api.ts) ✓
- §7.2 工作流分发 → Task 4 ✓
- §7.3 merge_transcript_segments → Task 1 ✓
- §7.4 删除清单 → Task 3 ✓
- §8.1 IndexedDB 迁移 → Task 5 ✓
- §8.2 后端 mode 默认值 → Task 2 ✓
- §8.3 输出产物兼容 → Task 3 (remove WhisperRefined) + Task 4 (timestamp merged segments) ✓
- §9 验证计划 → Task 8 ✓

**Placeholder scan:** 无 TBD / TODO / "implement later" / "add appropriate X"。所有代码块都给出完整代码或明确指令。

**Type consistency:**
- `PromptMode` 全程：`"summary" | "fulltext" | "timestamp" | "custom"` ✓
- `merge_transcript_segments(segments: Vec<TranscriptSegment>, target_duration_secs: f64) -> Vec<TranscriptSegment>` 在 Task 1 定义、Task 4 消费 ✓
- `Context["mode"]` 在 Task 2 写入、Task 4 读取 ✓
- `TIMESTAMP_MERGE_THRESHOLD_SECS` 在 Task 1 定义、Task 4 引用 ✓

无问题。

---

## 执行选项

Plan 完成并保存至 `docs/superpowers/plans/2026-06-27-three-modes.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 派独立 subagent，两阶段 review，迭代快
2. **Inline Execution** — 当前会话批量执行，带 checkpoint

哪种？
