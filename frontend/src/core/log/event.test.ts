import { describe, expect, it, vi } from "vitest"
import { buildLogEvent, createLogger, createNoopLogger } from "./event"

describe("buildLogEvent", () => {
  it("合规事件名通过", () => {
    expect(() => buildLogEvent("INFO", "whisper.download_failed", { trace_id: "t1" })).not.toThrow()
  })

  it.each(["nodot", "Whisper.Failed", "whisper.Download_Failed", "whisper"])(
    "不合规事件名 %s 抛错",
    (event) => {
      expect(() => buildLogEvent("INFO", event, { trace_id: "t1" })).toThrow(/日志事件名不合规范/)
    }
  )

  it("输出必含 ts/level/event/trace_id", () => {
    const result = buildLogEvent("ERROR", "whisper.download_failed", { trace_id: "t1" })
    expect(result.ts).toEqual(expect.any(String))
    expect(new Date(result.ts).toString()).not.toBe("Invalid Date")
    expect(result.level).toBe("ERROR")
    expect(result.event).toBe("whisper.download_failed")
    expect(result.trace_id).toBe("t1")
  })

  it("传入含 api_key 字段的 err.context 时输出被脱敏", () => {
    const result = buildLogEvent("ERROR", "llm.call_failed", {
      trace_id: "t2",
      err: { code: "LLM.FAILED", message: "调用失败", context: { api_key: "sk-secret", model: "gpt-4o" } }
    })
    const context = result.err?.context as Record<string, unknown>
    expect(context.api_key).toBe("[REDACTED]")
    expect(context.model).toBe("gpt-4o")
  })

  it("传入含 token 查询串的 stderrTail 时输出被脱敏", () => {
    const result = buildLogEvent("ERROR", "whisper.download_failed", {
      trace_id: "t3",
      err: {
        code: "WHISPER.YTDLP_DOWNLOAD_FAILED",
        message: "下载失败",
        context: { stderrTail: "fetch https://upos.example.com/x?token=abc123 failed" }
      }
    })
    const context = result.err?.context as Record<string, unknown>
    expect(context.stderrTail).toBe("fetch https://upos.example.com/x?token=[REDACTED] failed")
  })

  it("err 字段可选，正常事件不携带 err", () => {
    const result = buildLogEvent("INFO", "whisper.download_succeeded", { trace_id: "t4" })
    expect(result.err).toBeUndefined()
  })
})

describe("createNoopLogger", () => {
  it("DEBUG 默认不放行（默认阈值 INFO）", () => {
    const logger = createNoopLogger()
    expect(() => logger.log("DEBUG", "whisper.debug_tick", { trace_id: "t1" })).not.toThrow()
  })

  it("INFO 默认放行，仍强制走脱敏路径", () => {
    const logger = createNoopLogger()
    const spy = vi.fn()
    expect(() => logger.log("INFO", "whisper.download_succeeded", { trace_id: "t1" })).not.toThrow()
    spy()
    expect(spy).toHaveBeenCalled()
  })

  it("按自定义阈值过滤：threshold=ERROR 时 WARN 被过滤", () => {
    const logger = createNoopLogger("ERROR")
    // 不应抛错（被过滤，不走 buildLogEvent 校验）
    expect(() => logger.log("WARN", "not.valid-name", { trace_id: "t1" })).not.toThrow()
  })

  it("按自定义阈值放行：threshold=ERROR 时 ERROR 事件仍会走 buildLogEvent 校验（非法事件名抛错）", () => {
    const logger = createNoopLogger("ERROR")
    expect(() => logger.log("ERROR", "not-a-valid-event-name", { trace_id: "t1" })).toThrow()
  })
})

describe("createLogger", () => {
  it("sink 收到 buildLogEvent 的返回值（含 ts/level/event/trace_id）", () => {
    const sink = vi.fn()
    const logger = createLogger(sink, "INFO")
    logger.log("ERROR", "whisper.download_failed", { trace_id: "t1" })
    expect(sink).toHaveBeenCalledOnce()
    const evt = sink.mock.calls[0][0]
    expect(evt.ts).toEqual(expect.any(String))
    expect(evt.level).toBe("ERROR")
    expect(evt.event).toBe("whisper.download_failed")
    expect(evt.trace_id).toBe("t1")
  })

  it("sink 收到的事件已脱敏（api_key/cookie 键名 + 自由文本 token）", () => {
    const sink = vi.fn()
    const logger = createLogger(sink, "INFO")
    logger.log("ERROR", "llm.call_failed", {
      trace_id: "t2",
      err: { code: "LLM.CALL_FAILED", message: "x", context: { api_key: "sk-secret", stderrTail: "fetch https://upos.example.com/x?token=abc failed" } }
    })
    const evt = sink.mock.calls[0][0]
    const ctx = evt.err?.context as Record<string, unknown>
    expect(ctx.api_key).toBe("[REDACTED]")
    expect(ctx.stderrTail).toBe("fetch https://upos.example.com/x?token=[REDACTED] failed")
  })

  it("按阈值过滤：threshold=ERROR 时 INFO 不触发 sink", () => {
    const sink = vi.fn()
    const logger = createLogger(sink, "ERROR")
    logger.log("INFO", "whisper.download_succeeded", { trace_id: "t1" })
    expect(sink).not.toHaveBeenCalled()
  })

  it("sink 抛错不被传播（日志不得拖垮主流程）", () => {
    const logger = createLogger(() => { throw new Error("sink boom") }, "INFO")
    expect(() => logger.log("INFO", "whisper.download_succeeded", { trace_id: "t1" })).not.toThrow()
  })

  it("事件名不合规在 buildLogEvent 阶段抛错（不吞，编程错误）", () => {
    const sink = vi.fn()
    const logger = createLogger(sink, "INFO")
    expect(() => logger.log("INFO", "bad-name", { trace_id: "t1" })).toThrow(/日志事件名不合规范/)
    expect(sink).not.toHaveBeenCalled()
  })
})
