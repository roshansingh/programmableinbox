"use client"

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { ActionNodeConfig, AutomationNodeConfig, ConditionExprV1 } from '@/lib/automations/types'
import { ConditionBuilder } from './condition-builder'
import { AddTagForm } from './forms/add-tag-form'
import { AutoReplyForm } from './forms/auto-reply-form'
import { ForwardEmailForm } from './forms/forward-email-form'
import { SendWebhookForm } from './forms/send-webhook-form'
import { useAutomationEditor } from '@/components/automations/automation-editor-context'

export function NodeConfigSheet({
  node,
  open,
  onOpenChange,
  onConditionChange,
  onActionChange,
}: {
  node: AutomationNodeConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConditionChange: (condition: ConditionExprV1) => void
  onActionChange: (node: ActionNodeConfig) => void
}) {
  const { onDeleteBlock } = useAutomationEditor()
  const showDelete = node !== null && node.type !== 'trigger'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" showOverlay={false} className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {node ? `${node.type === 'action' ? node.actionType : node.type} configuration` : 'Node configuration'}
          </SheetTitle>
          <SheetDescription>
            Update automation behavior through forms instead of editing raw JSON.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {!node ? null : node.type === 'trigger' ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              The email received trigger is fixed in v1.
            </div>
          ) : node.type === 'condition' ? (
            <ConditionBuilder condition={node.config} onChange={onConditionChange} />
          ) : node.actionType === 'forward_email' ? (
            <ForwardEmailForm node={node} onChange={onActionChange as (node: Extract<ActionNodeConfig, { actionType: 'forward_email' }>) => void} />
          ) : node.actionType === 'send_webhook' ? (
            <SendWebhookForm node={node} onChange={onActionChange as (node: Extract<ActionNodeConfig, { actionType: 'send_webhook' }>) => void} />
          ) : node.actionType === 'auto_reply' ? (
            <AutoReplyForm node={node} onChange={onActionChange as (node: Extract<ActionNodeConfig, { actionType: 'auto_reply' }>) => void} />
          ) : (
            <AddTagForm node={node} onChange={onActionChange as (node: Extract<ActionNodeConfig, { actionType: 'add_tag' }>) => void} />
          )}
        </div>

        {showDelete ? (
          <SheetFooter className="items-start border-t">
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDeleteBlock(node.id)}
              data-testid="delete-block"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
