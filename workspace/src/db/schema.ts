import type { Dexie } from 'dexie';

/**
 * The schema barrel. Not generated/derived — a normal source file each
 * module's `schema` layer appends one import + one `.stores()` line to,
 * the same append-only discipline `hedgehog-core-full-stack-app`'s
 * `packages/db/src/schema/index.ts` barrel uses (see
 * ../../.design-notes.md §1 in the core package's repo root for the
 * full rationale — not shipped inside this workspace).
 *
 * One `src/db/tables/{module}.table.ts` file per module exports that
 * module's table name, Dexie store schema string, and the integer
 * version it was introduced at. The `entity`/`feature` generator writes
 * that file and appends the corresponding import and `.version(n)
 * .stores({...})` call below, in one shot, at generation time.
 *
 * No modules yet: this starts as a minimal valid `version(1)` chain
 * with zero tables. Dexie requires at least one `.version().stores()`
 * call before the database can open.
 *
 * // GENERATOR: import each module's table module here, one line per
 * // module, e.g.:
 * //   import * as todos from './tables/todos.table';
 *
 * // GENERATOR: chain that module's version().stores() call onto
 * // `applySchema` below, e.g.:
 * //   db.version(todos.version).stores({ [todos.tableName]: todos.schema });
 */
export function applySchema(db: Dexie): void {
  db.version(1).stores({});
}
