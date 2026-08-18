---
name: hedgehog-bootstrap-pwa-app-core
description: Use once, at the start of a new Hedgehog project on the pwa-app core, before any domain module work, to land the pwa-app core workspace (Next.js static export, Dexie, the enforcement config) and verify it's green — then wire sync and/or remote entities if planning intake turned either on. Runs as the first move of the `bootstrap` agent, which `planner` invokes automatically after Confirm & Lock.
---

# Hedgehog Bootstrap — pwa-app Core

Lands the always-on core of a Hedgehog pwa-app project — the same
pieces on every project regardless of size — by copying a pre-built,
pre-verified workspace (this package's `workspace/`) rather than
generating it live: the Next.js static-export shell, `src/db/`, the
ShadCN/Tailwind base, PWA manifest and service worker, and every
enforcement file. These pieces are deterministic — the same commands
produce the same output on every project — so the output is committed
once, upstream, and copied here instead of re-derived by an agent on
every run.

Unlike `hedgehog-core-full-stack-app`'s bootstrap skill, this one is
**not** add-on-blind: §15 of this core's design names two independent
booleans — sync, remote entities — that a project can take either, both,
or neither of, decided by `planner` during intake and recorded in
`.hedgehog/addons.yaml` alongside module scoping, the same mechanism
`full-stack-app` uses for its own Auth/Queue/Mobile add-ons. This skill
reads that file and conditionally runs the matching branch below. There
is no third branch and no partial state: each boolean is either on or
off for the whole project, decided once, here.

## What lands unconditionally

Everything under this package's `workspace/`, copied to the repo root,
regardless of which add-ons are on:

- Root: `package.json` (Next.js, Dexie, Zod, TanStack Query,
  `@serwist/next`, the ShadCN/Tailwind dependencies — see this core's
  `CLAUDE.core.md` for the full stack table), `core.yaml` (the shipped
  layer sequence `hedgehog plan`/`verify`/`next` read for this project —
  a different file from `.hedgehog/core.yaml`, which only exists on an
  authored core and never coexists with this one), `nx.json`,
  `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`,
  `lefthook.yml`, `commitlint.config.cjs`, `.env.example` (sync and
  remote-entity variables present but commented out — §15 uncomments the
  relevant block per branch below).
- `src/app/` — Next.js App Router shell, static export configured, no
  server runtime.
- `src/db/` — `database.ts` (the Dexie instance, sync wiring commented
  out until the sync branch below runs), `schema.ts` (the empty version
  chain barrel — `export {}`, until the first module's `schema` layer
  appends a line, the same reasoning `hedgehog-core-full-stack-app`'s
  `packages/db/src/schema/index.ts` needs it for: a comment-only file
  with zero import/export statements compiles as an ambient script, not
  a module, under `isolatedModules`), `tables/` (empty until a module's
  generator lands one), `export.ts` (versioned export / validated import
  / clear, per §13 — wired to a settings route by this skill, step 5).
- `src/components/` — hand-built ShadCN base (`components.json`, `cn()`
  util, CSS variable theme, light/dark toggle), cross-feature UI only.
- `src/features/` — empty until the first module lands.
- `src/integrations/` — empty until the first `integration` generator
  run.
- `src/styles/` — Tailwind v4 entry.
- `tools/generators/` — `feature`, `entity`, `integration` (§7). Not
  built by this skill or by any build session; they ship pre-built in
  this package.
- PWA manifest, icons, and `@serwist/next` service-worker config wired
  in `src/app/`, precached app shell, offline fallback route.
- The full lint guardrail set from §8 — no `src/db/**` import outside
  `data/*.repository.ts`, no `indexedDB`/`localStorage` for app state
  beyond a named preferences allowlist, no deep feature import, no
  provider SDK import outside `integrations/*/[name].client.ts`, no
  non-`NEXT_PUBLIC_` env access in client code,
  `@typescript-eslint/no-floating-promises`/`no-explicit-any`, strict
  mode on.

`node_modules` is not part of the copy — `pnpm install` regenerates it
from the committed `pnpm-lock.yaml`, a fast resolve against a locked
graph, not a fresh solve.

## Steps

### 1. Confirm this hasn't already run

Check for `nx.json` at the repo root, or a prior `feat(config): workspace
+ shared config` commit (`git log --grep="^feat(config): workspace"`).
Either means core already landed — stop, don't re-copy. If something
about the landed core seems wrong, that's a Correction Protocol case
(`hedgehog-loop`), not a re-copy: patch the specific file at its source.

### 2. Land this package's `workspace/`

`hedgehog init --pwa-app` copies this package's `workspace/` to the repo
root at install time, the same way it copies the engine's `src/agents`
to this host's own agents directory — check whether the core files are
already present (same check as step 1) before copying again. On a
project that ran plain `init` (no core flag) and only reaches `pwa-app`
because `planner` picked it at Phase 0, this hasn't happened yet: copy
`workspace/`'s contents to the repo root now. Also merge this core's
`CLAUDE.md` section into root `CLAUDE.md` (this package's
`CLAUDE.core.md` fills the shell's `{{CORE_SECTION}}` placeholder left
unfilled by a deferred install) — skip this if the section is already
filled. Either way, by the end of this step every file listed in "What
lands unconditionally" above should be on disk.

### 3. Install

```bash
pnpm install
cp .env.example .env.local
```

No Docker, no local database server, no infra to bring up — Dexie is
IndexedDB in the browser, and the app has no server tier. `.env.local`
matters only once one of §5/§6's branches below writes a real value into
it; for a project taking neither branch, the copied `.env.example`'s
variables all stay commented out and the app runs with none of them
set.

`pnpm install` resolves against the committed `pnpm-lock.yaml` — this
should be fast and produce no lockfile changes. A lockfile diff here
means the shipped `pnpm-lock.yaml` doesn't match `package.json` — that's
a packaging bug in this package's `workspace/`, not something to patch
locally (see **If verification fails**, below).

### 4. Read `.hedgehog/addons.yaml`

`planner` writes this file during intake, alongside module scoping.
Read the two booleans this core cares about:

```yaml
sync: true|false
remote_entities: true|false
```

Both `false` (the common case — most projects need neither) means skip
straight to step 7. Either or both `true` means run the matching branch
below, in either order, before step 7 — the two are genuinely
independent and neither depends on the other having run.

### 5. Sync branch (only if `sync: true`)

The workspace already lands sync-ready regardless of this branch —
`@id` sharded string keys, `realmId`/`owner` on every syncable table,
field-level mutations (§9) — so turning sync on here is wiring, not a
data-shape change:

```bash
pnpm add dexie-cloud-addon
npx dexie-cloud create
```

`dexie-cloud create` provisions a Dexie Cloud database and prints its
URL. Write that URL into `.env.local` as
`NEXT_PUBLIC_DEXIE_CLOUD_URL`, uncommenting the matching line in
`.env.example` too so the committed template documents it for the next
clone. Wire `src/db/database.ts` (already scaffolded with this block
commented out):

```ts
db.use(dexieCloud);
db.cloud.configure({
  databaseUrl: process.env.NEXT_PUBLIC_DEXIE_CLOUD_URL,
  requireAuth: true,
});
```

Confirm the auth adapter in `src/db/` exposes `currentUser`, `signIn`,
and `signOut` reading `db.cloud.currentUser` — never leave feature code
reaching for `db.cloud` directly, the same isolation §8 requires for
every provider SDK.

Nothing above the repository layer changes. Don't touch any file under
`src/features/` for this branch — if a module already exists at the
point sync turns on, its hook and screen code stays exactly as it is;
that's the property this branch exists to prove.

### 6. Remote entities branch (only if `remote_entities: true`)

```bash
pnpm add @supabase/supabase-js
```

Provision a Supabase project (via the Supabase CLI or dashboard, per
whatever this project's Supabase setup path is) and write its URL and
anon key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, uncommenting the matching block in
`.env.example`. Write `src/db/supabase.ts` — a single Supabase client
instance, initialized once, imported only by the repository file of
whichever entity a later `entity --remote` generator run creates. No
other file in the workspace imports `@supabase/supabase-js` — same
isolation rule as `src/db/database.ts` gets for Dexie.

Which entities are actually `--remote` is a per-entity decision made
later, at build time, by whoever runs the `entity` generator for that
module (§12) — not a bootstrap decision. This branch only wires the
client those entities' repositories and Edge Functions will need to
exist; it creates no domain schema, no migration, and no
`supabase/migrations/` directory of its own. That first migration file
lands with the first `--remote` module's `schema` layer, in the normal
build loop, not here.

If a project's Supabase auth needs to share identity with Dexie Cloud
(both branches on), record that choice in `.hedgehog/addons.yaml`
alongside the two booleans rather than deciding it silently here — it's
a real per-project decision (§12's "Auth" paragraph), and this skill
only wires the client, not the identity model on top of it.

### 7. Verify

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm build
```

All four must be clean — the same chain `join`'s verify runs on every
module later, run once here against the bare workspace (plus whichever
of steps 5/6 ran) before any domain module work starts. This is the one
live check that replaces trusting the copy: core isn't proven correct by
assumption, it's proven correct by actually running the same gate every
layer in this discipline runs.

The commit gate is already active by this point: `lefthook.yml` came
with the copy, and lefthook's own postinstall ran `lefthook install -f`
during step 3's `pnpm install`. Run `pnpm dlx lefthook install` only if
`.git/hooks/pre-commit` is somehow absent.

Confirm the gate is real rather than assuming it, with:

```bash
hedgehog status
```

Its `COMMIT GATE` line reads `active` only when the hooks exist, were
generated with `lefthook.yml`'s `assert_lefthook_installed: true`, and
the lefthook binary actually resolves. Anything else is a gate that
isn't enforcing, and the line names the repair.

### 8. Commit

```
feat(config): workspace + shared config
```

One commit for core plus whichever of steps 5/6 ran — landed as a
verified copy plus verified add-on wiring. That commit existing is the
record that core landed — `bootstrap` checks for it via the commit log,
not a checklist line.

## If verification fails

A clean copy of `workspace/` that fails typecheck/lint/test/build, or
needs a lockfile change, means the shipped template itself is broken —
not a per-project problem to hand-patch around. Stop and report exactly
what failed (which command, which error). Fixing this means updating
`workspace/` at its source and shipping a new package version — never
patch a consuming project's copy to route around a broken template and
call core done.

A failure inside steps 5 or 6 (the add-on branches) is different: those
run live, against real external services (`dexie-cloud create`, a
Supabase project), so a failure there can be a genuine external issue
(network, quota, an expired CLI session) rather than a packaging bug.
Diagnose before assuming the workspace itself is broken.

## Hosting (do not default to Railway)

This is a static app plus, optionally, a stateful sync backend —
conflating the two hosting questions is how a zero-backend core ends up
recommending a server by default. Tell the user, once core has landed:

- **The app** is a Next.js static export — files, not a server. Point at
  **Vercel** by default (zero-config for a static Next export),
  Cloudflare Pages or Netlify equally valid. Free at this scale for the
  overwhelming majority of projects this core targets. Never suggest
  Railway for the app itself — there is no server process to run it on.
- **Sync**, only if step 5 ran, has its own hosted tier: Dexie Cloud's
  hosted offering (free for 3 production users and 100 MB, ~€3/month per
  25 seats beyond that) is the default, the same way `dexie-cloud
  create` above defaults to it rather than standing up infrastructure.
  **Railway** enters only as the self-host escalation path, named but
  not set up here: Dexie Cloud is Node + Postgres, which is exactly
  Railway's shape, so a project that outgrows the hosted tier has a
  documented one-step path — not a redesign, and not something this
  skill sets up preemptively.

Getting this backwards — leading with Railway the way
`hedgehog-core-full-stack-app`'s bootstrap does — misstates what this
core is: that core's app has a real server process Railway is built to
host; this one's does not, and a project on this core needing
infrastructure at all is the exception, not the baseline.

## Constraints

- Run once per project, always as `hedgehog-bootstrap`'s first move —
  never invoked on its own by a user.
- Read `.hedgehog/addons.yaml` exactly once, at step 4, before deciding
  whether to run steps 5/6 — don't re-check it mid-branch or assume a
  value not actually written there.
- Don't hand-edit any file this step lands to work around a verification
  failure. Fix `workspace/` at the source instead (see **If
  verification fails**).
- Don't add domain schema, repositories, hooks, or any
  `src/features/*` content — that's the `hedgehog-loop` build loop,
  after every Bootstrap step (core, and whichever of sync/remote
  entities are on) is checked.
- Don't provision Supabase or Dexie Cloud infrastructure for a project
  that didn't ask for it — both branches are strictly conditional on
  `.hedgehog/addons.yaml`, never run "just in case."
- Never suggest Railway as this core's default host for the app itself —
  see **Hosting**, above. Railway is named only inside the sync
  self-host escalation note, never as the first answer to "where do I
  deploy this."
