import type { ModuleNames } from './naming.ts';

/**
 * File templates shared by the `feature` and `entity` generators, so a
 * module's `schema` and `repository` layers come out identical whichever
 * generator lands them.
 */

export function schemaFile(names: ModuleNames): string {
  const { entityPascal } = names;

  return `import { z } from 'zod';

/**
 * Minimal skeleton for the "${names.entityCamel}" entity: id plus the
 * Syncable fields every table carries. Extend this with the entity's real
 * domain fields.
 *
 * \`id\`, \`realmId\`, \`owner\`, and both timestamps are repository-assigned,
 * never supplied by a caller — see \`Create${entityPascal}Schema\` below.
 */
export const ${entityPascal}Schema = z.object({
  id: z.string(),
  realmId: z.string(),
  owner: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ${entityPascal} = z.infer<typeof ${entityPascal}Schema>;

export const Create${entityPascal}Schema = ${entityPascal}Schema.omit({
  id: true,
  realmId: true,
  owner: true,
  createdAt: true,
  updatedAt: true,
});

export type Create${entityPascal} = z.infer<typeof Create${entityPascal}Schema>;

export const Update${entityPascal}Schema = Create${entityPascal}Schema.partial();

export type Update${entityPascal} = z.infer<typeof Update${entityPascal}Schema>;
`;
}

export function schemaSpecFile(names: ModuleNames): string {
  const { entityPascal, entityCamel, module } = names;

  return `import { describe, expect, it } from 'vitest';
import {
  ${entityPascal}Schema,
  Create${entityPascal}Schema,
  Update${entityPascal}Schema,
} from './${module}.schema';

const repositoryAssigned = ['id', 'realmId', 'owner', 'createdAt', 'updatedAt'];

const record = {
  id: '${entityCamel}-1',
  realmId: 'local',
  owner: 'local-user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('${entityPascal}Schema', () => {
  it('accepts a complete record', () => {
    expect(${entityPascal}Schema.safeParse(record).success).toBe(true);
  });

  it('rejects a record without an id', () => {
    const withoutId: Partial<typeof record> = { ...record };
    delete withoutId.id;
    expect(${entityPascal}Schema.safeParse(withoutId).success).toBe(false);
  });

  it('leaves repository-assigned fields out of the create input', () => {
    const fields = Object.keys(Create${entityPascal}Schema.shape);
    for (const field of repositoryAssigned) {
      expect(fields).not.toContain(field);
    }
  });

  it('accepts an empty update patch', () => {
    expect(Update${entityPascal}Schema.safeParse({}).success).toBe(true);
  });
});
`;
}

/** `create<Entity>Fixture(overrides?)`: a valid entity for tests. */
export function fixtureFile(names: ModuleNames): string {
  const { entityPascal, entityCamel } = names;

  return `import type { ${entityPascal} } from './${names.module}.schema';

let counter = 0;

/** Returns a valid ${entityPascal}, unique per call unless overridden. */
export function create${entityPascal}Fixture(overrides: Partial<${entityPascal}> = {}): ${entityPascal} {
  counter += 1;
  const now = new Date().toISOString();

  return {
    id: \`${entityCamel}-fixture-\${counter}\`,
    realmId: 'local',
    owner: 'local-user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
`;
}

