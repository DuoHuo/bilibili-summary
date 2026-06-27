import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

interface CustomPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onSave: (value: string) => void
}

export function CustomPromptDialog({
  open,
  onOpenChange,
  value,
  onSave
}: CustomPromptDialogProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const handleSave = () => {
    onSave(draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-8 sm:max-w-2xl md:p-10">
        <DialogHeader>
          <DialogTitle>自定义 Prompt 模板</DialogTitle>
          <DialogDescription>
            编辑自定义模板。支持 <code>{"{{title}}"}</code> 与 <code>{"{{transcript}}"}</code> 两个占位符，后端会原样替换。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-[60vh] font-mono text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存并使用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
