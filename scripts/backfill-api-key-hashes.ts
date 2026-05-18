import crypto from 'crypto'
import { prisma } from '@/lib/db'

const DEFAULT_SCOPES = ['inboxes:read', 'messages:read']
const PREFIX_LENGTH = 12

function getKeyPrefix(rawKey: string) {
  return rawKey.slice(0, PREFIX_LENGTH)
}

function hashApiKey(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

async function main() {
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      OR: [
        { keyHash: null },
        { prefix: null },
      ],
    },
    select: {
      id: true,
      apiKey: true,
      keyHash: true,
      prefix: true,
      scopes: true,
    },
  })

  let updated = 0
  let skipped = 0

  for (const apiKey of apiKeys) {
    if (!apiKey.apiKey) {
      skipped += 1
      continue
    }

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        keyHash: apiKey.keyHash ?? hashApiKey(apiKey.apiKey),
        prefix: apiKey.prefix ?? getKeyPrefix(apiKey.apiKey),
        scopes: apiKey.scopes.length > 0 ? apiKey.scopes : DEFAULT_SCOPES,
        apiKey: null,
      },
    })

    updated += 1
  }

  console.log(`Backfill complete. Updated ${updated} API keys; skipped ${skipped} keys without plaintext values.`)
}

main()
  .catch((error) => {
    console.error('Failed to backfill API key hashes.', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
