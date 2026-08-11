import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LogEvent } from "@/core/log"

// mock tauri 桥接层：拦截 appendTextFile / resolveLogDir
const appendMock = vi.fn<(path: string, contents: string, max: number, files: number) => Promise<void>>()
const resolveMock = vi.fn<() => Promise<string>>()
vi.mock("./tauri", () => ({
  resolveLogDir: () => resolveMock(),
  appendTextFile: (path: string, contents: string, max: number, files: number) =>
    appendMock(path, contents, max, files)
}))

import { createFileLogger, flushLogs, getBufferedLogs, loggerRef, subscribeLogs, _resetLogState } from "./logger"

function makeEvent(level: LogEvent["level"], event: string): void {
  loggerRef.log(level, event, { trace_id: "t1" })
}

describe("logger（文件 sink）", () => {
  beforeEach(() => {
    appendMock.mockReset()
    appendMock.mockResolvedValue(undefined)
    resolveMock.mockReset()
    resolveMock.mockResolvedValue("/tmp/fake-logs")
    _resetLogState()
  })

  afterEach(async () => {
    await flushLogs()
  })

  it("WARN/ERROR 立即 appendTextFile 刷盘", async () => {
    await createFileLogger()
    makeEvent("ERROR", "llm.call_failed")
    // ERROR 路径同步触发 fileSinkAsync（fire-and-forget）；等一个微任务让 promise 跑完
    await vi.waitFor(() => expect(appendMock).toHaveBeenCalled())
    const [, contents] = appendMock.mock.calls[0]
    const evt = JSON.parse(contents.trim())
    expect(evt.level).toBe("ERROR")
    expect(evt.event).toBe("llm.call_failed")
    expect(evt.trace_id).toBe("t1")
  })

  it("sink 写入失败不抛错（日志不得拖垮主流程）", async () => {
    appendMock.mockRejectedValue(new Error("disk full"))
    await createFileLogger()
    expect(() => makeEvent("WARN", "whisper.warn_event")).not.toThrow()
    await vi.waitFor(() => expect(appendMock).toHaveBeenCalled())
  })

  it("resolveLogDir 失败时 logger 保持可用（不抛错）", async () => {
    resolveMock.mockRejectedValue(new Error("no log dir"))
    await expect(createFileLogger()).resolves.toBeDefined()
    // loggerRef.log 不应抛（logDir=null 时 sink 静默跳过）
    expect(() => makeEvent("ERROR", "llm.call_failed")).not.toThrow()
  })

  it("事件名不合规仍抛错（编程错误不吞，不进 sink）", async () => {
    await createFileLogger()
    expect(() => makeEvent("ERROR", "bad-name" as string)).toThrow(/日志事件名不合规范/)
  })

  // ── 内存 sink + 订阅（SessionLogPanel 实时日志 Tab 依赖）──

  it("subscribeLogs 在 loggerRef.log 后同步收到事件", async () => {
    await createFileLogger()
    const received: LogEvent[] = []
    const unsub = subscribeLogs((e) => received.push(e))
    makeEvent("ERROR", "llm.call_failed")
    expect(received).toHaveLength(1)
    expect(received[0].event).toBe("llm.call_failed")
    expect(received[0].trace_id).toBe("t1")
    unsub()
  })

  it("unsubscribe 后不再收到事件", async () => {
    await createFileLogger()
    const received: LogEvent[] = []
    const unsub = subscribeLogs((e) => received.push(e))
    unsub()
    makeEvent("ERROR", "llm.call_failed")
    expect(received).toHaveLength(0)
  })

  it("抛错的订阅者不影响其余订阅者收到", async () => {
    await createFileLogger()
    const received: LogEvent[] = []
    subscribeLogs(() => {
      throw new Error("subscriber boom")
    })
    const unsub = subscribeLogs((e) => received.push(e))
    expect(() => makeEvent("ERROR", "llm.call_failed")).not.toThrow()
    expect(received).toHaveLength(1)
    unsub()
  })

  it("ring buffer 超过 RING_CAP 丢最老", async () => {
    await createFileLogger()
    // RING_CAP=2000（对齐 logger.ts）；push 2005 验证只保留最新 2000
    const RING_CAP = 2000
    for (let i = 0; i < RING_CAP + 5; i++) {
      makeEvent("DEBUG", "whisper.debug_tick")
    }
    expect(getBufferedLogs().length).toBe(RING_CAP)
  })

  it("DEBUG 事件到达订阅者但不写入文件（fileSinkAsync 过滤）", async () => {
    await createFileLogger()
    const received: LogEvent[] = []
    subscribeLogs((e) => received.push(e))
    makeEvent("DEBUG", "whisper.debug_tick")
    expect(received).toHaveLength(1)
    expect(received[0].level).toBe("DEBUG")
    // 文件 sink shouldLog(INFO) 过滤 DEBUG，不触发 appendTextFile
    expect(appendMock).not.toHaveBeenCalled()
  })
})
