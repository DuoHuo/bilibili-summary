"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "!bg-canvas !text-ink !border !border-hairline !rounded-md !shadow-lg",
          title: "!font-medium !text-ink",
          description: "!text-muted",
          actionButton: "!bg-primary !text-on-primary",
          cancelButton: "!bg-surface-card !text-ink"
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
