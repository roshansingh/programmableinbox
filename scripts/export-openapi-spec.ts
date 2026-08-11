import { mkdirSync, writeFileSync } from 'node:fs'
import { spec } from '../lib/openapi/email-inboxes'

// SDKs default to servers[0]; the served /api/docs spec keeps localhost
// first so the Swagger UI "Try it out" button cannot fire at production
// by accident.
const production = spec.servers.filter((s) => s.url.startsWith('https://'))
const rest = spec.servers.filter((s) => !s.url.startsWith('https://'))
const forSdk = { ...spec, servers: [...production, ...rest] }

mkdirSync('sdk', { recursive: true })
writeFileSync('sdk/openapi.json', `${JSON.stringify(forSdk, null, 2)}\n`)
console.log('Wrote sdk/openapi.json')
