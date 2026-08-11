import { createLogger, shouldLog, type LogEvent, type Logger } from "@/core/log"
import { appendTextFile, resolveLogDir } from "./tauri"

/** 日志文件最大体积（达此值滚动）；前端默认 1MB。 */
const LOG_MAX_BYTES = 1_000_000
/** 滚动档上限（含当前共 N 份）；前端默认 7。 */
const LOG_MAX_FILES = 7
/** INFO/DEBUG 批量 flush 的定时间隔。 */
const FLUSH_INTERVAL_MS = 5000
/** INFO/DEBUG 缓冲满此阈值立即 flush。 */
const BUFFER_FLUSH_THRESHOLD = 20
/** buffer 硬上限：logDir 解析失败导致 flush 早退时，丢最老防内存无界增长。 */
const BUFFER_HARD_CAP = 500
/** 内存 ring buffer 容量：供 UI 实时订阅本轮 session 日志；超出丢最老。 */
const RING_CAP = 2000
let logDir: string | null = null
/** 内存 ring buffer：所有级别事件同步入栈，供 UI 订阅（文件 sink 异步落盘不阻塞 UI）。 */
let ring: LogEvent[] = []
/** 订阅者集合：composite sink 每次写入逐个通知，各自 try/catch 隔离。 */
const subscribers = new Set<(e: LogEvent) => void>()

/** 读取内存 ring buffer 快照副本（供 UI 启动播种/重新派生）。返回副本防外部突变模块状态。 */
export function getBufferedLogs(): LogEvent[] {
  return ring.slice()
}

/** 当前日志目录（解析完成前为 null；供 UI「打开日志文件」）。 */
export function getLogDir(): string | null {
  return logDir
}

/** 订阅实时日志事件；返回取消订阅函数。 */
export function subscribeLogs(cb: (e: LogEvent) => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
let buffer: LogEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false

/**
 * 模块级 logger 引用：createFileLogger 解析完成后更新为文件 sink；
 * 解析前为 noop（不阻塞启动，不影响既有测试）。
 * sessions.ts / api.ts 共用此引用，保证 logger 解析后新调用立即用上文件 sink。
 */
export let loggerRef: Logger = createLogger(() => {})

/** composite sink：内存 push（同步，即时 UI）→ 通知订阅者（各自隔离）→ 文件 sink（异步）。 */
const compositeSink = (evt: LogEvent): void => {
  ring.push(evt)
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP)
  for (const cb of subscribers) {
    try {
      cb(evt)
    } catch {
      // 单个订阅者异常不影响其余（createLogger 的 sink 级 try/catch 会因一个抛错饿死所有）
    }
  }
  void fileSinkAsync(evt)
}

/** 文件 sink：WARN/ERROR 立即刷盘；INFO/DEBUG 进缓冲，定时或满阈值批量 append。 */
async function fileSinkAsync(evt: LogEvent): Promise<void> {
  // 文件 sink 只落 INFO 及以上（DEBUG 仅 UI 可见，不污染 app.log）
  if (!shouldLog(evt.level, "INFO")) return
  // 整体 try/catch：JSON.stringify 或任何意外抛错都不得变 unhandled rejection 反噬主流程
  try {
    const line = JSON.stringify(evt) + "\n"
    if (evt.level === "WARN" || evt.level === "ERROR") {
      await flushBuffer() // 先刷掉缓冲保序
      if (logDir) await appendTextFile(`${logDir}/app.log`, line, LOG_MAX_BYTES, LOG_MAX_FILES).catch(() => {})
      return
    }
    buffer.push(evt)
    // logDir 为 null（解析失败）时 flushBuffer 会早退，buffer 会无界增长——硬上限兜底，丢最老
    if (buffer.length > BUFFER_HARD_CAP) buffer.splice(0, buffer.length - BUFFER_HARD_CAP)
    if (buffer.length >= BUFFER_FLUSH_THRESHOLD) await flushBuffer()
  } catch {
    // 日志通道任何异常静默吞咽
  }
}

async function flushBuffer(): Promise<void> {
  if (flushing || buffer.length === 0 || !logDir) return
  flushing = true
  const batch = buffer.splice(0)
  const payload = batch.map((e) => JSON.stringify(e)).join("\n") + "\n"
  await appendTextFile(`${logDir}/app.log`, payload, LOG_MAX_BYTES, LOG_MAX_FILES).catch(() => {})
  flushing = false
}

/**
 * 启动期解析日志目录并启动定时 flush，返回文件 sink Logger。
 * 失败时 loggerRef 保持 noop（不抛错，日志不得拖垮主流程）。
 */
export async function createFileLogger(): Promise<Logger> {
  try {
    logDir = await resolveLogDir()
  } catch {
    logDir = null
  }
  if (flushTimer === null) {
    flushTimer = setInterval(() => void flushBuffer(), FLUSH_INTERVAL_MS)
  }
  // threshold=DEBUG：UI 订阅看全量；文件 sink 内部 shouldLog(INFO) 过滤 DEBUG 不落盘
  loggerRef = createLogger(compositeSink, "DEBUG")
  return loggerRef
}

/** 应用关闭前调用（可选）：刷掉残余缓冲 + 停定时器。 */
export async function flushLogs(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  await flushBuffer()
}

/** 测试专用：重置模块级状态（ring/buffer/subscribers/logDir/timer/loggerRef）。生产代码勿调。 */
export function _resetLogState(): void {
  ring = []
  buffer = []
  subscribers.clear()
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  flushing = false
  logDir = null
  loggerRef = createLogger(() => {})
}
