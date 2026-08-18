## This project's core: pwa-app

Local-first PWA, one continuous pass per domain module: schema →
repository → hook → screen, then `join`. There is no backend/frontend
phase split — this core has no server tier, so there is nothing to
sequence a "Phase A" ahead of. See `.hedgehog/BMAD/` for the archival
planning intake output — BMAD-METHOD's brainstorming, brief, PRD, and UX
spec, written once by `planner` and never edited after. Its
`00-manifest.md` records which intake mode produced it; a compressed
archive holds the PRD and whatever flows the brief stated, and nothing
else.

`.hedgehog/addons.yaml` carries this core's two independent add-on
decisions — **sync** and **remote entities**, each on or off — decided
by `planner` during intake. Check it before assuming either's infra
exists; a project can have neither, either, or both.

### The skills — invoke these, don't improvise

The discipline is packaged as skills. Use them; don't reconstruct their
steps from memory:

- **`hedgehog-loop`** — every unit of work once bootstrapped: `hedgehog
  next` emits the packet for one ready layer, build exactly one, gate it
  via `hedgehog verify`, which commits it on a pass. Also holds the
  Correction Protocol for fixing a wrong upstream step. Invoke it at the
  start of any build session and for "what's next".
- **`hedgehog-bootstrap-pwa-app-core`** — run **once**, at project
  start, to scaffold the core stack, the enforcement config, and
  whichever of sync/remote entities planning intake turned on. Skip if
  `nx.json` already exists.
- **`conventional-commits`** — when a change spans several layers in one
  working-tree pass and needs splitting back into per-layer commits
  (mainly Correction Protocol cleanups).

### The agents — delegate the judgment calls

- **`planner`** — planning intake (which core applies, then
  `hedgehog-planning-intake`'s BMAD-METHOD brainstorming/brief/PRD/UX-spec
  shelf, mined into intent records, the sync and remote-entity decisions,
  and domain vocabulary) at project start. Writes intents via `hedgehog
  intent add`, `.hedgehog/addons.yaml`, and `.hedgehog/BMAD/`. On first
  run, hands off to the `bootstrap` agent once Confirm & Lock holds. Runs
  again whenever new scope enters play — including after the build is
  complete — taking `hedgehog-planning-intake`'s **Re-entry pass**: the
  BMAD shelf and `bootstrap` are both skipped, new modules are mined into
  additional intents, and `hedgehog plan` appends their tasks without
  touching anything already built.
- **`bootstrap`** — runs `hedgehog-bootstrap-pwa-app-core`'s steps:
  core, unconditionally, then the sync and/or remote-entity branch, each
  only if `.hedgehog/addons.yaml` turned it on. Triggered automatically
  by `planner` after its first run; skip if `nx.json` already exists.
- **`pwa-eng`** — builds every module's full sequence (schema →
  repository → hook → screen), one `hedgehog next` packet at a time,
  gated by `hedgehog verify`. One agent covers the whole vertical slice:
  every layer here is TypeScript running client-side against the same
  Dexie instance, with no framework-tier switch to split responsibility
  on the way a server-backed core splits backend from frontend engineers.
- **`reviewer`** — the per-module checks the mechanical gate can't make
  (repository discipline, feature-boundary discipline, mutation
  discipline, sync readiness), run once a module's `join` task lands.

## The constants (do not deviate)

### Stack (locked, every project — no add-on varies the stack itself, only whether sync/remote-entity infra is wired)

