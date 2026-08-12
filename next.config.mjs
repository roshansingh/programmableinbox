/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Prevent Turbopack (dev) from bundling pino's transport packages.
  // Without this, thread-stream is compiled with virtual /ROOT/... paths that
  // don't exist on disk, so its worker thread spawn fails at runtime.
  // pino-opentelemetry-transport (EE observability log shipping) is the same
  // category of package — loaded by Pino's worker-thread loader from a string
  // target name, never a static import — so it needs the same treatment.
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    'thread-stream',
    'pino-opentelemetry-transport',
  ],
  // pino-opentelemetry-transport is loaded via a runtime require() string
  // (Pino's worker-thread transport loader), not a static import, so Next's
  // output-file tracing for `standalone` misses it entirely — verified
  // empirically: `.next/standalone/**/node_modules/pino-opentelemetry-transport`
  // does not exist after `npm run build` without this entry.
  //
  // NOT load-bearing in the image we actually ship today: Dockerfile copies
  // the full `node_modules` over the trimmed standalone copy (see the `COPY
  // ... /app/node_modules ./node_modules` line), which overlays whatever this
  // produced and is what actually makes the package available at runtime.
  // This entry is defense-in-depth for a hypothetical future deployment path
  // that trims node_modules down to the traced/standalone copy — and even
  // then it's incomplete on its own, since the glob below doesn't cover
  // pino-opentelemetry-transport's hoisted OTel exporter dependencies it
  // requires at runtime (see docs/architecture/observability.md's "Build
  // note"). Keyed on 'instrumentation' because that's the root-level file
  // whose trace covers the whole server bundle.
  outputFileTracingIncludes: {
    'instrumentation': ['./node_modules/pino-opentelemetry-transport/**/*'],
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Mark thread-stream and pino-opentelemetry-transport as external to
      // prevent webpack from bundling their non-code files (LICENSE, test
      // artifacts, etc) that cause build failures. Both are only used at
      // runtime by pino's transport layer, never needed at build time.
      config.externals = [
        ...(config.externals || []),
        'thread-stream',
        'pino-opentelemetry-transport',
      ]
    }
    return config
  },
}

export default nextConfig
