import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { ExternalRunResult, HttpFetch, HttpResponse, SummarizeDeps } from "../types"
import { generateMode, prepareTranscript } from "./index"
import type { PromptMode } from "@/lib/prompts"

function jsonResponse(payload: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
    json: async <T>() => payload as T
  }
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf-8"))
}

const MAIN_SUMMARY = "# 摘要标题\n\n## 核心论点\n\n一句话高密度摘要。\n\n- 要点一\n- 要点二"

const LABELS_JSON = JSON.stringify({
  subtitle_cn: "中文副标题",
  subtitle_en: "English Sub",
  stamp_cn: "印章",
  stamp_en: "Seal"
})

interface FakeEnv {
  deps: SummarizeDeps
  httpCalls: string[]
  runnerCalls: Array<{ program: string; args: string[] }>
  writes: Array<{ path: string; content: string }>
  stages: string[]
  hasSubtitle?: boolean
  /** 按调用序号覆盖 /chat/completions 返回内容（用于多块分批测试） */
  chatReplies?: string[]
}

function makeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  const env: FakeEnv = {
    httpCalls: [],
    runnerCalls: [],
    writes: [],
    stages: [],
    ...overrides
  }

  // 模拟文件系统：wav 首次检查为 false，下载后存在为 true。
  const wavSeen = new Set<string>()

  let llmCall = 0
  const http: HttpFetch = async (url) => {
    env.httpCalls.push(url)
    if (url.includes("/x/web-interface/view")) return jsonResponse(fixture("bilibili-view.json"))
    if (url.includes("/x/player/v2")) {
      return env.hasSubtitle === false
        ? jsonResponse({ code: 0, data: { subtitle: { subtitles: [], ai_subtitle: null } } })
        : jsonResponse(fixture("bilibili-subtitle-index.json"))
    }
    if (url.includes("hdslb.com")) return jsonResponse(fixture("bilibili-subtitle-body.json"))
    if (url.includes("/chat/completions")) {
      llmCall++
      const reply = overrides.chatReplies?.[llmCall - 1]
      if (reply !== undefined) return jsonResponse({ choices: [{ message: { content: reply } }] })
      if (llmCall === 1) return jsonResponse({ choices: [{ message: { content: MAIN_SUMMARY } }] })
      return jsonResponse({ choices: [{ message: { content: LABELS_JSON } }] })
    }
    throw new Error(`unexpected url: ${url}`)
  }

  const runner = async (
    program: string,
    args: string[],
    _options?: { cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void }
  ): Promise<ExternalRunResult> => {
    env.runnerCalls.push({ program, args })
    if (program === "whisper-cli") {
      await env.deps.writeFile(`${args[args.length - 1]}.json`, JSON.stringify({
        segments: [
          { start: 0.0, end: 3.2, text: "转写一" },
          { start: 3.2, end: 6.5, text: "转写二" }
        ]
      }))
    }
    return { exitCode: 0, stdout: "", stderr: "" }
  }

  env.deps = {
    http,
    runner,
    onProgress: (stage) => env.stages.push(stage),
    resolveModelPath: async () => "/models/base.bin",
    resolveOutputDir: async (runId) => `/tmp/out/${runId}`,
    ensureDir: async () => {},
    writeFile: async (path, content) => env.writes.push({ path, content }),
    readFile: async (path) => env.writes.find((w) => w.path === path)?.content ?? "{}",
    isFile: async (path) => {
      if (path.endsWith(".wav")) {
        if (wavSeen.has(path)) return true
        wavSeen.add(path)
        return false
      }
      return path.endsWith(".mp4")
    },
    now: () => new Date(2026, 7, 8, 12, 34, 56)
  }
  return env
}

const BVID_URL = "https://www.bilibili.com/video/BV1xx411c7mD"

function prepareInput(overrides: Record<string, unknown> = {}) {
  return {
    url: BVID_URL,
    cookie: null,
    stt_language: "zh-cn" as const,
    run_id: "run-test-001",
    ...overrides
  }
}

function generateInput(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run-test-001",
    url: BVID_URL,
    cookie: null,
    title: "【示例】B站视频标题：TypeScript 与 Tauri 入门",
    transcript: {
      text: "[00:00-00:03] 大家好\n[00:03-00:06] 今天聊聊",
      segments: [
        { start: 0, end: 3, text: "大家好" },
        { start: 3, end: 6, text: "今天聊聊" }
      ],
      source: "subtitle" as const
    },
    mode: "summary" as PromptMode,
    custom_prompt: null,
    api_key: "sk-test",
    model: null,
    base_url: null,
    screenshot: false,
    ...overrides
  }
}

