import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import type { ExternalRunner, HttpFetch, HttpResponse } from "@/core/types"

/**
 * 桥接层：把 Tauri 系统能力封装成 core 层依赖注入接口。
 * httpFetch / externalRunner / ensureWhisperModel / saveFileDialog / resolveOutputDir。
 */

export interface ProgressPayload {
  run_id: string
  stage: string
  detail: string
}

/** plugin-http 封装：绕开 WebView CORS。 */
export const tauriHttpFetch: HttpFetch = async (url, init) => {
  let body: BodyInit | undefined
  if (init?.body !== undefined) {
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body)
  }
  const response = await tauriFetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body
  })
  return response as unknown as HttpResponse
}

/** run_external 封装：sidecar/PATH 解析 + 进度事件路由到 onLine。 */
export const tauriRunner: ExternalRunner = async (program, args, options) => {
  const stage = options?.stage ?? null
  const id = options?.id ?? null
  let unlisten: UnlistenFn | undefined
  if (stage && options?.onLine) {
    unlisten = await listen<ProgressPayload>("summary://progress", (event) => {
      // 并发路由：仅接收本任务（id 匹配）且阶段匹配的事件。
      if ((!id || event.payload.run_id === id) && event.payload.stage === stage) {
        options.onLine?.(event.payload.detail)
      }
    })
  }
  try {
    return await invoke("run_external", {
      req: {
        program,
        args,
        cwd: options?.cwd ?? null,
        env: options?.env ?? null,
        stage,
        id
      }
    })
  } finally {
    await unlisten?.()
  }
}

/** 终止运行中的外部进程（按 run_id）。 */
export function killExternal(id: string): Promise<boolean> {
  return invoke("kill_external", { id })
}

/** 确保目录存在（截图 images 子目录用）。 */
export function ensureDir(path: string): Promise<void> {
  return invoke("create_dir", { path })
}

/** 递归删除目录（删除 session 产物用）。 */
export function removeDir(path: string): Promise<void> {
  return invoke("remove_dir", { path })
}

/** 按需下载外部二进制到应用数据目录（返回绝对路径）。 */
export function ensureExternalBinary(program: string): Promise<string> {
  return invoke("ensure_external_binary", { program })
}

/** 检测外部二进制可用性（不下载）：自定义路径 → sidecar → PATH → 缓存。 */
export function checkExternalBinary(program: string, customPath?: string | null): Promise<{
  available: boolean
  path: string | null
  error: string | null
}> {
  return invoke("check_external_binary", { program, customPath: customPath || null })
}

/** 检测 Whisper 模型是否已下载。 */
export function checkWhisperModel(model: string): Promise<boolean> {
  return invoke("check_whisper_model", { model })
}

/** 定位/下载 Whisper 模型（默认 base）。 */
export function ensureWhisperModel(model?: string): Promise<string> {
  return invoke("ensure_whisper_model", { model: model || null })
}

/** 原生另存为对话框并写入内容。 */
export function saveFileDialog(suggestedName: string, content: string): Promise<string | null> {
  return invoke("save_file", { suggestedName, content })
}

/** 定位/创建产物目录。 */
export function resolveOutputDir(runId: string): Promise<string> {
  return invoke("resolve_output_dir", { runId })
}

/** 写入文本文件。 */
export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke("write_text_file", { path, content })
}

/** 读取文本文件。 */
export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path })
}

/** 判断路径是否为文件。 */
export function pathIsFile(path: string): Promise<boolean> {
  return invoke("path_exists", { path })
}

/** 用系统默认应用打开路径（产物目录 / 文件）。 */
export async function openPath(path: string): Promise<void> {
  const { openPath: open } = await import("@tauri-apps/plugin-opener")
  await open(path)
}

/** 用系统默认浏览器打开 URL（走 opener 的 URL scope）。 */
export async function openUrl(url: string): Promise<void> {
  const { openUrl: open } = await import("@tauri-apps/plugin-opener")
  await open(url)
}
