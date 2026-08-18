'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * TanStack Query is for external API responses only (issue #172 §5) —
 * local data goes through Dexie via a feature's repository, never
 * through this client. One QueryClient per app, created once per
 * mount via useState so it survives re-renders but not a full remount.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
