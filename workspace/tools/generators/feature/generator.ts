import { formatFiles } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { assertUsableName, moduleNames } from '../naming.ts';
import type { ModuleNames } from '../naming.ts';
import { existingTableNames, registerTableInSchema, writeTableFile } from '../db-tables.ts';

interface FeatureGeneratorOptions {
  name: string;
}

/**
 * The full vertical slice for one new domain module (issue #172 §7,
 * core.yaml's schema -> repository -> hook -> screen layers in one
 * shot): Zod schema, Dexie table registration, repository, repository
 * test, TanStack Query hook, a minimal component shell, and the
 * feature's public barrel — plus the src/db/schema.ts append that wires
 * the new table into the version chain.
 */
export default async function featureGenerator(tree: Tree, options: FeatureGeneratorOptions) {
  assertUsableName(options.name, existingTableNames(tree));
  const names = moduleNames(options.name);
  const dir = `src/features/${names.module}`;

  if (tree.exists(dir)) {
    throw new Error(`src/features/${names.module} already exists. Use the "entity" generator to add another entity to it.`);
  }

  writeTableFile(tree, names.module, names.camel);
  registerTableInSchema(tree, names.module);

  tree.write(`${dir}/data/${names.module}.schema.ts`, schemaFile(names));
  tree.write(`${dir}/data/${names.module}.repository.ts`, repositoryFile(names));
  tree.write(`${dir}/data/${names.module}.repository.spec.ts`, repositorySpecFile(names));
  tree.write(`${dir}/hooks/use-${names.module}.ts`, hookFile(names));
  tree.write(`${dir}/components/${names.entityPascal}List.tsx`, componentFile(names));
  tree.write(`${dir}/index.ts`, barrelFile(names));

  await formatFiles(tree);
}

function schemaFile(names: ModuleNames): string {
  const { entityPascal } = names;

  return `import { z } from 'zod';

/**
 * Minimal skeleton for the "${names.module}" entity — id plus the
 * Syncable fields every table carries (issue #172 §9). Extend this with
 * the module's real domain fields; the generator's job stops at a
 * valid, typechecking shape.
 */
export const ${entityPascal}Schema = z.object({
  id: z.string(),
  realmId: z.string(),
  owner: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ${entityPascal} = z.infer<typeof ${entityPascal}Schema>;

/** Fields the caller supplies; id and timestamps are assigned by the repository. */
export const Create${entityPascal}Schema = ${entityPascal}Schema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Create${entityPascal} = z.infer<typeof Create${entityPascal}Schema>;

export const Update${entityPascal}Schema = Create${entityPascal}Schema.partial();

export type Update${entityPascal} = z.infer<typeof Update${entityPascal}Schema>;
`;
}

function repositoryFile(names: ModuleNames): string {
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

/** Typed handle onto this module's Dexie table. */
function table() {
  return db.table<${entityPascal}, string>('${camel}');
}

/**
 * The only file (besides its own test) allowed to import src/db/**
 * from this feature — enforced by eslint.config.mjs's no-restricted-imports
 * guardrail. Every method throws/rejects an AppError (src/db/errors.ts)
 * rather than a bare Error, so a hook can branch on \`kind\`.
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
    // Client-generated, collision-free string id — the shape Dexie Cloud's
    // own sharded keys require, set before the write rather than assigned
    // by an auto-increment Dexie can't hand off to sync later (issue #172 §9).
    const candidate = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await table().add(candidate);
      const parsed = ${entityPascal}Schema.safeParse(candidate);
      if (!parsed.success) {
        throw validationError(
          \`Created ${entityCamel} failed schema validation.\`,
          parsed.error,
        );
      }
      return parsed.data;
    } catch (cause) {
      if (isAppError(cause)) throw cause;
      throw persistenceError('Failed to create ${entityCamel}.', cause);
    }
  },

  /** Writes only the changed fields plus updatedAt — never a full read-modify-write (issue #172 §9's conflict-semantics rule). */
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
        throw validationError(
          \`Updated ${entityCamel} failed schema validation.\`,
          parsed.error,
        );
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

function repositorySpecFile(names: ModuleNames): string {
  const { entityPascal, camel, entityCamel, module } = names;

  return `import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the five repository methods against a real in-memory IndexedDB
 * (fake-indexeddb), not a mock — the same table registration
 * src/db/schema.ts's applySchema derives from src/db/tables/${module}.table.ts,
 * reconstructed here on a throwaway database so this test does not
 * depend on load order against the app's shared db instance.
 */
describe('${entityPascal}Repository', () => {
  let repository: typeof import('./${module}.repository').${entityPascal}Repository;

  beforeEach(async () => {
    const dbModule = await import('@/db/database');
    await dbModule.db.table('${camel}').clear();
    ({ ${entityPascal}Repository: repository } = await import('./${module}.repository'));
  });

  const input = { realmId: 'local', owner: 'local-user' };

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

    const updated = await repository.update(created.id, { owner: 'new-owner' });
    expect(updated.owner).toBe('new-owner');
    expect(updated.realmId).toBe('local');
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

function hookFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ${entityPascal}Repository } from '../data/${module}.repository';
import type { Create${entityPascal}, Update${entityPascal} } from '../data/${module}.schema';

const ${names.camel}Keys = {
  all: () => ['${module}'] as const,
  detail: (id: string) => ['${module}', 'detail', id] as const,
};

/** The list query every ${module} component reads from. */
export function use${pascal}() {
  return useQuery({
    queryKey: ${names.camel}Keys.all(),
    queryFn: () => ${entityPascal}Repository.list(),
  });
}

/** Named ById rather than use${entityPascal} — a plural-less module name (e.g. "smoketest") would otherwise collide with the list hook above. */
export function use${entityPascal}ById(id: string) {
  return useQuery({
    queryKey: ${names.camel}Keys.detail(id),
    queryFn: () => ${entityPascal}Repository.get(id),
    enabled: id.length > 0,
  });
}

export function useCreate${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Create${entityPascal}) => ${entityPascal}Repository.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}

export function useUpdate${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: Update${entityPascal} & { id: string }) =>
      ${entityPascal}Repository.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}

export function useDelete${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ${entityPascal}Repository.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}
`;
}

function componentFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `'use client';

import { use${pascal} } from '../hooks/use-${module}';

/**
 * Minimal shell proving the hook layer is wired end to end. Replace with
 * the module's real presentation once the domain shape is filled in.
 */
export function ${entityPascal}List() {
  const { data, isLoading, isError } = use${pascal}();

  if (isLoading) return <p>Loading ${module}...</p>;
  if (isError) return <p>Could not load ${module}.</p>;
  if (!data || data.length === 0) return <p>No ${module} yet.</p>;

  return (
    <ul>
      {data.map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  );
}
`;
}

function barrelFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `/**
 * This feature's only valid cross-feature import path
 * (\`@/features/${module}\`) — the eslint no-deep-import guardrail rejects
 * anything reaching past this file into data/, hooks/, or components/
 * directly. The repository and schema are deliberately NOT re-exported
 * here; they are data/-only.
 */
export { use${pascal}, use${entityPascal}ById, useCreate${entityPascal}, useUpdate${entityPascal}, useDelete${entityPascal} } from './hooks/use-${module}';
export { ${entityPascal}List } from './components/${entityPascal}List';
`;
}
