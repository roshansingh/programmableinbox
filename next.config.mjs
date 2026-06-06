/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Mark thread-stream as external to prevent webpack from bundling
      // its non-code files (LICENSE, test artifacts, etc) that cause build failures.
      // thread-stream is only used at runtime by pino's transport layer, never needed at build time.
      config.externals = [...(config.externals || []), 'thread-stream']
    }
    return config
  },
}

export default nextConfig
