# Scaffolding a layer

This core's five-layer sequence — `schema`, `repository`, `hook`,
`screen`, `join` — is compiled from `workspace/core.yaml` into every
project's build graph; `hedgehog-loop`'s "Domain Module — Steps" table
names where each layer lives and what it commits. This file covers what
scaffolds each layer and the flag contract behind it.

`tools/generators/` holds the three Nx generators this core ships (§7):
`feature`, `entity`, `integration` — invoked directly as Nx generators,
not through a `hedgehog` verb (`hedgehog` is the build-graph CLI and
gains no generator commands of its own):

```bash
pnpm generate @hedgehog/pwa:feature <name>
pnpm generate @hedgehog/pwa:entity <Name> [--feature=<name>] [--remote] [--layer=schema|repository]
pnpm generate @hedgehog/pwa:integration <name> [--kind=wallet]
```

- **`feature`** lands the full vertical slice for a new module in one
  step: the Zod schema, the repository plus its `fake-indexeddb` test,
  the hook, a component shell, the module's `index.ts` barrel, the Dexie
  table registration file, and Nx tags. Use it for a module's `schema`
  layer when nothing for that module exists yet.
- **`entity`** lands one entity inside an existing or new feature: the
  Zod schema and its inferred type, a repository with the standard five
  methods, a repository test against `fake-indexeddb`, a test fixture
  factory, and the table registration file. Refuses ambiguous or
  reserved names. `--remote` emits a `SupabaseXRepository` and a
  `supabase/migrations/{module}.sql` migration (table + RLS policies)
  instead of the Dexie path — the generator asks which methods are
  client-writable under RLS and which require an Edge Function stub.
  Nothing else in the output differs: same barrel, same hook shape, same
  component shell, whether local or remote. **Pass `--layer` to match
  the claimed task**: `--layer=schema` on the entity's `SCHEMA` task
  (emits only `{module}.schema.ts`, the table file, and the
  `src/db/schema.ts` append — core.yaml's `schema` scope) and
  `--layer=repository` on its `REPOSITORY` task, once `SCHEMA` is
  verified and committed (emits the fixture and repository files —
  everything else `data/**` allows). Omitting `--layer` emits both in
  one run; against a claimed `SCHEMA` task that leaves repository-layer
  files sitting untracked outside its ALLOWED SCOPE, which
  `hedgehog verify` then rejects.
- **`integration`** lands an external API or wallet adapter: client, Zod
  response schema, adapter, adapter test, barrel — wired through the
  public-env-variable helper, never a raw `process.env` read in client
  code. `--kind=wallet` emits the `AuthProvider`/`WalletProvider` adapter
  pair (§11) instead of the plain client/schema/adapter shape, defaulting
  to provider-native auth (Privy, Dynamic, or similar) unless intake
  named an existing identity provider to chain wallet capability onto
  instead.

Every generator produces a working, typechecked, passing slice. A
generator that emits an empty file is a bug — report it rather than
hand-filling the gap; `tools/generators/` is out of scope for a build
session to patch (that's this core package's own maintenance, not a
project build).

What the generator lands is the layer's skeleton, not the layer. Author
the entity-specific delta on top: the module's field list, types, and
validation rules in `schema`; its mutation and transaction rules in
`repository`; loading/error/success shape in `hook`; and — for
`screen`, which is skeleton-only by design — the layout, information
hierarchy, and interaction pattern (`pwa-eng`'s "UX judgment" section)
over the placeholders the generator leaves for the list, filter shell,
empty state, and form.

**A new feature directory needs no separate workspace-wiring step the
way a new Nx package does in a multi-project workspace.** This core
ships as a single Next.js app with no Nx libs (per `workspace/`'s
layout) — a module's files land directly under `src/features/{module}/`
and `src/app/{module}/`, both already inside the app's own compilation
unit, so there is no `pnpm install`/`pnpm nx sync` step and no "first
arrival in a package" widening to reason about. The one shared file
every module's `schema` layer touches is `src/db/schema.ts` — see
`hedgehog-loop`'s "The `src/db/schema.ts` barrel and migration ordering"
section for how that append-only barrel and its version chain work.
