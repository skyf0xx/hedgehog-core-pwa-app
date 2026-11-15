import { formatFiles } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { assertUsableName, moduleNames } from '../naming.ts';
import type { ModuleNames } from '../naming.ts';
import { existingTableNames, registerTableInSchema, writeTableFile } from '../db-tables.ts';
import {
  dexieRepositoryFile,
  dexieRepositorySpecFile,
  fixtureFile,
  schemaFile,
  schemaSpecFile,
} from '../templates.ts';

interface EntityGeneratorOptions {
  name: string;
  feature?: string;
  remote?: boolean;
  layer?: 'schema' | 'repository';
}

/**
 * One entity's data layer: no hook, no component, no barrel export
 * (`feature --layer=hook|screen` lands those). `--remote` swaps the
 * Dexie table and repository for a Supabase-backed repository and a
 * migration stub, keeping the same `{Entity}Repository` export and
 * five-method interface so a hook or component cannot tell which backs
 * it.
 *
 * `--layer` restricts output to one core.yaml layer's scope: `schema`
 * emits the Zod schema and its spec plus the table file and the
 * `src/db/schema.ts` append (or, with `--remote`, the migration);
 * `repository` emits the fixture and the repository files.
 */
export default async function entityGenerator(tree: Tree, options: EntityGeneratorOptions) {
  const entityNames = moduleNames(options.name);
  const featureModule = options.feature ? moduleNames(options.feature).module : entityNames.module;
  const dir = `src/features/${featureModule}/data`;
  const schemaPath = `${dir}/${entityNames.module}.schema.ts`;

  const writeSchema = options.layer === undefined || options.layer === 'schema';
  const writeRepository = options.layer === undefined || options.layer === 'repository';

  if (writeSchema) {
    assertUsableName(options.name, existingTableNames(tree));
    if (tree.exists(schemaPath)) {
      throw new Error(`${schemaPath} already exists.`);
    }
    tree.write(schemaPath, schemaFile(entityNames));
    tree.write(`${dir}/${entityNames.module}.schema.spec.ts`, schemaSpecFile(entityNames));
    if (options.remote) {
      writeSupabaseMigration(tree, entityNames);
    } else {
      writeTableFile(tree, entityNames.module, entityNames.camel);
      registerTableInSchema(tree, entityNames.module);
    }
  }

  if (writeRepository) {
    if (!tree.exists(schemaPath)) {
      throw new Error(
        `${schemaPath} does not exist — run this generator with --layer=schema (or without --layer) first.`,
      );
    }
    tree.write(`${dir}/${entityNames.module}.fixture.ts`, fixtureFile(entityNames));

    if (options.remote) {
      tree.write(`${dir}/${entityNames.module}.repository.ts`, supabaseRepositoryFile(entityNames));
      tree.write(`${dir}/${entityNames.module}.repository.spec.ts`, supabaseRepositorySpecFile(entityNames));
      tree.write(`${dir}/${entityNames.module}.README.md`, remoteReadmeFile(entityNames));
    } else {
      tree.write(`${dir}/${entityNames.module}.repository.ts`, dexieRepositoryFile(entityNames));
      tree.write(`${dir}/${entityNames.module}.repository.spec.ts`, dexieRepositorySpecFile(entityNames));
    }
  }

  await formatFiles(tree);
}

/**
 * Imports `@supabase/supabase-js`, which the workspace carries only once
 * the bootstrap skill's remote-entities branch has added it; until then
 * this file does not typecheck. See the generated
 * `${names.module}.README.md` alongside it.
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

// @supabase/supabase-js is added by the bootstrap skill's remote-entities
// branch. See ${module}.README.md alongside this file.

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
 * Dexie repository, under the same export name, so a hook or component cannot tell
 * which backs it. Reads/inserts flow through RLS-guarded table access;
 * a write that must be arbitrated server-side belongs in an Edge
 * Function called from here instead of a direct \`.insert()\`/\`.update()\`.
 */
export const ${entityPascal}Repository = {
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
 * A placeholder until a Supabase test double (or a local Supabase
 * instance) is wired in: replace the todos with real request/response
 * assertions then.
 */
describe('${entityPascal}Repository (Supabase)', () => {
  it.todo('lists ${module} through the RLS-guarded table');
  it.todo('creates a ${entityPascal} and validates the response against the schema');
  it.todo('updates a ${entityPascal} and validates the response against the schema');
  it.todo('deletes a ${entityPascal}');

  it('is a placeholder pending a Supabase test double', () => {
    expect(true).toBe(true);
  });
});
`;
}

function remoteReadmeFile(names: ModuleNames): string {
  const { entityPascal, module } = names;

  return `# ${entityPascal} (remote entity)

Generated with \`--remote\`. \`${module}.repository.ts\` implements
\`${entityPascal}Repository\` against \`@supabase/supabase-js\`, which
the workspace carries only once the bootstrap skill's remote-entities
branch has run. Without it, add it before this file will typecheck or run:

\`\`\`bash
pnpm add @supabase/supabase-js
\`\`\`

Also set \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`
in the environment. The migration stub, landed with this
module's \`schema\` layer, is at
\`supabase/migrations/<timestamp>_${module}.sql\` — fill in the real
columns and RLS policies before applying it, and set \`realm_id\`'s
default to this project's actual realm-assignment rule; the client never
supplies \`id\`, \`realmId\`, \`owner\`, or the timestamps, so every one of
them needs a server-side default or an Edge Function to assign it.
`;
}

function writeSupabaseMigration(tree: Tree, names: ModuleNames) {
  const { entityPascal } = names;
  const timestamp = '00000000000000';
  const path = `supabase/migrations/${timestamp}_${names.module}.sql`;

  tree.write(
    path,
    `-- Migration stub for the server-authoritative "${names.module}" entity.
-- Rename this file's timestamp prefix to the actual
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
