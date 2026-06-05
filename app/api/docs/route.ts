import { spec as emailInboxesSpec } from '@/lib/openapi/email-inboxes'

export function GET() {
  return Response.json(emailInboxesSpec)
}
