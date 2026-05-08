"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Send } from "lucide-react"
import { sendEmail, type EmailMessage } from "@/lib/api/emails.api"
import { toast } from "sonner"

type ComposeMode = "reply" | "forward"

interface ComposeEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inboxId: string
  inboxEmail: string
  mode: ComposeMode
  originalMessage: EmailMessage
  onSent?: () => void
}

function buildReplySubject(subject: string): string {
  return subject.startsWith("Re: ") ? subject : `Re: ${subject}`
}

function buildForwardSubject(subject: string): string {
  return subject.startsWith("Fwd: ") ? subject : `Fwd: ${subject}`
}

function buildQuotedText(msg: EmailMessage): string {
  const date = new Date(msg.createdAt).toLocaleString()
  return `\n\n---------- Original Message ----------\nFrom: ${msg.from}\nDate: ${date}\nSubject: ${msg.subject}\nTo: ${msg.to.join(", ")}\n\n${msg.text}`
}

function buildReferences(msg: EmailMessage): string {
  const refs = msg.references?.length ? msg.references : []
  if (msg.messageId) refs.push(msg.messageId)
  return refs.join(" ")
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  inboxId,
  inboxEmail,
  mode,
  originalMessage,
  onSent,
}: ComposeEmailDialogProps) {
  const isReply = mode === "reply"

  const [to, setTo] = useState(isReply ? originalMessage.from : "")
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState(
    isReply
      ? buildReplySubject(originalMessage.subject)
      : buildForwardSubject(originalMessage.subject)
  )
  const [body, setBody] = useState(buildQuotedText(originalMessage))
  const [isSending, setIsSending] = useState(false)

  const handleSend = async () => {
    const toAddresses = to.split(",").map((e) => e.trim()).filter(Boolean)
    if (toAddresses.length === 0) {
      toast.error("At least one recipient is required")
      return
    }
    if (!subject.trim()) {
      toast.error("Subject is required")
      return
    }
    if (!body.trim()) {
      toast.error("Message body is required")
      return
    }

    setIsSending(true)
    try {
      const ccAddresses = cc.split(",").map((e) => e.trim()).filter(Boolean)
      await sendEmail(inboxId, {
        to: toAddresses,
        cc: ccAddresses.length > 0 ? ccAddresses : undefined,
        subject,
        text: body,
        inReplyTo: isReply ? originalMessage.messageId || undefined : undefined,
        references: isReply ? buildReferences(originalMessage) || undefined : undefined,
      })
      toast.success("Email sent successfully")
      onOpenChange(false)
      onSent?.()
    } catch (error: any) {
      toast.error(error?.message || "Failed to send email")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isReply ? "Reply" : "Forward"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input value={inboxEmail} disabled className="bg-muted" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
            <Input
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              disabled={isSending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cc" className="text-xs text-muted-foreground">Cc</Label>
            <Input
              id="cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com (optional)"
              disabled={isSending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="subject" className="text-xs text-muted-foreground">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="body" className="text-xs text-muted-foreground">Message</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-sm resize-none"
              disabled={isSending}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            <Send className="h-4 w-4 mr-2" />
            {isSending ? "Sending..." : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
