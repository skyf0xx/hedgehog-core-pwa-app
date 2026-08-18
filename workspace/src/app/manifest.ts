import type { MetadataRoute } from 'next';

/**
 * Next's manifest route (App Router convention: src/app/manifest.ts ->
 * /manifest.webmanifest). Icons point at placeholder paths under
 * public/icons/ — providing real icon assets is a bootstrap-time or
 * project concern, not this core's.
 *
 * `force-static` is required under `output: 'export'` — static export
 * needs every route to declare it can be fully prerendered with no
 * per-request data.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'App',
    short_name: 'App',
    description: 'A local-first, installable web app.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
