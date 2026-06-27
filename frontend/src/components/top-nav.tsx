import type { SVGProps } from "react"

import { SpikeMark } from "@/components/spike-mark"

export function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.2c-3.34.73-4.04-1.4-4.04-1.4-.55-1.39-1.34-1.76-1.34-1.76-1.1-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.4 1.24-3.24-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.23 1.92 1.23 3.24 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22v 3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5z" />
    </svg>
  )
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-hairline bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <a href="/" className="group flex items-center gap-2">
          <SpikeMark className="size-5 text-ink" />
          <span className="font-serif text-lg font-medium tracking-tight text-ink">
            Video Summary
          </span>
        </a>

        <nav className="flex items-center gap-2">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex size-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-soft"
            aria-label="GitHub"
          >
            <GitHubMark className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  )
}