Next.js (App Router, **static export** — no server runtime) · Nx
(boundary enforcement, generators) · pnpm · **Dexie 4** (the one
supported IndexedDB abstraction — raw `indexedDB` and `localStorage` for
app state are lint-forbidden) · **Zod** (entities, imports, external
responses — types inferred, never hand-maintained alongside) ·
**TanStack Query** (external API responses only — never a substitute for
the local DB) · Tailwind v4 + hand-built ShadCN base · **`@serwist/next`**
(manifest, service worker, precached app shell, offline fallback) ·
Dexie's sharded auto-generated string keys (client-generated,
collision-free across devices, the form Dexie Cloud requires — a
hand-rolled ID scheme is not substitutable once data exists) · Vitest +
`fake-indexeddb` + Testing Library (repository tests run against a real
IndexedDB implementation in-process) · Playwright (offline-mode and
install-manifest checks) · ESLint + Prettier +
`@nx/enforce-module-boundaries` · Conventional Commits + commitlint +
lefthook.

**Off by default, wired only when `.hedgehog/addons.yaml` turns them
on** — independent booleans, a project can have neither, either, or
both:

| Add-on | Adds |
| --- | --- |
| Sync | `dexie-cloud-addon` — two-way sync, passwordless OTP/OAuth, server-enforced realm access control, added to the existing Dexie instance with `db.use()` + `db.cloud.configure()`. Nothing above the repository layer changes. |
| Remote entities | `@supabase/supabase-js`, `src/db/supabase.ts` — Postgres + RLS + Auth + Edge Functions, backing whichever entities a later `entity --remote` generator run declares server-authoritative. Same five-method repository interface as a Dexie-backed entity; a hook or screen cannot tell which backs it. |

Excluded from the core, lint-enforced: Prisma, Drizzle, NestJS, Redis,
GraphQL, Redux, Zustand, Jotai, and any second state-management or
persistence library beyond Dexie and TanStack Query. Postgres and Docker
are excluded from the app itself — Postgres appears only as Supabase's
own storage engine (never addressed directly) and as the self-hosting
target for Dexie Cloud, both deployment concerns, not application
architecture.

Don't substitute libraries. If a package or generator name changed
upstream, verify against current docs before running — don't swap in a
different library.

### Layer sequence

```
schema      Zod schema + Dexie table registration     — types before data
repository  Dexie or Supabase adapter, one interface   — the only door to src/db/**
hook        TanStack Query
screen      Next.js + ShadCN/Tailwind — UX judgment folded into this layer
join        workspace-wide, exclusive, once per module — the cross-module backstop
```

No `service`, `contract`, or `controller` layer. A local-first app with
no server tier has no HTTP boundary to validate at, and a repository
plus a hook covers what a `service` layer would otherwise hold — folded
in rather than carried as an always-empty sixth layer. Re-added only if
a module surfaces real domain logic with nowhere else to live.

### Layout

```
src/
  app/                    Next.js App Router — static export, no server logic
  features/<module>/
    components/
    data/                 <module>.schema.ts, <module>.repository.ts, tests
    hooks/
    index.ts              the only public surface
  db/
    database.ts            Dexie instance (+ db.cloud.configure() if sync is on)
    schema.ts               version chain + table registration — barrel, append-only
    tables/                 per-module registration file, one per entity
    supabase.ts             Supabase client — only if remote entities are on
    export.ts                versioned export / validated import / clear (§13)
  integrations/<name>/     <name>.client.ts, .schema.ts, .adapter.ts
  components/              cross-feature UI only
  styles/
tools/generators/           feature, entity, integration — pre-built, not authored per project
core.yaml
nx.json
eslint.config.mjs
lefthook.yml
commitlint.config.cjs
.hedgehog/
  hedgehog.db               the build graph — intents, tasks, dependencies, verifications, committed to git
  addons.yaml                sync / remote_entities, each on or off, from planner
  BMAD/                       archival planning intake output (brief, PRD, UX spec, research) — write-once, from planner
```

No `utils/`, `helpers/`, `misc/`, or a top-level `services/` — a feature
owns its behavior; ESLint rejects those directory names. Check
`.hedgehog/addons.yaml` before assuming `src/db/supabase.ts` or any sync
wiring in `database.ts` is actually present in this codebase.

### Generators (§7 — invoke, don't hand-author)

