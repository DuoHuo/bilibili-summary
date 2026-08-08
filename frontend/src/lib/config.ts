import { load } from "@tauri-apps/plugin-store"
import { isUserConfig, type UserConfig } from "./types"
import type { PromptMode } from "./prompts"

const CONFIG_FILE = "user-config.json"
const CONFIG_KEY = "active"

/** 桌面版配置持久化：Tauri plugin-store（JSON 文件，存 app config dir）。 */
export async function saveConfig(config: UserConfig): Promise<void> {
  const store = await load(CONFIG_FILE, { autoSave: true })
  await store.set(CONFIG_KEY, config)
  await store.save()
}

export async function loadConfig(): Promise<UserConfig | null> {
  const store = await load(CONFIG_FILE)
  const value = await store.get<unknown>(CONFIG_KEY)
  const validated = isUserConfig(value) ? value : null
  // 旧配置 "transcript" → 新 "timestamp"
  if (validated && validated.promptMode === ("transcript" as PromptMode)) {
    return { ...validated, promptMode: "timestamp" }
  }
  return validated
}
