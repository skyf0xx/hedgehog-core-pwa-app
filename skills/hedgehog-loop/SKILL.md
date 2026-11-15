---
name: hedgehog-loop
description: Use for every unit of work once a Hedgehog project on the pwa-app core is bootstrapped — building one layer (schema, repository, hook, screen, join) per module, gated by `hedgehog verify` and committed one layer at a time. Triggers on "next step", "build this module", "what's next", or the start of any work session on a bootstrapped project. Supplies the pwa-app specifics `hedgehog-orchestrating`'s build loop runs with.
---

# Hedgehog Loop — pwa-app

`hedgehog-orchestrating` owns the build loop: the claim/dispatch/verify
cycle, debt and decisions, the intent check, the test-depth and review
rule, the Friction log, the Correction Protocol and its Post-build
entry, the Stop Condition, and the graph exits. This skill supplies what
is specific to the pwa-app core: the layer table, who builds each layer,
the conventions inside a layer, and the review checklist.
`hedgehog core show` prints the compiled layers (scope, verify, commit);
the root `core.yaml` is their source.

## The Domain Module Pattern

Root CLAUDE.md's Core rules own "one entity = one domain module" and
"FK-by-ID only" — this section is their mechanics. `todos`, `notes`,
`expenses` are each their own module, carrying the full step sequence
below. The Zod schema is the source of truth for module boundaries.

If a `todos` record references a `projects` record, `todos`' schema
holds a plain id field — the `todos` repository and hook depend only on
their own module.

- Need the related row? Resolve it at the hook layer (a second query
  against the other module's own repository, composed in the consuming
  hook or screen), or join against the other module's *table* directly
  inside the repository (a Dexie `where`/`.and()` query, or a Supabase
  join for a `--remote` module) — never by importing another module's
  repository file.
- Every feature's `index.ts` is the only public surface other modules
  see (`@/features/todos` is allowed;
  `@/features/todos/data/todo.repository` from outside `todos` is not).

Five layers, with no `service`, `contract`, or `controller` layer: a
local-first app has no HTTP boundary to validate at, and domain logic
lives in the repository or the hook.

```
schema      (Zod schema + Dexie table registration)   — types before data
repository  (Dexie or Supabase adapter, behind one interface)
hook        (TanStack Query)
screen      (Next.js + ShadCN/Tailwind, UX judgment folded in)
join        (workspace-wide gate, once per module)
```

`core.yaml` declares this as `pattern: vertical-slice`: every
layer above `join` carries `{module}` in its scope, so the chain runs
once per module, independently.

Every layer except `join` scaffolds from a generator in
`tools/generators/`, which emits the layer's files and the spec its
verify command runs. What's authored on top is the entity-specific
delta. See [scaffolding a layer](references/scaffolding.md) for the
generator command per layer and the flag contract.

## Domain Module — Steps

One pass per module — schema through screen, then the workspace-wide
`join` gate. Each row is one compiled layer; dispatch every layer to the
`pwa-eng` agent, one claimed packet per dispatch.

