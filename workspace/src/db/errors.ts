/**
 * Discriminated error type for the data layer (issue #172 §14). Every
 * repository, import/export routine, and integration client should
 * reject/throw one of these rather than a bare Error, so callers can
 * branch on `kind` instead of parsing a message string.
 */
export type AppErrorKind = 'validation' | 'persistence' | 'network' | 'provider' | 'unexpected';

export interface AppError {
  kind: AppErrorKind;
  message: string;
  cause?: unknown;
}

function makeError(kind: AppErrorKind) {
  return (message: string, cause?: unknown): AppError => ({ kind, message, cause });
}

/** A Zod parse (or other input-shape) failure. */
export const validationError = makeError('validation');
/** A Dexie/IndexedDB read or write failure. */
export const persistenceError = makeError('persistence');
/** A fetch/HTTP failure talking to an external API or a --remote entity's Supabase backend. */
export const networkError = makeError('network');
/** A failure surfaced by a third-party provider SDK (integrations/*). */
export const providerError = makeError('provider');
/** Anything that doesn't fit the above — keep this bucket small; prefer a specific kind. */
export const unexpectedError = makeError('unexpected');

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { kind: unknown }).kind === 'string'
  );
}
