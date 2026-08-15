import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOMAIN_SCHEMAS } from '../schema'

const ROOT = resolve(__dirname, '../../..')
const example = readFileSync(resolve(ROOT, '.env.example'), 'utf8')

const ALL_VARS = Object.values(DOMAIN_SCHEMAS).flatMap((domain) => domain.vars as readonly string[])

/**
 * Set by the runtime (Next, Node, the test runner), never by an operator
 * editing `.env`. Documenting it would invite someone to set it by hand.
 */
const RUNTIME_MANAGED = new Set(['NODE_ENV'])

describe('.env.example', () => {
  it('documents every variable the schema reads', () => {
    // Matches both `FOO=` and a commented-out `# FOO=` for optional vars.
    const missing = ALL_VARS.filter(
      (name) => !RUNTIME_MANAGED.has(name) && !new RegExp(`^#?\\s*${name}=`, 'm').test(example),
    )

    expect(missing).toEqual([])
  })

  it('documents no variable the schema does not read', () => {
    const documented = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])
    const known = new Set<string>([
      ...ALL_VARS,
      // Read outside the app's config layer, so absent from DOMAIN_SCHEMAS:
      // consumed by the deploy stack's one-shot migrate container.
      'MIGRATE_DATABASE_URL',
      // Consumed by the otel-collector container (deploy/otel-collector.yaml),
      // not the app — real OTLP backend credentials, distinct from the app's
      // own OTEL_EXPORTER_OTLP_* vars which now just point at the collector.
      'OTEL_EXPORTER_ENDPOINT',
      'OTEL_EXPORTER_AUTH',
      // Read directly by @vercel/otel via the standard OTel SDK env var
      // convention, same as OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS — never
      // funneled through lib/config, so it has no schema entry either.
      'OTEL_EXPORTER_OTLP_PROTOCOL',
      // Client-side only — lives in lib/config/client.ts, which cannot import
      // the server-only schema registry.
      'NEXT_PUBLIC_API_MODE',
    ])

    const stale = [...new Set(documented)].filter((name) => !known.has(name))
    expect(stale).toEqual([])
  })
})
