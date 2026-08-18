import { formatFiles } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { assertUsableName, moduleNames } from '../naming.ts';
import type { ModuleNames } from '../naming.ts';
import { existingTableNames, registerTableInSchema, writeTableFile } from '../db-tables.ts';

interface EntityGeneratorOptions {
  name: string;
  feature?: string;
  remote?: boolean;
}

/**
 * One entity within an existing (or standalone) feature — issue #172
 * §7/§12. Narrower than `feature`: no hook, no component, no barrel
 * export; just the data layer plus a test fixture factory. `--remote`
 * swaps the Dexie table + repository for a Supabase-backed repository
 * and a migration stub, keeping the same five-method interface so a
 * hook or component cannot tell which backs it.
 */
export default async function entityGenerator(tree: Tree, options: EntityGeneratorOptions) {
  const entityNames = moduleNames(options.name);
  assertUsableName(options.name, existingTableNames(tree));

  const featureModule = options.feature ? moduleNames(options.feature).module : entityNames.module;
  const dir = `src/features/${featureModule}/data`;

  if (tree.exists(`${dir}/${entityNames.module}.schema.ts`)) {
    throw new Error(`${dir}/${entityNames.module}.schema.ts already exists.`);
  }

  tree.write(`${dir}/${entityNames.module}.schema.ts`, schemaFile(entityNames));
  tree.write(`${dir}/${entityNames.module}.fixture.ts`, fixtureFile(entityNames));

  if (options.remote) {
    writeSupabaseMigration(tree, entityNames);
    tree.write(`${dir}/${entityNames.module}.repository.ts`, supabaseRepositoryFile(entityNames));
    tree.write(`${dir}/${entityNames.module}.repository.spec.ts`, supabaseRepositorySpecFile(entityNames));
    tree.write(`${dir}/${entityNames.module}.README.md`, remoteReadmeFile(entityNames));
  } else {
    writeTableFile(tree, entityNames.module, entityNames.camel);
    registerTableInSchema(tree, entityNames.module);
    tree.write(`${dir}/${entityNames.module}.repository.ts`, dexieRepositoryFile(entityNames));
    tree.write(`${dir}/${entityNames.module}.repository.spec.ts`, dexieRepositorySpecFile(entityNames));
  }

  await formatFiles(tree);
}

function schemaFile(names: ModuleNames): string {
  const { entityPascal } = names;

  return `import { z } from 'zod';

/**
 * Minimal skeleton for the "${names.entityCamel}" entity — id plus the
 * Syncable fields every table carries (issue #172 §9). Extend this with
 * the entity's real domain fields.
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

/** `create<Name>Fixture(overrides?)` — a valid entity for tests, per issue #172 §7. */
function fixtureFile(names: ModuleNames): string {
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

function dexieRepositoryFile(names: ModuleNames): string {
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
 * no-restricted-imports guardrail.
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
    // Client-generated, collision-free string id (see ${camel}.table.ts) —
    // sync-ready without relying on an auto-increment key. realmId/owner
    // are assigned here, not supplied by the caller — once sync is on,
    // this is where the active realm and authenticated user id belong.
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

function dexieRepositorySpecFile(names: ModuleNames): string {
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

/**
 * `@supabase/supabase-js` is NOT a dependency of this workspace by
 * default (issue #172 §12 — "not on by default"). This file imports it
 * by name; a project bringing a `--remote` entity into scope needs the
 * bootstrap skill (or the invoking agent) to add
 * `@supabase/supabase-js` as a real dependency before this file
 * typechecks. See the generated `${names.module}.README.md` alongside it.
 */
function supabaseRepositoryFile(names: ModuleNames): string {
  const { entityPascal, entityCamel, module } = names;

  return `import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isAppError, networkError, validationError } from '@/db/errors';
import {
  ${entityPascal}Schema,
  type ${entityPascal},
  type Create${entityPascal},
  type Update${entityPascal},
} from './${module}.schema';

// @supabase/supabase-js is not installed by default (issue #172 §12) — the
// bootstrap skill or the invoking agent adds it as a real dependency once
// this entity is in scope. See ${module}.README.md alongside this file.

let client: SupabaseClient | undefined;

/** Initialized once, imported only by this entity's repository — the same isolation src/db/database.ts gets for Dexie. */
function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw networkError('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.');
    }
    client = createClient(url, anonKey);
  }
  return client;
}

/**
 * Server-authoritative "${entityCamel}" — same five-method interface as a
 * Dexie repository (issue #172 §12), so a hook or component cannot tell
 * which backs it. Reads/inserts flow through RLS-guarded table access;
 * a write that must be arbitrated server-side belongs in an Edge
 * Function called from here instead of a direct \`.insert()\`/\`.update()\`.
 */