export function dexieRepositoryFile(names: ModuleNames): string {
  const { entityPascal, camel, entityCamel } = names;

  return `import { db } from '@/db/database';
import { nowUtc } from '@/db/types';
import { isAppError, persistenceError, validationError } from '@/db/errors';
import {
  ${entityPascal}Schema,
  type ${entityPascal},
  type Create${entityPascal},
  type Update${entityPascal},
} from './${names.module}.schema';

function table() {
  return db.table<${entityPascal}, string>('${camel}');
}

/**
 * The only file (besides its own test) allowed to import src/db/**
 * for the "${entityCamel}" entity — enforced by eslint.config.mjs's
 * no-restricted-imports guardrail. Every method throws an AppError
 * (src/db/errors.ts), so a hook can branch on \`kind\`.
 */
export const ${entityPascal}Repository = {
  async list(): Promise<${entityPascal}[]> {
    try {
      return await table().toArray();
    } catch (cause) {
      throw persistenceError('Failed to list ${names.module}.', cause);
    }
  },

  async get(id: string): Promise<${entityPascal} | undefined> {
    try {
      return await table().get(id);
    } catch (cause) {
      throw persistenceError(\`Failed to load ${entityCamel} \${id}.\`, cause);
    }
  },

  async create(input: Create${entityPascal}): Promise<${entityPascal}> {
    const now = nowUtc();
    // A client-generated string id, set before the write: the key shape
    // sync needs, which an auto-increment key cannot be converted to once
    // data exists. realmId/owner are assigned here, never by the caller;
    // once sync is on, this is where the active realm and user id belong.
    const candidate = {
      ...input,
      id: crypto.randomUUID(),
      realmId: 'local',
      owner: 'local-user',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await table().add(candidate);
      const parsed = ${entityPascal}Schema.safeParse(candidate);
      if (!parsed.success) {
        throw validationError(\`Created ${entityCamel} failed schema validation.\`, parsed.error);
      }
      return parsed.data;
    } catch (cause) {
      if (isAppError(cause)) throw cause;
      throw persistenceError('Failed to create ${entityCamel}.', cause);
    }
  },

  /** Writes only the changed fields plus updatedAt, never the whole record: sync resolves conflicts per field. */
  async update(id: string, input: Update${entityPascal}): Promise<${entityPascal}> {
    try {
      const patch = { ...input, updatedAt: nowUtc() };
      const updated = await table().update(id, patch);
      if (updated === 0) {
        throw persistenceError(\`No ${entityCamel} found with id \${id}.\`);
      }
      const row = await table().get(id);
      const parsed = ${entityPascal}Schema.safeParse(row);
      if (!parsed.success) {
        throw validationError(\`Updated ${entityCamel} failed schema validation.\`, parsed.error);
      }
      return parsed.data;
    } catch (cause) {
      if (isAppError(cause)) throw cause;
      throw persistenceError(\`Failed to update ${entityCamel} \${id}.\`, cause);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await table().delete(id);
    } catch (cause) {
      throw persistenceError(\`Failed to delete ${entityCamel} \${id}.\`, cause);
    }
  },
};
`;
}

export function dexieRepositorySpecFile(names: ModuleNames): string {
  const { entityPascal, camel, entityCamel, module } = names;

  return `import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

describe('${entityPascal}Repository', () => {
  let repository: typeof import('./${module}.repository').${entityPascal}Repository;

  beforeEach(async () => {
    const dbModule = await import('@/db/database');
    await dbModule.db.table('${camel}').clear();
    ({ ${entityPascal}Repository: repository } = await import('./${module}.repository'));
  });

  const input = {};

  it('creates and lists a ${entityCamel}', async () => {
    const created = await repository.create(input);

    expect(created.id).toBeTypeOf('string');
    expect(created.realmId).toBe('local');

    const all = await repository.list();
    expect(all.map((row) => row.id)).toContain(created.id);
  });

  it('gets a ${entityCamel} by id', async () => {
    const created = await repository.create(input);

    const found = await repository.get(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('returns undefined for a missing ${entityCamel}', async () => {
    const found = await repository.get('does-not-exist');
    expect(found).toBeUndefined();
  });

  it('updates only the changed fields', async () => {
    const created = await repository.create(input);

    const updated = await repository.update(created.id, {});
    expect(updated.realmId).toBe('local');
    expect(updated.owner).toBe('local-user');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.id).toBe(created.id);
  });

  it('rejects updating a missing ${entityCamel}', async () => {
    await expect(repository.update('does-not-exist', {})).rejects.toMatchObject({
      kind: 'persistence',
    });
  });

  it('deletes a ${entityCamel}', async () => {
    const created = await repository.create(input);

    await repository.delete(created.id);

    const found = await repository.get(created.id);
    expect(found).toBeUndefined();
  });
});
`;
}
