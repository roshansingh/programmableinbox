import { mkdirSync, writeFileSync } from 'node:fs'
import { spec } from '../lib/openapi/email-inboxes'

mkdirSync('sdk', { recursive: true })
writeFileSync('sdk/openapi.json', `${JSON.stringify(spec, null, 2)}\n`)
console.log('Wrote sdk/openapi.json')
