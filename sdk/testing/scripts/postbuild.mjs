import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// dist/esm is plain .js emitted by tsc; without this marker Node would treat it
// as CommonJS because the package root has no "type": "module".
const here = dirname(fileURLToPath(import.meta.url))
const esm = resolve(here, '../dist/esm')
mkdirSync(esm, { recursive: true })
writeFileSync(resolve(esm, 'package.json'), '{"type":"module"}\n')
