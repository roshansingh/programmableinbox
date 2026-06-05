import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { DEFAULT_API_KEY_SCOPES } from '@/lib/api-key-scopes'
const PREFIX_LENGTH = 12
const dryRun = process.argv.includes('--dry-run')

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
  const corruptedIds: string[] = []

  for (const apiKey of apiKeys) {
    if (!apiKey.apiKey) {
      if (!apiKey.prefix) {
        corruptedIds.push(apiKey.id)
        console.error(`Corrupted API key ${apiKey.id}: missing plaintext apiKey and prefix.`)
        continue
      }

      console.log(`Skipping ${apiKey.id}: plaintext apiKey is already missing but prefix is present.`)
      skipped += 1
      continue
    }

    const nextData = {
      keyHash: apiKey.keyHash ?? hashApiKey(apiKey.apiKey),
      prefix: apiKey.prefix ?? getKeyPrefix(apiKey.apiKey),
      scopes: apiKey.scopes.length > 0 ? apiKey.scopes : DEFAULT_API_KEY_SCOPES,
      apiKey: null as null,
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            id: apiKey.id,
            action: 'would-update',
            prefix: nextData.prefix,
            scopes: nextData.scopes,
          },
          null,
          2
        )
      )
      updated += 1
      continue
    }

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: nextData,
    })

    console.log(`Updated ${apiKey.id} with prefix ${nextData.prefix}.`)
    updated += 1
  }

  console.log(
    `Backfill complete${dryRun ? ' (dry run)' : ''}. Updated ${updated} API keys; skipped ${skipped} keys without plaintext values.`
  )

  if (corruptedIds.length > 0) {
    throw new Error(`Corrupted API keys require manual repair: ${corruptedIds.join(', ')}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to backfill API key hashes.', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
