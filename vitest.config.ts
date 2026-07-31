import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// `server-only` resolves to a module that throws unless the bundler sets the
// `react-server` export condition, which Next does for server builds and Vitest
// does not. Point it at the package's own empty module so server modules that
// declare the marker stay importable from tests. Aliasing only this specifier
// is narrower than enabling `react-server` globally, which would change how
// other packages resolve.
const alias = {
  '@': path.resolve(__dirname, '.'),
  'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
}

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    css: false,
    exclude: ['node_modules', 'dist', '.worktrees/**/*', '.claude/**/*.test.*', '.claude/**/*.spec.*', 'test/integration/**'],
    projects: [
      {
        // UI component tests — jsdom with MSW setup
        test: {
          name: 'ui',
          include: ['components/__tests__/**/*.test.*', 'app/**/__tests__/**/*.test.*'],
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'http://localhost:4000' } },
          globals: true,
          setupFiles: ['./test/setup.ts'],
          env: { NEXT_PUBLIC_API_MODE: 'local' },
        },
        resolve: { alias },
      },
      {
        // Pure Node tests — lib utilities, no DOM
        test: {
          name: 'node',
          include: ['lib/__tests__/**/*.test.*', 'lib/**/__tests__/**/*.test.*'],
          environment: 'node',
          globals: true,
          env: { NEXT_PUBLIC_API_MODE: 'local' },
          typecheck: {
            enabled: true,
            include: ['lib/**/__tests__/**/*.test-d.ts'],
            // Scoped to type-test files only. A repo-wide `tsc --noEmit` would
            // fail on the pre-existing MobileSidebarProps errors in
            // app/phones/* (see CLAUDE.md), and next.config.mjs sets
            // ignoreBuildErrors, so without this the toOwnerScope guarantee
            // would hold in an editor but be unverified in CI.
            //
            // `include` alone is not enough: it selects which files' assertions
            // are collected, but tsc still walks the whole project and reports
            // every error it finds as an unhandled source error. There are 147
            // of those today. ignoreSourceErrors keeps this run failing only on
            // the type assertions below, which is the guarantee being verified.
            ignoreSourceErrors: true,
          },
        },
        resolve: { alias },
      },
    ],
  },
  resolve: { alias },
})
