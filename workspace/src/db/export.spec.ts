import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { clearAll, exportAll, importAll } from './export';

// This test exercises export.ts against a fresh in-memory Dexie
// database (via fake-indexeddb) that mirrors the zero-table shape
// src/db/schema.ts starts with. Once a module's schema layer adds a
// real table, add a table-specific round-trip test alongside it — this
// file's job is only to prove the export/import/clear machinery itself
// works, not any particular table's data.

describe('exportAll / importAll / clearAll', () => {
  beforeEach(async () => {
    const { db } = await import('./database');
    await db.open();
  });

  it('exports a versioned payload with zero tables', async () => {
    const payload = await exportAll();

    expect(payload.version).toBe(1);
    expect(payload.app).toBe('app');
    expect(typeof payload.exportedAt).toBe('string');
    expect(payload.data).toEqual({});
  });

  it('rejects an import payload that fails schema validation', async () => {
    const result = await importAll({ not: 'a valid payload' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
    }
  });

  it('rejects an import payload referencing an unknown table', async () => {
    const result = await importAll({
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'app',
      data: { nonexistentTable: [{ id: '1' }] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
    }
  });

  it('accepts a well-formed empty payload', async () => {
    const result = await importAll({
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'app',
      data: {},
    });

    expect(result.ok).toBe(true);
  });

  it('clearAll requires the exact confirmation token', async () => {
    // @ts-expect-error deliberately wrong token to prove the guard
    await expect(clearAll('nope')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('clearAll succeeds with the correct confirmation token', async () => {
    await expect(clearAll('yes-delete-everything')).resolves.toBeUndefined();
  });
});

describe('Dexie is reachable in the test environment', () => {
  it('can open a throwaway database via fake-indexeddb', async () => {
    const testDb = new Dexie('throwaway');
    testDb.version(1).stores({ items: '++id' });
    await testDb.open();
    expect(testDb.isOpen()).toBe(true);
    testDb.close();
  });
});