```bash
pnpm generate @hedgehog/pwa:feature <name>
pnpm generate @hedgehog/pwa:entity <Name> [--feature=<name>] [--remote]
pnpm generate @hedgehog/pwa:integration <name> [--kind=wallet]
```

There is no `hedgehog generate` command — `hedgehog` is the build-graph
CLI (`plan`, `next`, `claim`, `verify`, `status`, `boundary`, …) and
gains no generator verbs. Every layer starts from its generator, then
gets the entity-specific delta authored on top: field list and types,
validation and mutation rules, and — for `screen` — layout and
interaction pattern. A generator that emits an empty file is a bug, not
something to hand-fill.

### Guardrails (§8 — lint-enforced, run in `join`'s verify and in CI)

- No import of `src/db/**` from `components/`, `hooks/`, `app/`, or any
  `.tsx` file. Only `data/*.repository.ts` reaches the database — Dexie
  or Supabase alike.
- No `indexedDB` global and no `localStorage` for application state.
  `localStorage` is allowed only for a named allowlist of browser
  preferences.
- No deep import across features. `@/features/todos` is allowed;
  `@/features/todos/data/todo.repository` is not.
- No provider SDK imported from `features/**`. Provider imports are
  confined to `integrations/*/[name].client.ts` and `src/db/`'s own
  `database.ts`/`supabase.ts`.
- No non-`NEXT_PUBLIC_` env access in client code.
- `@typescript-eslint/no-floating-promises`, `no-explicit-any`, strict
  mode on.

Multi-table mutations run inside `db.transaction("rw", …)`; the `entity`
generator emits the transaction wrapper so the common case is correct by
construction.

### Core rules

- **One entity = one domain module.** Each carries the full step
  sequence.
- **Cross-module references are FK-by-ID only.** A repository resolves a
  related entity by a second query against the other module's own
  repository, or a same-store join against its table — never by
  importing another module's repository file directly.
- **No phase split to gate.** Schema through screen is one continuous
  pass per module, all built by `pwa-eng`; `join` is the single
  workspace-wide backstop after each module's `screen` lands.
- **One layer = one commit**, in the exact Conventional Commit format
  from `hedgehog-loop`. A commit that fails typecheck/lint/test does not
  happen (lefthook gate).
- **Fix wrong layers at the source** via the Correction Protocol — never
  a downstream workaround.
- **Repository methods write only the fields they change**, never a
  read-modify-write over the whole record — required for Dexie Cloud's
  conflict semantics once sync is on, correct to do from the start.
- **`src/db/schema.ts` is a hand-editable barrel, appended to by each
  module's `schema` layer** — never regenerated wholesale, never
  restructured mid-build.
- **Export is a first-class feature, not an add-on** (§13). `src/db/
  export.ts` ships in the workspace; import validates the whole payload
  against the current schema version, inside one transaction, before
  writing anything. Clear requires explicit confirmation.
- **The client is assumed compromised.** No secrets ship to the browser.
  All imported data, external responses, and — once sync is on — records
  arriving through sync are Zod-validated at the trust boundary.

### Hosting (do not default to Railway — see also the bootstrap skill)

Two separate questions, because this core is a static app plus an
optional stateful sync backend:

- **The app**: Next.js static export means the build output is files,
  not a server. **Vercel** by default (zero-config for a static Next
  export), Cloudflare Pages or Netlify equally valid. Free at this scale
  for the overwhelming majority of projects this core targets.
- **Sync, when on**: Dexie Cloud's own hosted tier (free for 3
  production users and 100 MB, ~€3/month per 25 seats beyond that) is
  the default. **Railway** enters only as the self-host escalation —
  Dexie Cloud is Node + Postgres, Railway's shape — for a project that
  outgrows the hosted tier or has a self-hosting requirement. Not the
  default, and not set up unless a project actually reaches for it.

A project on this core needing infrastructure at all is the exception,
not the baseline — unlike `full-stack-app`, whose NestJS API always
needs a server to run on, this core's default project needs nothing
beyond a static host.
