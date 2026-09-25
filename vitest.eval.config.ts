import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'
import path from 'path'

// Loads `.env.eval` only — never `.env`, which carries the development secrets.
// override:false, so a variable exported in the shell (or injected by CI) wins
// over the file. Loaded here, not in the runner, because this module is
// evaluated before the forked test workers, which inherit this process's env.
loadDotenv({ path: path.resolve(__dirname, '.env.eval'), override: false, quiet: true })

// See vitest.config.ts for why `server-only` is aliased to its empty module.
const alias = {
  '@': path.resolve(__dirname, '.'),
  'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
}

// Deliberately not referenced from vitest.config.ts: `npm test` must never see
// these files. The projects are named llm-cases / llm-selftest rather than
// anything containing the bare word "eval", which shell safety checks refuse.
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'llm-cases',
          include: ['test/llm-eval/**/*.eval.ts'],
          environment: 'node',
          globals: true,
          // One LLM round trip per case per run.
          testTimeout: 120_000,
          hookTimeout: 60_000,
          env: { LOG_LEVEL: 'silent' },
        },
        resolve: { alias },
      },
      {
        // Benchmarks one configured model over every case (test/llm-eval/bench.bench.ts).
        // Not part of `eval:email`: it measures a model, it does not guard a baseline.
        test: {
          name: 'llm-bench',
          include: ['test/llm-eval/**/*.bench.ts'],
          environment: 'node',
          globals: true,
          // A slow local model can take a while per call; the runner enforces its own per-case limit.
          testTimeout: 600_000,
          hookTimeout: 60_000,
          env: { LOG_LEVEL: 'silent' },
        },
        resolve: { alias },
      },
      {
        test: {
          name: 'llm-selftest',
          include: ['test/llm-eval/**/*.selftest.ts'],
          environment: 'node',
          globals: true,
          env: { LOG_LEVEL: 'silent' },
        },
        resolve: { alias },
      },
    ],
  },
})
