import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

await import('./src/env.js')

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  generateBuildId: async () => process.env.SOURCE_COMMIT ?? null,
  distDir: process.env.SCOLO_BUILD_DIR ?? '.next',
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async redirects() {
    return [{ source: '/fr', destination: '/', permanent: false }]
  },
  transpilePackages: ['geist'],
}

export default config
