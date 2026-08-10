import { describe, expect, it } from "vitest"
import type { ExternalRunResult, SummarizeDeps } from "../types"
import { AppError } from "../errors"
import { downloadAudioWithYtdlp, downloadVideoWithYtdlp } from "./download"

function makeDeps(overrides: Partial<SummarizeDeps> = {}): {
  deps: Pick<SummarizeDeps, "runner" | "isFile" | "writeFile" | "onProgress">
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
    isFile: async () => true,
    writeFile: async () => {},
    onProgress: () => {},
    ...overrides
  }
  return { deps, calls }
}

describe("downloadAudioWithYtdlp", () => {
  it("构造 yt-dlp 音频参数（16k 单声道 wav）", async () => {
    const { deps, calls } = makeDeps()
    const path = await downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/r")
    expect(path).toBe("/tmp/r/BV1xx411c7mD.wav")
    expect(calls[0].program).toBe("yt-dlp")
    expect(calls[0].args).toContain("-x")
    expect(calls[0].args).toContain("wav")
    expect(calls[0].args).toContain("-ar 16000 -ac 1")
    expect(calls[0].args[calls[0].args.length - 1]).toBe("https://www.bilibili.com/video/BV1xx411c7mD")
  })

  it("缓存命中：cacheDir 已有同名 wav 时跳过下载", async () => {
    const { deps, calls } = makeDeps({
      isFile: async (path) => path === "/tmp/cache/BV1xx411c7mD.wav"
    })
    const path = await downloadAudioWithYtdlp(
      deps,
      "https://www.bilibili.com/video/BV1xx411c7mD",
      null,
      "/tmp/r",
      "/tmp/cache"
    )
    expect(path).toBe("/tmp/cache/BV1xx411c7mD.wav")
    expect(calls).toHaveLength(0) // 未调用 yt-dlp
  })

  it("cookie 串写入 cookies.txt 并传 --cookies", async () => {
    const writes: Array<[string, string]> = []
    const { deps, calls } = makeDeps({
      isFile: async (path) => path.endsWith(".wav"),
      writeFile: async (path, content) => writes.push([path, content])
    })
    await downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", "SESSDATA=abc", "/tmp/r")
    expect(writes[0][0]).toBe("/tmp/r/cookies.txt")
    expect(writes[0][1]).toContain("SESSDATA")
    const idx = calls[0].args.indexOf("--cookies")
    expect(calls[0].args[idx + 1]).toBe("/tmp/r/cookies.txt")
  })

  it("已存在文件路径直接使用", async () => {
    const { deps, calls } = makeDeps({ isFile: async () => true })
    await downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", "/tmp/cookies.txt", "/tmp/r")
    const idx = calls[0].args.indexOf("--cookies")
    expect(calls[0].args[idx + 1]).toBe("/tmp/cookies.txt")
  })

  it("非文件且无等号抛错", async () => {
    const { deps } = makeDeps({ isFile: async (path) => path.endsWith(".wav") })
    await expect(
      downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", "not-a-cookie", "/tmp/r")
    ).rejects.toThrow("不是有效的 cookie 字符串")
  })

  it("yt-dlp 退出码非零时抛 AppError，携带 stdout/stderr 尾部", async () => {
    const { deps } = makeDeps({
      runner: async () => ({
        exitCode: 1,
        stdout: Array.from({ length: 300 }, (_, i) => `out-${i}`).join("\n"),
        stderr: "ERROR: something failed"
      })
    })
    try {
      await downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/r")
      throw new Error("expected AppError to be thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appError = err as AppError
      expect(appError.code).toBe("WHISPER.YTDLP_DOWNLOAD_FAILED")
      expect(appError.context?.exitCode).toBe(1)
      expect(appError.context?.stdoutTail).toBeDefined()
      expect((appError.context?.stdoutTail as string).split("\n")).toHaveLength(200)
      expect(appError.context?.stderrTail).toBe("ERROR: something failed")
    }
  })

  it("wav 文件未找到时抛 AppError", async () => {
    const { deps } = makeDeps({ isFile: async () => false })
    try {
      await downloadAudioWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/r")
      throw new Error("expected AppError to be thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe("WHISPER.WAV_NOT_FOUND")
    }
  })
})

describe("downloadVideoWithYtdlp", () => {
  it("构造视频下载参数并定位 mp4", async () => {
    const { deps, calls } = makeDeps()
    const path = await downloadVideoWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/v")
    expect(path).toBe("/tmp/v/BV1xx411c7mD.mp4")
    expect(calls[0].args).toContain("-f")
    expect(calls[0].args).toContain("bestvideo+bestaudio/best")
  })

  it("yt-dlp 退出码非零时抛 AppError，携带 stdout/stderr 尾部", async () => {
    const { deps } = makeDeps({
      runner: async () => ({ exitCode: 1, stdout: "progress line", stderr: "ffmpeg postprocessor error" })
    })
    try {
      await downloadVideoWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/v")
      throw new Error("expected AppError to be thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appError = err as AppError
      expect(appError.code).toBe("WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED")
      expect(appError.context?.stdoutTail).toBe("progress line")
      expect(appError.context?.stderrTail).toBe("ffmpeg postprocessor error")
    }
  })

  it("mp4 文件未找到时抛 AppError", async () => {
    const { deps } = makeDeps({ isFile: async () => false })
    try {
      await downloadVideoWithYtdlp(deps, "https://www.bilibili.com/video/BV1xx411c7mD", null, "/tmp/v")
      throw new Error("expected AppError to be thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe("WHISPER.MP4_NOT_FOUND")
    }
  })
})
