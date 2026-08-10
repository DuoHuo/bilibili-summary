import { describe, expect, it } from "vitest"
import type { ExternalRunResult, SummarizeDeps } from "../types"
import { AppError } from "../errors"
import { mapSttLanguage, transcribeWithWhisper, transcribeWithWhisperCli } from "./index"

function makeDeps(overrides: Partial<SummarizeDeps> = {}): {
  deps: Pick<SummarizeDeps, "runner" | "readFile" | "onProgress">
  calls: Array<{ program: string; args: string[] }>
} {
  const calls: Array<{ program: string; args: string[] }> = []
  const runner = async (
    program: string,
    args: string[],
    _options?: { cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void }
  ): Promise<ExternalRunResult> => {
    calls.push({ program, args })
    return { exitCode: 0, stdout: "", stderr: "" }
  }
  const deps = {
    runner,
    readFile: async () =>
      JSON.stringify({
        segments: [
          { start: 0.0, end: 3.2, text: "大家好" },
          { start: 3.2, end: 6.5, text: " " }
        ]
      }),
    onProgress: () => {},
    ...overrides
  }
  return { deps, calls }
}

describe("mapSttLanguage", () => {
  it("zh-cn → zh，en → en", () => {
    expect(mapSttLanguage("zh-cn")).toBe("zh")
    expect(mapSttLanguage("en")).toBe("en")
  })
})

describe("transcribeWithWhisperCli", () => {
  it("构造 whisper-cli 参数并解析 JSON segments（过滤空文本）", async () => {
    const { deps, calls } = makeDeps()
    const segments = await transcribeWithWhisperCli(deps, "/tmp/r/audio.wav", "zh", "/models/base.bin")
    expect(segments).toEqual([{ start: 0.0, end: 3.2, text: "大家好" }])
    expect(calls[0].program).toBe("whisper-cli")
    expect(calls[0].args).toEqual(["-m", "/models/base.bin", "-f", "/tmp/r/audio.wav", "-l", "zh", "-oj", "-of", "/tmp/r/audio"])
  })

  it("转写失败抛错（AppError, WHISPER.TRANSCRIBE_FAILED）", async () => {
    const { deps } = makeDeps()
    const runner = async () => ({ exitCode: 1, stdout: "", stderr: "err" }) as ExternalRunResult
    try {
      await transcribeWithWhisperCli({ ...deps, runner }, "/tmp/r/a.wav", "zh", "/m.bin")
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe("WHISPER.TRANSCRIBE_FAILED")
    }
  })

  it("JSON 解析失败抛错（AppError, WHISPER.PARSE_RESULT_FAILED）", async () => {
    const { deps } = makeDeps({ readFile: async () => "not json" })
    try {
      await transcribeWithWhisperCli(deps, "/tmp/r/a.wav", "zh", "/m.bin")
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe("WHISPER.PARSE_RESULT_FAILED")
    }
  })
})

describe("transcribeWithWhisper", () => {
  it("segments 为空时抛错（AppError, WHISPER.EMPTY_RESULT）", async () => {
    const runner = async (): Promise<ExternalRunResult> => ({ exitCode: 0, stdout: "", stderr: "" })
    const deps: Pick<
      SummarizeDeps,
      "runner" | "readFile" | "isFile" | "writeFile" | "resolveModelPath" | "onProgress"
    > = {
      runner,
      readFile: async () => JSON.stringify({ segments: [{ start: 0, end: 1, text: "   " }] }),
      isFile: async () => true,
      writeFile: async () => {},
      resolveModelPath: async () => "/models/base.bin",
      onProgress: () => {}
    }
    try {
      await transcribeWithWhisper(deps, "https://b23.tv/x", null, "zh-cn", "/tmp/r")
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe("WHISPER.EMPTY_RESULT")
    }
  })
})
