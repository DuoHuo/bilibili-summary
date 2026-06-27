import * as React from "react"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical"
  }
>(({ className, orientation = "horizontal", ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    aria-orientation={orientation}
    className={cn(
      "bg-hairline",
      orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
      className
    )}
    {...props}
  />
))
Separator.displayName = "Separator"

export { Separator }
