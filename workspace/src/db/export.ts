import { z } from 'zod';
import { db } from './database';
import { nowUtc } from './types';
import { validationError, persistenceError, type AppError } from './errors';

/**
 * Data safety (issue #172 §13). A versioned full-database export/import
 * pair plus an explicit-confirmation `clearAll` — required from the
 * first commit of this workspace, not something a later feature adds.
 */

export const EXPORT_FORMAT_VERSION = 1;

const APP_NAME = 'app';

/**
 * The export payload shape. `data` maps table name to that table's rows
 * (as plain objects — Dexie rows are already JSON-serializable). Kept
 * intentionally loose (`z.record(z.string(), z.array(z.unknown()))`)
 * because this file has no per-table knowledge — each module owns its
 * own row schema in its `data/{module}.schema.ts`. Import validates
 * structure here and defers to Dexie's own schema (and any table-level
 * Zod parse a repository chooses to run) for row-level shape.
 */
const exportPayloadSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: z.string(),
  app: z.string(),
  data: z.record(z.string(), z.array(z.unknown())),
});

export type ExportPayload = z.infer<typeof exportPayloadSchema>;

/**
 * Walks every table currently registered on `db` and dumps its rows
 * into a single versioned, JSON-serializable payload.
 */
export async function exportAll(): Promise<ExportPayload> {
  const data: Record<string, unknown[]> = {};

  for (const table of db.tables) {
    data[table.name] = await table.toArray();
  }

  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: nowUtc(),
    app: APP_NAME,
    data,
  };
}

export type ImportResult = { ok: true } | { ok: false; error: AppError };

/**
 * Validates the whole payload against the current schema shape with Zod
 * before writing anything, then writes every table inside one
 * `db.transaction("rw", db.tables, ...)` so a rejected import can never
 * leave a half-overwritten database — either every table is replaced or
 * none are.
 */
export async function importAll(payload: unknown): Promise<ImportResult> {
  const parsed = exportPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false,
      error: validationError('Import payload failed schema validation.', parsed.error),
    };
  }

  const { data } = parsed.data;
  const knownTableNames = new Set(db.tables.map((t) => t.name));

  for (const tableName of Object.keys(data)) {
    if (!knownTableNames.has(tableName)) {
      return {
        ok: false,
        error: validationError(
          `Import payload references unknown table "${tableName}" — it does not exist in the current schema.`,
        ),
      };
    }
  }

  // IndexedDB forbids a transaction with an empty scope (thrown as
  // InvalidAccessError) — relevant while this workspace has zero
  // modules and db.tables is []. Once the first module's schema layer
  // adds a table, this branch stops being reachable in practice.
  if (db.tables.length === 0) {
    return { ok: true };
  }

  try {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        await table.clear();
        const rows = data[table.name];
        if (rows && rows.length > 0) {
          await table.bulkAdd(rows);
        }
      }
    });
  } catch (cause) {
    return {
      ok: false,
      error: persistenceError('Import transaction failed; database was left unchanged.', cause),
    };
  }

  return { ok: true };
}

/**
 * Deletes every row in every table. Requires an explicit confirmation
 * token so this can never be called by accident from a stray code path
 * — this is a code-level guard, not a UI concern (a UI still needs its
 * own "are you sure" affordance on top of this).
 */
export async function clearAll(confirm: 'yes-delete-everything'): Promise<void> {
  if (confirm !== 'yes-delete-everything') {
    throw validationError(
      'clearAll requires the literal confirmation token "yes-delete-everything".',
    );
  }

  // See the matching guard in importAll: IndexedDB forbids a
  // transaction with an empty scope, which db.tables is until the
  // first module's schema layer adds a table.
  if (db.tables.length === 0) {
    return;
  }

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
}
