// test/integration/helpers/factories.ts
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'

let n = 0
const next = () => (n += 1)

export async function seedInbox(orgId: string, userId: string, over: Partial<Prisma.EmailInboxUncheckedCreateInput> = {}) {
  return prisma.emailInbox.create({
    data: { organizationId: orgId, userId, email: `inbox-${next()}@test.dev`, name: 'Inbox', ...over },
  })
}

export async function seedMessage(inboxId: string, orgId: string, over: Partial<Prisma.EmailMessageUncheckedCreateInput> = {}) {
  const id = next()
  return prisma.emailMessage.create({
    data: {
      from: `sender-${id}@test.dev`,
      to: ['inbox@test.dev'],
      bcc: [], cc: [],
      subject: `Subject ${id}`,
      text: 'body', html: '<p>body</p>', headers: {},
      externalId: `ext-${id}`,
      inboxEmailAddressId: inboxId,
      organizationId: orgId,
      threadId: `00000000-0000-7000-8000-${String(id).padStart(12, '0')}`,
      messageId: `<msg-${id}@test.dev>`,
      references: [],
      ...over,
    },
  })
}

export async function seedWebhook(orgId: string, over: Partial<Prisma.WebhookUncheckedCreateInput> = {}) {
  return prisma.webhook.create({
    data: { organizationId: orgId, name: `hook-${next()}`, url: 'https://example.test/hook', events: ['email.received'], ...over },
  })
}

export async function seedAutomation(orgId: string, inboxId?: string, over: Partial<Prisma.AutomationUncheckedCreateInput> = {}) {
  const automation = await prisma.automation.create({
    data: { organizationId: orgId, inboxId: inboxId ?? null, name: `automation-${next()}`, ...over },
  })
  const revision = await prisma.automationRevision.create({
    data: {
      automationId: automation.id,
      revision: 1,
      schemaVersion: 1,
      config: { nodes: [], edges: [] },
    },
  })
  await prisma.automation.update({ where: { id: automation.id }, data: { activeRevisionId: revision.id } })
  return { automation, revision }
}
