# Scaffolding a layer

This core's five-layer sequence — `schema`, `repository`, `hook`,
`screen`, `join` — is compiled from the root `core.yaml` into every
project's build graph; `hedgehog core show` prints each layer's scope,
verify command, and commit. This file covers what scaffolds each layer
and the flag contract behind it.

`tools/generators/` holds the three Nx generators this core ships:
`feature`, `entity`, `integration`. They run as Nx generators, not
through a `hedgehog` verb (`hedgehog` is the build-graph CLI and has no
generator commands):

```bash
pnpm generate @hedgehog/pwa:feature <module> [--layer=schema|repository|hook|screen]
pnpm generate @hedgehog/pwa:entity <module> [--remote] [--layer=schema|repository] [--feature=<name>]
pnpm generate @hedgehog/pwa:integration <name> [--kind=wallet]
```

`<module>` is the module name from the claimed packet, in plural
kebab-case (`todos`, `order-items`); every file the generator writes is
named after it.

**Pass `--layer` to match the claimed task.** Each `--layer` run writes
only the files that layer's ALLOWED SCOPE covers, including the spec
that layer's verify command runs, so generator output passes `hedgehog
verify` before any authored change. A later layer refuses to run until
the layer before it has landed. Running without `--layer` writes several
layers at once; against a claimed task that leaves files outside its
ALLOWED SCOPE, which `hedgehog verify` rejects.

| Layer | Local (Dexie) module | `--remote` (Supabase) module | Files |
|---|---|---|---|
| `schema` | `feature <module> --layer=schema` | `entity <module> --remote --layer=schema` | `data/{module}.schema.ts` and `.schema.spec.ts`; local: `src/db/tables/{module}.table.ts` and the `src/db/schema.ts` append; remote: `supabase/migrations/00000000000000_{module}.sql` |
| `repository` | `feature <module> --layer=repository` | `entity <module> --remote --layer=repository` | `data/{module}.fixture.ts`, `.repository.ts`, `.repository.spec.ts`; remote also `data/{module}.README.md` |
| `hook` | `feature <module> --layer=hook` | same | `hooks/use-{module}.ts` and `.spec.tsx` |
| `screen` | `feature <module> --layer=screen` | same | `components/{Entity}List.tsx` and `.spec.tsx`, `index.ts` |
| `join` | none | none | no files of its own |

Paths are under `src/features/{module}/` unless shown in full.

- **`feature`** lands one module's vertical slice. `--layer=schema` and
  `--layer=repository` emit the same files as `entity --layer` for a
  local module. Without `--layer` it lands the whole slice for a module
  that does not exist yet.
- **`entity`** lands one entity's data layer: the Zod schema and its
  spec, the Dexie table registration, a test fixture factory, and a
  repository with the standard five methods plus its `fake-indexeddb`
  test. It refuses reserved names and names whose table already exists.
  `--remote` replaces the table registration with a Supabase migration
  stub (table, `realm_id`/`owner` defaults, RLS enabled, example own-row
  policies commented out) and the Dexie repository with a Supabase-backed
  one. Both export `{Entity}Repository` with the same five methods, so
  `feature --layer=hook|screen` builds on either. The remote repository
  spec is a placeholder (`it.todo` cases) until the project wires a
  Supabase test double. `--feature=<name>` puts the files under another
  module's directory instead of their own.
- **`integration`** lands an external API or wallet adapter: client, Zod
  response schema, adapter, adapter test, a typed integration error, and
  a barrel, under `src/integrations/<name>/`. `--kind=wallet` emits the `AuthProvider`/`WalletProvider` stub
  pair instead of the plain client/schema/adapter shape. The generator
  picks no provider; the invoking agent wires one (provider-native auth
  such as Privy or Dynamic unless intake named an existing identity
  provider to chain wallet capability onto).

A generator that fails, or whose output fails its layer's verify
command, is a bug — report it rather than hand-filling the gap;
`tools/generators/` is out of scope for a build session to patch (that's
this core package's own maintenance, not a project build).

What the generator lands is the layer's skeleton, not the layer. Author
the entity-specific delta on top, and extend the generated spec to
cover it: the module's field list, types, and validation rules in
`schema` (update the spec's sample record and the fixture when fields
are added); its mutation and transaction rules in `repository`; the
hooks a screen needs in `hook`; and, for `screen`, the layout,
information hierarchy, interaction pattern, and any `src/app/{module}/`
route (`pwa-eng`'s "UX judgment" section) on top of the generated list
component. A `--remote` module's RLS policies and any Edge Function are
authored too: no generator emits them.

**A new feature directory needs no workspace-wiring step.** This core
ships as a single Next.js app with no Nx libs: a module's files land
directly under `src/features/{module}/` and `src/app/{module}/`, both
already inside the app's own compilation unit, so there is no `pnpm
install`/`pnpm nx sync` step. The one shared file every module's
`schema` layer touches is `src/db/schema.ts` — see `hedgehog-loop`'s
"The `src/db/schema.ts` barrel and migration ordering" section.
