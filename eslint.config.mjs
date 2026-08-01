// @ts-check
import tseslint from 'typescript-eslint'

/**
 * Files that are explicitly permitted to read `process.env` directly.
 *
 * These are the seams between the app and the OS environment:
 *  - lib/config/   — the only place allowed to read env vars in app code
 *  - prisma.config.ts / prisma/seed.ts — run outside Next.js, no config module
 *  - next.config.mjs — evaluated by the Next.js CLI before the app boots
 *  - vitest*.config.ts — test runner config, not part of the app bundle
 *  - test/integration/ — integration test harness, real DB setup/teardown
 */
const ENV_ALLOWED = [
  'lib/config/**',
  'prisma.config.ts',
  'prisma/seed.ts',
  'next.config.mjs',
  'vitest.config.ts',
  'vitest.integration.config.ts',
  'test/integration/**',
  // Test files legitimately set process.env to configure lazy-loaded modules
  // before a vi.resetModules() + dynamic import. The ban targets production code.
  '**/__tests__/**',
  '**/*.test.{ts,tsx,js,mjs}',
  '**/*.spec.{ts,tsx,js,mjs}',
]

export default tseslint.config(
  // Ignore generated/build artefacts and dependency trees
  {
    ignores: [
      'node_modules/**',
      'lib/generated/**',
      '.next/**',
      'dist/**',
    ],
  },
  // TypeScript-aware base config for all source files
  ...tseslint.configs.recommended,
  // Process.env access ban — everything except the allowed seams
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    ignores: ENV_ALLOWED,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Ban direct process.env property access outside the allowed seams.
          // Use `config.*` from lib/config instead.
          selector:
            'MemberExpression[object.name="process"][property.name="env"]',
          message:
            'Direct process.env access is banned. Import from @/lib/config instead. ' +
            'Only lib/config/**, prisma.config.ts, prisma/seed.ts, next.config.mjs, ' +
            'and vitest*.config.ts are allowed to read process.env directly.',
        },
      ],
      // Pre-existing codebase uses `any` in places; disable to avoid noise from
      // issues that pre-date this lint setup.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
