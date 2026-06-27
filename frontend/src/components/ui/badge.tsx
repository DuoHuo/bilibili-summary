import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-pill px-3 py-0.5 text-[13px] font-medium leading-tight transition-colors",
  {
    variants: {
      variant: {
        default: "bg-surface-card text-ink",
        coral:
          "bg-primary text-on-primary uppercase tracking-[0.09em] text-[12px] font-medium",
        outline: "border border-hairline text-ink bg-transparent",
        dark: "bg-surface-dark-elevated text-on-dark",
        teal: "bg-accent-teal/15 text-ink",
        amber: "bg-accent-amber/20 text-ink"
      }
    },
    defaultVariants: { variant: "default" }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
