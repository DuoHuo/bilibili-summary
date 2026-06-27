import { SpikeMark } from "@/components/spike-mark"

export function Footer() {
  return (
    <footer className="bg-surface-dark">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-12 text-on-dark-soft md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <SpikeMark className="size-4 text-on-dark" />
          <span className="font-serif text-base font-medium text-on-dark">
            Video Summary
          </span>
          <span className="text-on-dark-soft">· 前后端可部署的视频摘要工具</span>
        </div>
        <p className="text-xs text-on-dark-soft">
          React + Vite · Rust + Axum · 参考 BibiGPT-v1 / BiliNote
        </p>
      </div>
    </footer>
  )
}
