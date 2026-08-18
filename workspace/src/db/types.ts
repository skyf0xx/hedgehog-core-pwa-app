/**
 * Cross-cutting DB conventions (issue #172 §14) — types and documented
 * conventions, not enforcement mechanisms. Enforcement, where it exists,
 * lives in eslint.config.mjs and Zod schemas at the data boundary.
 */

/**
 * A timestamp stored and compared as an ISO 8601 UTC string, e.g.
 * `"2026-08-18T16:20:00.000Z"`. Branded so a plain `string` can't be
 * passed where a timestamp is expected without an explicit cast —
 * that cast is the one place to double check the value is actually
 * `new Date().toISOString()` (always UTC, always this format) and not a
 * locale-formatted or offset-bearing string.
 */
export type UtcTimestamp = string & { readonly __brand: 'UtcTimestamp' };

/** Wrap `new Date().toISOString()` (or another ISO-8601 UTC string) as a UtcTimestamp. */
export function toUtcTimestamp(isoString: string): UtcTimestamp {
  return isoString as UtcTimestamp;
}

/** The current instant as a UtcTimestamp. */
export function nowUtc(): UtcTimestamp {
  return toUtcTimestamp(new Date().toISOString());
}

/**
 * Every synced table's row carries these two fields so Dexie Cloud (or
 * a future sync mechanism) can partition and attribute rows without a
 * schema migration when sync is wired on. Unused until then, but
 * present from the first table onward so adding sync later never means
 * an app-wide row shape change.
 */
export interface Syncable {
  /** Dexie Cloud realm this row belongs to; unpartitioned rows use a single shared realm. */
  realmId: string;
  /** Owning user/principal id; local-only usage may set this to a fixed local user id. */
  owner: string;
}
