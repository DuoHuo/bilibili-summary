import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-on-primary active:bg-primary-active h-10 rounded-md px-5 text-sm",
        secondary:
          "bg-surface-card text-ink border border-hairline active:bg-surface-cream-strong h-10 rounded-md px-5 text-sm",
        dark:
          "bg-surface-dark-elevated text-on-dark active:bg-surface-dark-soft h-10 rounded-md px-5 text-sm",
        outline:
          "bg-transparent text-ink border border-hairline active:bg-surface-soft h-10 rounded-md px-5 text-sm",
        ghost: "bg-transparent text-ink active:bg-surface-soft rounded-md",
        link: "bg-transparent text-primary underline-offset-2 hover:underline",
        destructive:
          "bg-error text-on-primary active:opacity-90 h-10 rounded-md px-5 text-sm"
      },
      size: {
        default: "h-10",
        sm: "h-8 px-3 text-sm",
        lg: "h-12 px-7 text-base",
        icon: "size-10 rounded-full"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "default"
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
