import fs from 'node:fs'
import path from 'node:path'

/**
 * Write `value` as pretty-printed JSON (trailing newline), creating the parent
 * directory first. The benchmark's documented `BENCH_OUT=out/qwen3-8b.json`
 * points into a directory a fresh checkout does not have, and a benchmark that
 * dies with ENOENT after its first case has thrown away the result it exists
 * to produce.
 */
export function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
