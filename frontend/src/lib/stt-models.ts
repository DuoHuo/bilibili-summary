/** Whisper STT 模型清单（ggml 格式，用于 whisper-cli）。 */
export interface SttModel {
  id: string
  label: string
  /** 展示用占用空间（下载大小） */
  size: string
  sizeBytes: number
  description: string
}

export const STT_MODELS: ReadonlyArray<SttModel> = [
  { id: "ggml-tiny.bin", label: "tiny", size: "75 MB", sizeBytes: 75 * 1024 * 1024, description: "最快，精度较低" },
  { id: "ggml-base.bin", label: "base", size: "148 MB", sizeBytes: 148 * 1024 * 1024, description: "默认，速度与精度均衡" },
  { id: "ggml-small.bin", label: "small", size: "488 MB", sizeBytes: 488 * 1024 * 1024, description: "较高精度" },
  { id: "ggml-medium.bin", label: "medium", size: "1.5 GB", sizeBytes: 1536 * 1024 * 1024, description: "高精度，较慢" },
  { id: "ggml-large-v3.bin", label: "large-v3", size: "3.1 GB", sizeBytes: 3180 * 1024 * 1024, description: "最高精度，最慢" }
]

export const DEFAULT_STT_MODEL = "ggml-base.bin"

export function findSttModel(id: string): SttModel {
  return STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[1]
}
