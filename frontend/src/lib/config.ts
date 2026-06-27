import type { PromptMode } from "./prompts"
import type { UserConfig } from "./types"

const CONFIG_DB_NAME = "siriusx-summary"
const CONFIG_STORE = "user-config"
const CONFIG_KEY = "active"

function isUserConfig(value: unknown): value is UserConfig {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.apiKey === "string" &&
    typeof record.model === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.prompt === "string" &&
    typeof record.cookie === "string" &&
    (record.sttLanguage === "zh-cn" || record.sttLanguage === "en") &&
    typeof record.screenshot === "boolean"
  )
}

function openConfigDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
  const request = indexedDB.open(CONFIG_DB_NAME, 1)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(CONFIG_STORE)) {
      db.createObjectStore(CONFIG_STORE)
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
  return promise
}

export async function saveConfig(config: UserConfig): Promise<void> {
  const db = await openConfigDb()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const tx = db.transaction(CONFIG_STORE, "readwrite")
  tx.objectStore(CONFIG_STORE).put(config, CONFIG_KEY)
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  return promise
}

export async function loadConfig(): Promise<UserConfig | null> {
  const db = await openConfigDb()
  const { promise, resolve, reject } = Promise.withResolvers<UserConfig | null>()
  const tx = db.transaction(CONFIG_STORE, "readonly")
  const request = tx.objectStore(CONFIG_STORE).get(CONFIG_KEY)
  request.onsuccess = () => {
    const validated = isUserConfig(request.result) ? request.result : null
    // 旧配置 "transcript" → 新 "timestamp"
    if (validated && validated.promptMode === "transcript" as PromptMode) {
      resolve({ ...validated, promptMode: "timestamp" })
      return
    }
    resolve(validated)
  }
  request.onerror = () => reject(request.error)
  return promise
}
