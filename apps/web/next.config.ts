import path from 'node:path';
import type { NextConfig } from 'next';
import { SETTINGS_REDIRECTS } from './src/utils/settingsRedirects';

const nextConfig: NextConfig = {
  // standalone build for a lean docker image.
  output: 'standalone',
  // Monorepo: include the repo root in file tracing for standalone.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  // isomorphic-dompurify loads jsdom on the server, and jsdom reads its own data
  // files (default-stylesheet.css) by a path relative to its module. Bundling it
  // breaks that path, so it is required from node_modules at runtime instead.
  serverExternalPackages: ['isomorphic-dompurify'],
  // Avatars and attachments are served by the api on its own origin, and the
  // image optimizer only fetches from allowed origins. NEXT_PUBLIC_API_URL is
  // the value the client uses too (src/lib/graphql.ts) and is set at build time.
  images: {
    remotePatterns: [new URL('/**', process.env.NEXT_PUBLIC_API_URL)],
  },
  // No page of the app is shown inside another site's frame, so the OAuth consent
  // page (and every other page with a cookie-authenticated action) cannot be
  // clickjacked.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  // The inbox is workspace-wide (/inbox); the old per-team address leads there. The
  // settings pages moved under /settings; their old addresses lead there too.
  async redirects() {
    return [
      { source: '/team/:teamKey/inbox', destination: '/inbox', permanent: false },
      ...SETTINGS_REDIRECTS.map((r) => ({ ...r, permanent: false })),
    ];
  },
};

export default nextConfig;
