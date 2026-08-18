'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * TanStack Query is this core's hook layer: every module's hooks wrap
 * calls to that module's Dexie-backed (or, for a `--remote` module,
 * Supabase-backed) repository through this client, giving loading,
 * error, and cache behavior over local reads and writes as well as any
 * external API call. One QueryClient per app, created once per mount
 * via useState so it survives re-renders but not a full remount.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
