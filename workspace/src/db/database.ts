import Dexie from 'dexie';
import { applySchema } from './schema';
import { requestPersistence } from './persistence';

/**
 * The single Dexie instance every feature's repository imports. Do not
 * construct a second `Dexie(...)` anywhere else — one database, one
 * version chain, defined once here.
 *
 * Sync-ready but not wired: table primary keys are Dexie's sharded
 * auto-generated string keys (`@id` in a table's schema string, added
 * by the entity generator), and each synced table's row shape carries
 * `realmId`/`owner` (see ./types.ts's `Syncable`) so turning on Dexie
 * Cloud later is additive — no key or row-shape migration needed. The
 * `dexie-cloud-addon` package itself is intentionally not a dependency
 * yet; the bootstrap skill adds it when sync is turned on.
 */
export const db = new Dexie('app');

applySchema(db);

db.on('ready', () => {
  void requestPersistence();
});
