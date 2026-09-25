// Prints a comparison table from benchmark result files (BENCH_OUT of `npm run eval:email:bench`).
// Usage: node test/llm-eval/scripts/bench-table.mjs out/*.json
import fs from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node test/llm-eval/scripts/bench-table.mjs <result.json>...')
  process.exit(1)
}

const rows = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
const pct = (n, d) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`)
const ms = (v) => (v === null ? '-' : v >= 10000 ? `${(v / 1000).toFixed(0)}s` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)

const header = [
  'model', 'cases', 'usable', 'cats=baseline*', 'cats=mode', 'cats=intent', 'covers intent',
  'OTP=baseline', 'false OTP', 'links agree', 'median', 'p95', 'tok in/out',
]
const table = rows.map(({ label, summary: s }) => [
  label, String(s.cases), pct(s.usable, s.cases), pct(s.categoriesSeen, s.cases), pct(s.categoriesMode, s.cases),
  pct(s.categoriesIntent, s.cases), pct(s.coversIntent, s.cases), pct(s.otpMatchesBaseline, s.cases),
  String(s.llmFalseOtp), pct(s.linksAgree, s.linksJudged), ms(s.latency.medianMs), ms(s.latency.p95Ms),
  `${s.tokens.meanPrompt ?? '-'}/${s.tokens.meanCompletion ?? '-'}`,
])

const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)))
const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`
console.log(line(header))
console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`)
for (const r of table) console.log(line(r))
console.log('\n* "cats=baseline": the category set is one gpt-4o-mini gave for that case while its baseline was generated.')
