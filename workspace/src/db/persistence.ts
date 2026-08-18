/**
 * Requests persistent storage from the browser so the UA is less likely
 * to evict IndexedDB data under storage pressure. Best-effort: some
 * browsers auto-grant based on site-engagement heuristics, some prompt,
 * some don't implement the API at all. Called once from database.ts on
 * Dexie's `ready` event — see database.ts for the call site.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
