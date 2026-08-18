/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';
import type { PrecacheEntry } from 'serwist';

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

/**
 * Precaches the app shell (`__SW_MANIFEST`, injected by `@serwist/next`'s
 * webpack plugin at build time) and falls back to `/~offline` for
 * navigations that can't reach the network — the minimum viable offline
 * story for a zero-feature shell. A real module's screen layer can add
 * finer-grained runtime caching (e.g. for --remote entity API calls)
 * without touching this file's precache wiring.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
