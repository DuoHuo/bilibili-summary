import type { SVGProps } from "react"

/**
 * Anthropic-style 4-spoke radial spike mark. Used as the wordmark prefix
 * per DESIGN.md — never invert to white-on-dark within the wordmark itself.
 */
export function SpikeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 2 L12 22" />
      <path d="M2 12 L22 12" />
      <path d="M4.93 4.93 L19.07 19.07" />
      <path d="M19.07 4.93 L4.93 19.07" />
    </svg>
  )
}
