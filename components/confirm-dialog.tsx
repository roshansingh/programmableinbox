"use client"

import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * Replaces `window.confirm` for destructive actions. The dialog stays open and
 * both buttons stay disabled until `onConfirm` settles, so a slow request
 * cannot be dismissed out from under itself or submitted twice.
 *
 * Render it as a sibling of any clickable row, never inside one: portal events
 * bubble through the React tree, so a click on Confirm would otherwise reach
 * the row's own `onClick`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  const [isPending, setIsPending] = useState(false)

  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    // Radix closes the dialog on Action click; hold it open until we finish.
    event.preventDefault()
    setIsPending(true)
    try {
      await onConfirm()
    } finally {
      setIsPending(false)
      onOpenChange(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={handleConfirm}
            className={
              destructive ? buttonVariants({ variant: 'destructive' }) : undefined
            }
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