| # | Layer | Lives in | Commit |
|---|---|---|---|
| 1 | `schema` | `src/features/{module}/data/{module}.schema.ts` (Zod) and its `{module}.schema.spec.ts`, `src/db/tables/{module}.table.ts` (Dexie table registration), `src/db/schema.ts` (barrel, appended to — see below), `supabase/migrations/*_{module}.sql` (a `--remote` module only) | `feat({module}): schema` |
| 2 | `repository` | `src/features/{module}/data/**` (Dexie or, for a `--remote` module, Supabase adapter behind the same interface) | `feat({module}): repository` |
| 3 | `hook` | `src/features/{module}/hooks/**` (TanStack Query) | `feat({module}): hooks` |
| 4 | `screen` | `src/features/{module}/components/**`, `src/features/{module}/index.ts`, `src/app/{module}/**`, `src/app/page.tsx` | `feat({module}): screen` |
| 5 | `join` | workspace-wide, `exclusive: true` — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build` | `chore({module}): join` |

Schema through screen is one continuous pass per module, all built by
`pwa-eng`, with `join` as the single workspace-wide backstop after each
module's `screen` lands. Every module's `screen` scope lists the shared
home page, `src/app/page.tsx`, so the scheduler serializes any two
modules' `screen` tasks.

### The `src/db/schema.ts` barrel and migration ordering

`src/db/schema.ts` is a normal, hand-editable source file, not a
generated or derived one. Each module's `schema` layer appends one
import and one `.version(n).stores({...})` line to it, folding every
table file's exports into the single ordered version chain Dexie
requires.

Each `src/db/tables/{module}.table.ts` file carries its own version
number, written once by the generator: it reads every existing
`src/db/tables/*.table.ts` file's exported version, assigns
`max(existing) + 1` to the new one, and appends the matching line to
`src/db/schema.ts`. Never hand-pick a version number.

Every module's `schema` task lists `src/db/schema.ts` in scope, so the
scheduler serializes any two of them. `join`'s workspace-wide,
`exclusive: true` verify is the final backstop that catches a version
collision or a malformed chain.

### `--remote` modules

A module generated with `entity --remote` has the same five-layer shape.
Its `schema` layer writes the Zod schema and a
`supabase/migrations/00000000000000_{module}.sql` stub (rename the
timestamp prefix to the generation time) instead of a Dexie table file;
the `schema` scope covers that migration. Author its columns and RLS
policies in that layer; the verify command runs the schema spec only,
so policy coverage is checked at review (see below). `repository`,
`hook`, and `screen` are unchanged in scope and verify — a hook or
screen cannot tell whether the module underneath is Dexie- or
Supabase-backed, because the repository export and its interface
(`list`, `get`, `create`, `update`, `delete`) are identical either way.

## The Loop (every unit of work)

Run `hedgehog-orchestrating`'s cycle. On this core:

- Dispatch every layer's packet to `pwa-eng`.
- A failing `join` is fixed in the module layer that caused it, through
  the Correction Protocol, never inside the `join` task itself.

## Intra-step conventions

ESLint guardrails own the *structural* rules (what imports what). These
are the conventions *inside* a step that those gates can't see — apply
them uniformly so a fresh-context session builds module N the same way
it built module 1.

- **Repository methods write only the fields they change.** A mutation
  is not a read-modify-write over the whole record — required for Dexie
  Cloud's conflict semantics to hold once sync is on, and correct to
  write this way even before sync is on.
- **Multi-table mutations are transactional.** A repository method that
  writes more than one table wraps the writes in
  `db.transaction("rw", …)`.
- **Errors are typed and discriminated**: validation, persistence,
  network, provider, and unexpected (`src/db/errors.ts`). A repository
  method surfaces one of these rather than letting a raw Dexie or
  Supabase exception reach a hook. User-facing messages never carry
  internal detail.
- **Only the repository reaches the database.** No component, hook, or
  `app/` file imports `src/db/**` (Dexie or Supabase) directly — the
  guardrail this core's `join` verify and CI both enforce.
- **Timestamps are UTC ISO 8601 strings at the domain boundary.** Locale
  formatting happens in the screen layer only.
- **All data crossing a trust boundary is Zod-validated** — imported
  data, external API responses, and, once sync is on, records arriving
  through sync (another member's device is an untrusted writer, exactly
  like an external API). Client-side validation is a UX affordance; with
  sync on, Dexie Cloud's server-side realm rules are the actual boundary.
- **Offline handling is added only where a feature is genuinely local.**
  A feature that requires the network fails honestly rather than
  pretending to work offline.

## Friction log and Correction Protocol

`hedgehog-orchestrating`'s "Friction log" and "Correction Protocol" (with
its "Post-build entry") apply unchanged. `pwa-eng` reports a problem it
hits rather than correcting across layers itself.

## Phase Transition Checks

This core has no backend/frontend phase split to gate. Once per module,
after its `join` task lands, `reviewer` checks:

- **Repository discipline**: does anything outside
  `data/{module}.repository.ts` import `src/db/**` (Dexie or Supabase)?
  Does a `--remote` module's repository import `@supabase/supabase-js`
  from anywhere but that one file?
- **Feature boundary**: does anything outside `features/{module}/`
  deep-import past its `index.ts` (`@/features/todos/data/...` rather
  than `@/features/todos`)?
- **Module granularity**: is this actually one entity = one module, or
  has scope crept — two entities sharing a repository, or a join table
  absorbed into one side's module instead of standing alone?
- **Mutation discipline**: do repository methods write only the fields
  they change, and does a multi-table write run inside
  `db.transaction("rw", …)`?
- **Sync readiness**: does the table registration carry a plain,
  client-generated string `id` (never auto-increment or a hand-rolled
  non-UUID scheme) plus `realmId` and `owner`, regardless of whether
  sync is on yet for this project (per `.hedgehog/addons.yaml`)? `id` ->
  `@id` is a one-line change made only once sync turns on — a table
  still on plain `id` is not a defect.
- **`--remote` shape, if applicable**: do the migration's RLS policies
  cover every column the repository writes, and does every write the
  client must not make directly go through an Edge Function?
- **Tests cover the authored delta**: do the generated specs still
  describe the module after its fields and rules were added, or were
  they left at the skeleton?
- **Intra-step conventions**: does the module follow the conventions the
  gate can't see (Intra-step conventions, above)? Check against that
  list rather than re-deriving it. A module drifting from them is a
  Warning unless it breaks a later layer.
- **Security/correctness**: unvalidated input reaching a Dexie or
  Supabase call outside the Zod-validated schema boundary, a secret or
  non-`NEXT_PUBLIC_` var reachable from client code, obvious logic
  errors — same bar any reviewer would apply, scoped to what's new since
  the module's last `join` commit.

The review point is the module's `chore({module}): join` commit; `git
diff` from there, then read every layer of the module rather than the
diff alone — boundary violations are invisible from a diff. `hedgehog
why <path>` names the task that wrote a file.

## Rules

- **A wrong step gets fixed at its source** — the Correction Protocol,
  not a downstream workaround.
- `src/db/schema.ts`'s append-only discipline and the repository-only
  database access rule are root CLAUDE.md's Core rules — see there, not
  restated here.

## Stop Condition

`hedgehog-orchestrating`'s "Stop Condition" applies unchanged: the build
is complete when every task for every module in scope is `complete` and
`hedgehog boundary` exits 0.
