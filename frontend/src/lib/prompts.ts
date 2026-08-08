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

/** timestamp 分块校对参数：每块行数与每批并行块数（批间串行，控制瞬时并发）。 */
export const TIMESTAMP_CHUNK_SIZE = 10
export const TIMESTAMP_BATCH_CONCURRENCY = 3

/**
 * timestamp 分块校对 prompt：只含本块编号行，避免长字幕一次送入（超时/超 context）。
 * 带行号（`1. 文本`），LLM 不易漏行，解析时按编号回填。
 */
export function buildTimestampChunkPrompt(title: string, numberedLines: string): string {
  return `你是字幕校对助手。请对以下字幕片段做 1:1 逐行校对（这是完整字幕的一部分）。

标题：${title}

字幕（每行已编号，保持对齐）：
${numberedLines}

校对要求：
1. 每行输入对应一行输出，不要合并、拆分、增删行
2. 利用标题修正同音错字、专有名词；修正口误、错别字、标点
3. 保持原意，不改变语气
4. 全部转为简体中文

输出：每行保持原编号（如 \`1. 修正后文本\`），行数与输入严格一致。不要解释、标题或额外内容。`
}

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
