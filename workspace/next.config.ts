import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

/**
 * Static export: this core ships a local-first PWA with no server tier
 * (Dexie/IndexedDB is the only persistence layer at this phase; a
 * `--remote` module's Supabase calls happen client-side against a
 * hosted backend, not this app's own server). `output: 'export'` builds
 * to static HTML/JS/CSS in `out/`, deployable to any static host or
 * wrapped by a native shell.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
};

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Static export has no server runtime to precache against at request
  // time, so disable in dev to keep `next dev` fast; production builds
  // still generate and precache the service worker.
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist(nextConfig);