export const Supabase${entityPascal}Repository = {
  async list(): Promise<${entityPascal}[]> {
    const { data, error } = await supabase().from('${names.module}').select('*');
    if (error) throw networkError(\`Failed to list ${names.module}.\`, error);

    const parsed = ${entityPascal}Schema.array().safeParse(data);
    if (!parsed.success) throw validationError('${entityPascal} list failed schema validation.', parsed.error);
    return parsed.data;
  },

  async get(id: string): Promise<${entityPascal} | undefined> {
    const { data, error } = await supabase().from('${names.module}').select('*').eq('id', id).maybeSingle();
    if (error) throw networkError(\`Failed to load ${entityCamel} \${id}.\`, error);
    if (!data) return undefined;

    const parsed = ${entityPascal}Schema.safeParse(data);
    if (!parsed.success) throw validationError(\`${entityPascal} \${id} failed schema validation.\`, parsed.error);
    return parsed.data;
  },

  async create(input: Create${entityPascal}): Promise<${entityPascal}> {
    try {
      const { data, error } = await supabase().from('${names.module}').insert(input).select().single();
      if (error) throw networkError('Failed to create ${entityCamel}.', error);

      const parsed = ${entityPascal}Schema.safeParse(data);
      if (!parsed.success) throw validationError('Created ${entityCamel} failed schema validation.', parsed.error);
      return parsed.data;
    } catch (cause) {
      if (isAppError(cause)) throw cause;
      throw networkError('Failed to create ${entityCamel}.', cause);
    }
  },

  async update(id: string, input: Update${entityPascal}): Promise<${entityPascal}> {
    try {
      const { data, error } = await supabase().from('${names.module}').update(input).eq('id', id).select().single();
      if (error) throw networkError(\`Failed to update ${entityCamel} \${id}.\`, error);

      const parsed = ${entityPascal}Schema.safeParse(data);
      if (!parsed.success) throw validationError(\`Updated ${entityCamel} \${id} failed schema validation.\`, parsed.error);
      return parsed.data;
    } catch (cause) {
      if (isAppError(cause)) throw cause;
      throw networkError(\`Failed to update ${entityCamel} \${id}.\`, cause);
    }
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase().from('${names.module}').delete().eq('id', id);
    if (error) throw networkError(\`Failed to delete ${entityCamel} \${id}.\`, error);
  },
};
`;
}

function supabaseRepositorySpecFile(names: ModuleNames): string {
  const { entityPascal, module } = names;

  return `import { describe, expect, it } from 'vitest';

/**
 * @supabase/supabase-js is not a dependency of this workspace by default
 * (issue #172 §12). This spec is a placeholder proving the module's shape
 * until the dependency is added and a real Supabase test double (or a
 * local Supabase instance) is wired in — replace with real
 * request/response assertions once that lands.
 */
describe('Supabase${entityPascal}Repository', () => {
  it.todo('lists ${module} through the RLS-guarded table');
  it.todo('creates a ${entityPascal} and validates the response against the schema');
  it.todo('updates a ${entityPascal} and validates the response against the schema');
  it.todo('deletes a ${entityPascal}');

  it('is a placeholder pending @supabase/supabase-js as a real dependency', () => {
    expect(true).toBe(true);
  });
});
`;
}

function remoteReadmeFile(names: ModuleNames): string {
  const { entityPascal, module } = names;

  return `# ${entityPascal} (remote entity)

Generated with \`--remote\` (issue #172 §12). \`${module}.repository.ts\`
implements \`Supabase${entityPascal}Repository\` against
\`@supabase/supabase-js\`, which is **not yet a dependency of this
workspace** — add it before this file will typecheck or run:

\`\`\`bash
pnpm add @supabase/supabase-js
\`\`\`

Also set \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`
in the environment. The migration stub is at
\`supabase/migrations/<timestamp>_${module}.sql\` — fill in the real
columns and RLS policies before applying it, and set \`realm_id\`'s
default to this project's actual realm-assignment rule; the client never
supplies \`id\`, \`realmId\`, \`owner\`, or the timestamps, so every one of
them needs a server-side default or an Edge Function to assign it.

The bootstrap skill wires \`@supabase/supabase-js\` in only when a
project actually has a remote entity in scope, matching the "not on by
default" rule every optional dependency in this core follows (Dexie
Cloud, wallet providers, and this one alike).
`;
}

function writeSupabaseMigration(tree: Tree, names: ModuleNames) {
  const timestamp = '00000000000000';
  const path = `supabase/migrations/${timestamp}_${names.module}.sql`;

  tree.write(
    path,
    `-- Migration stub for the server-authoritative "${names.module}" entity
-- (issue #172 §12). Rename this file's timestamp prefix to the actual
-- generation time before applying it with \`supabase db push\`.

-- id, realm_id, owner, and both timestamps are server-assigned — the
-- client's Create${entityPascal}Schema never supplies them, matching the
-- Dexie repository's own id/timestamp assignment. owner defaults to the
-- authenticated caller; set realm_id's default to this project's actual
-- realm-assignment rule before applying (a fixed realm, a claim off the
-- JWT, or a value an Edge Function assigns).
create table if not exists ${names.module} (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null,
  owner text not null default (auth.uid()::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- add this entity's real domain columns here
);

alter table ${names.module} enable row level security;

-- Replace with the project's real access rule. A common starting point:
-- a row is only visible to (and writable by) its own owner.
-- create policy "${names.module}_select_own" on ${names.module}
--   for select using (auth.uid()::text = owner);
-- create policy "${names.module}_insert_own" on ${names.module}
--   for insert with check (auth.uid()::text = owner);

-- Any write that must be arbitrated server-side (crediting a ledger from
-- a verified external event, for example) belongs behind an Edge
-- Function, not a client-writable RLS policy — add that function and
-- narrow the insert/update policies above once the client-writable
-- surface for this entity is known.
`,
  );
}
