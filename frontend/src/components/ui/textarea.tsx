import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-base text-ink transition-colors",
      "placeholder:text-muted-soft",
      "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
))
Textarea.displayName = "Textarea"

export { Textarea }