describe("prepareTranscript（字幕准备）", () => {
  it("B 站字幕路径：返回 title/transcript 并落盘 txt + json", async () => {
    const env = makeEnv()
    const prepared = await prepareTranscript(prepareInput(), env.deps)

    expect(prepared.title).toBe("【示例】B站视频标题：TypeScript 与 Tauri 入门")
    expect(prepared.transcript.source).toBe("subtitle")
    expect(env.stages[0]).toBe("detect")
    expect(env.stages).toContain("fetch_subtitle")
    expect(env.stages).not.toContain("whisper")
    expect(env.stages).not.toContain("llm")

    const txt = env.writes.find((w) => w.path.endsWith(".txt"))
    const json = env.writes.find((w) => w.path.endsWith(".json"))
    expect(txt).toBeDefined()
    expect(json).toBeDefined()
    expect(JSON.parse(json!.content).segments).toHaveLength(2)
  })

  it("whisper 路径：无字幕时触发 yt-dlp + whisper-cli", async () => {
    const env = makeEnv({ hasSubtitle: false })
    const prepared = await prepareTranscript(prepareInput(), env.deps)

    expect(env.stages).toContain("whisper")
    expect(env.runnerCalls.some((c) => c.program === "yt-dlp")).toBe(true)
    expect(env.runnerCalls.some((c) => c.program === "whisper-cli")).toBe(true)
    expect(prepared.transcript.source).toBe("whisper")
  })

  it("source=audio：有字幕也强制 whisper 转写", async () => {
    const env = makeEnv({ hasSubtitle: true })
    const prepared = await prepareTranscript(prepareInput({ source: "audio" }), env.deps)

    // 跳过字幕抓取阶段，直接转写
    expect(env.stages).not.toContain("fetch_subtitle")
    expect(env.stages).toContain("whisper")
    expect(env.runnerCalls.some((c) => c.program === "yt-dlp")).toBe(true)
    expect(prepared.transcript.source).toBe("whisper")
  })

  it("不支持的平台抛错", async () => {
    const env = makeEnv()
    await expect(prepareTranscript(prepareInput({ url: "https://vimeo.com/1" }), env.deps)).rejects.toThrow(
      "暂不支持该链接"
    )
  })

  it("无效 B 站链接抛错", async () => {
    const env = makeEnv()
    await expect(
      prepareTranscript(prepareInput({ url: "https://www.bilibili.com/video/av123" }), env.deps)
    ).rejects.toThrow("无效的 B 站链接")
  })
})

describe("generateMode（按模式懒生成）", () => {
  it("summary 模式：生成完整输出并落盘 {mode}.md", async () => {
    const env = makeEnv()
    const output = await generateMode(generateInput(), env.deps)

    expect(output.summary).toBe(MAIN_SUMMARY)
    expect(output.transcript_source).toBe("subtitle")
    expect(output.markdown).toContain("# 【示例】B站视频标题：TypeScript 与 Tauri 入门")
    expect(output.markdown).not.toContain("## 摘要")
    expect(output.markdown).toContain("## 视频信息")
    expect(output.markdown).toContain("- 生成时间: 2026-08-08 12:34:56")

    expect(env.writes.some((w) => w.path.endsWith("/summary.md"))).toBe(true)
    expect(env.stages).toContain("llm")
    expect(env.stages).toContain("render")
    expect(env.stages[env.stages.length - 1]).toBe("done")
  })

  it("timestamp 模式：1:1 修正 + 15s 合并 + 时间戳摘要", async () => {
    const env = makeEnv()
    const output = await generateMode(generateInput({ mode: "timestamp" }), env.deps)
    expect(output.summary).toMatch(/^\[00:0\d-00:0\d\] /)
    expect(output.transcript_segments).toBeDefined()
  })

  it("timestamp 模式：35 行分 4 块（10 行/块 × 3 并发，两批）并行校对并回填修正", async () => {
    const lineCount = 35
    const segments = Array.from({ length: lineCount }, (_, i) => ({
      start: i * 3,
      end: i * 3 + 3,
      text: `原句${i + 1}`
    }))
    // 4 块：批 1 三块并行 + 批 2 一块
    const replies = Array.from({ length: Math.ceil(lineCount / 10) }, (_, block) => {
      const start = block * 10
      return Array.from({ length: Math.min(10, lineCount - start) }, (_, j) => `${start + j + 1}. 修正${start + j + 1}`).join("\n")
    })
    const env = makeEnv({ chatReplies: replies })
    const output = await generateMode(
      generateInput({ mode: "timestamp", transcript: { text: "", segments, source: "subtitle" } }),
      env.deps
    )
    // 每块恰好一次 LLM 调用（共 4 块）
    expect(env.httpCalls.filter((u) => u.includes("/chat/completions"))).toHaveLength(4)
    // 修正按行号回填：首行与末行都来自 LLM，而非原字幕
    expect(output.summary).toContain("修正1")
    expect(output.summary).toContain(`修正${lineCount}`)
    expect(output.summary).not.toContain("原句1")
    // 合并后按 15s 阈值合块：每段 3s → 每 4 段一块（第 5 段 end-start=15 恰好不合并）→ 35 段 = 9 块
    expect(output.transcript_segments).toHaveLength(9)
  })
})
