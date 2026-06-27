import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"

export function Hero({ children }: { children?: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-6 pt-20 md:pt-28">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="coral" className="px-3 py-1">
          VIDEO INTELLIGENCE · ALPHA
        </Badge>
        <h1 className="display-xl text-ink">
          把一段视频，
          <br />
          浓缩成一篇可读的笔记。
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-body">
          粘贴 B 站或 YouTube 链接，自动抓取字幕（必要时本地 Whisper 转录），
          调用大模型生成结构化 Markdown 摘要，可下载、可分享、可归档。
        </p>
      </div>
      {children ? <div className="mt-10 md:mt-12">{children}</div> : null}
    </section>
  )
}
