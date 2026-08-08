import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { ExternalRunResult, HttpFetch, HttpResponse, SummarizeDeps } from "../types"
import { runSummarize } from "./index"
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
}

function makeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  const env: FakeEnv = {
    httpCalls: [],
    runnerCalls: [],
    writes: [],
    stages: [],
    ...overrides
  }

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
    writeFile: async (path, content) => env.writes.push({ path, content }),
    readFile: async (path) => env.writes.find((w) => w.path === path)?.content ?? "{}",
    isFile: async (path) => path.endsWith(".wav") || path.endsWith(".mp4"),
    now: () => new Date(2026, 7, 8, 12, 34, 56)
  }
  return env
}

function baseInput(overrides: Partial<Parameters<typeof runSummarize>[0]> = {}) {
  return {
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    api_key: "sk-test",
    model: null,
    base_url: null,
    prompt: null,
    cookie: null,
    stt_language: "zh-cn" as const,
    screenshot: false,
    mode: "summary" as PromptMode,
    ...overrides
  }
}

describe("runSummarize 字幕路径（B 站）", () => {
  it("生成完整输出并落盘产物", async () => {
    const env = makeEnv()
    const output = await runSummarize(baseInput(), env.deps)

    expect(output.title).toBe("【示例】B站视频标题：TypeScript 与 Tauri 入门")
    expect(output.summary).toBe(MAIN_SUMMARY)
    expect(output.transcript_source).toBe("subtitle")
    expect(output.markdown).toContain("# 【示例】B站视频标题：TypeScript 与 Tauri 入门")
    expect(output.markdown).toContain("## 摘要")
    expect(output.markdown).toContain("## 视频信息")
    expect(output.markdown).toContain("- 生成时间: 2026-08-08 12:34:56")
    expect(output.html).toContain("<!doctype html>")
    expect(output.html).toContain("中文副标题 / English Sub")
    expect(output.html).toContain("印章 / Seal")

    // 产物文件
    const md = env.writes.find((w) => w.path.endsWith(".md"))
    const html = env.writes.find((w) => w.path.endsWith(".html"))
    const txt = env.writes.find((w) => w.path.endsWith(".txt"))
    expect(md).toBeDefined()
    expect(html).toBeDefined()
    expect(txt).toBeDefined()

    // 阶段顺序
    expect(env.stages[0]).toBe("detect")
    expect(env.stages).toContain("fetch_subtitle")
    expect(env.stages).toContain("llm")
    expect(env.stages).toContain("render")
    expect(env.stages[env.stages.length - 1]).toBe("done")
    expect(env.stages).not.toContain("whisper")
  })

  it("timestamp 模式：1:1 修正 + 15s 合并 + 时间戳摘要", async () => {
    const env = makeEnv()
    const env2 = makeEnv()
    const output = await runSummarize(
      baseInput({ mode: "timestamp" }),
      env.deps
    )
    expect(output.transcript_segments).toBeDefined()
    // 摘要格式为 [mm:ss-mm:ss] 块
    expect(output.summary).toMatch(/^\[00:0\d-00:0\d\] /)
    void env2
  })

  it("html labels 调用失败时降级默认文案", async () => {
    const env = makeEnv()
    const originalHttp = env.deps.http
    let llmCall = 0
    env.deps.http = async (url, init) => {
      const resp = await originalHttp(url, init)
      if (url.includes("/chat/completions")) {
        llmCall++
        if (llmCall === 2) throw new Error("labels failed")
      }
      return resp
    }
    const output = await runSummarize(baseInput(), env.deps)
    expect(output.html).toContain("东方简约信纸 · Video Summary")
  })
})

describe("runSummarize whisper 路径", () => {
  it("无字幕时触发 yt-dlp + whisper-cli", async () => {
    const env = makeEnv({ hasSubtitle: false })
    const output = await runSummarize(baseInput(), env.deps)

    expect(env.stages).toContain("whisper")
    const ytDlp = env.runnerCalls.find((c) => c.program === "yt-dlp")
    const whisperCli = env.runnerCalls.find((c) => c.program === "whisper-cli")
    expect(ytDlp).toBeDefined()
    expect(whisperCli).toBeDefined()
    expect(output.transcript_source).toBe("whisper")
    expect(output.transcript).toContain("转写一")
  })
})

describe("runSummarize 平台与错误", () => {
  it("不支持的平台抛错", async () => {
    const env = makeEnv()
    await expect(runSummarize(baseInput({ url: "https://vimeo.com/1" }), env.deps)).rejects.toThrow(
      "暂不支持该链接"
    )
  })

  it("无效 B 站链接抛错", async () => {
    const env = makeEnv()
    await expect(
      runSummarize(baseInput({ url: "https://www.bilibili.com/video/av123" }), env.deps)
    ).rejects.toThrow("无效的 B 站链接")
  })
})
