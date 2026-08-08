import { resolvePrompt } from "@/lib/prompts"

/** 移植自 backend/src/services.rs::build_prompt 中追加的截图占位提示 */
const SCREENSHOT_SUFFIX =
  "\n\n8. **Screenshot placeholders**: If a section involves visual demonstrations, code walkthroughs, UI interactions, or any content where visuals aid understanding, insert a screenshot cue at the end of that section:\n- Format: `*Screenshot-[mm:ss]`\n- Only use it when truly helpful.\n"

/**
 * 构建 LLM 提示词：优先自定义 prompt（custom 模式），否则走四模式内置模板。
 * 移植自 backend/src/services.rs::build_prompt + 前端 lib/prompts.ts 的模板体系。
 */
export function buildPrompt(input: {
  title: string
  transcript: string
  customPrompt: string | null
  mode: "summary" | "fulltext" | "timestamp" | "custom"
  screenshot: boolean
}): string {
  const custom = input.customPrompt
  if (custom) {
    let prompt = custom.replaceAll("{{title}}", input.title).replaceAll("{{transcript}}", input.transcript)
    if (input.screenshot) prompt += SCREENSHOT_SUFFIX
    return prompt
  }

  let prompt = resolvePrompt(input.mode, "")
    .replaceAll("{{title}}", input.title)
    .replaceAll("{{transcript}}", input.transcript)
  if (input.screenshot) prompt += SCREENSHOT_SUFFIX
  return prompt
}
