import tseslint from 'typescript-eslint'

/**
 * Minimal flat config.
 *
 * The repo had no eslint config at all — `npm run lint` failed outright, and
 * the lint step in .github/workflows/test.yml was commented out because of it.
 * This deliberately carries a single rule rather than a preset: adopting
 * `next/core-web-vitals` here would surface a large pre-existing backlog that
 * has nothing to do with configuration handling, and would keep the lint step
 * disabled for another release.
 *
 * The rule that is here enforces the point of lib/config: environment
 * variables are read in exactly one place, so they cannot be consumed
 * unvalidated.
 */
const NO_RAW_ENV =
  'Read configuration through `@/lib/config` instead of process.env. ' +
  'Add the variable to lib/config/schema.ts so it is validated, typed and documented.'

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'lib/generated/**',
      '.claude/**',
      'coverage/**',
      'dist/**',
    ],
  },
  // Parser and plugin only — `base` enables no rules of its own, which keeps
  // this config to the single rule below.
  tseslint.configs.base,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Matches the `process.env` node itself, which every access form
          // contains: `process.env.FOO`, `process.env['FOO']`, destructuring
          // and spreads all nest it. One selector, so no duplicate reports.
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: NO_RAW_ENV,
        },
      ],
    },
  },
  {
    /**
     * The allowlist: modules that legitimately bootstrap or exercise
     * configuration.
     *
     * `prisma.config.ts` and `prisma/seed.ts` run outside Next, under the
     * Prisma CLI and tsx respectively, so they must not pull in `server-only`
     * or the app's module graph. `instrumentation.ts` is the boot hook that
     * calls assertConfig(). Test and harness files set the environment they
     * validate against.
     */
    files: [
      'lib/config/**',
      'prisma.config.ts',
      'prisma/seed.ts',
      'next.config.mjs',
      'instrumentation.ts',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      'eslint.config.mjs',
      'test/**',
      'scripts/**',
      '**/__tests__/**',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
)
