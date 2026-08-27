---
name: hedgehog-loop
description: Use for every unit of work once a Hedgehog project is bootstrapped — building one layer (schema, repository, hook, screen, join) per module, gated by `hedgehog verify` and committed one layer at a time. Triggers on "next step", "build this module", "what's next", or the start of any work session on a bootstrapped project. Also covers the Correction Protocol for fixing a wrong upstream step.
---

# Hedgehog Loop

The operating loop for a bootstrapped Hedgehog project: `hedgehog claim`
reserves the packet(s) for ready layers, build them, `hedgehog verify`
gates and commits each. The build graph (`.hedgehog/hedgehog.db`) is the
live list — query it via `hedgehog status`/`hedgehog ready`, never
re-derive state from prose. The step table below mirrors this core's
`workspace/core.yaml`, the design source of truth for layer order,
scope, and verify command per layer — read the table for the
human-readable shape, and the YAML when they seem to disagree.

The packet, though, is what actually runs. `hedgehog plan` copies each
layer's scope globs, verify command and commit message onto every task
row at compile time; from then on the row — not `core.yaml` — is what
`hedgehog claim` hands out and `hedgehog verify` gates against, and
editing `core.yaml` afterwards does not reach tasks already compiled (a
plain `hedgehog plan` re-run won't apply it either — it only reads
intents still pending). `hedgehog status` prints a **DRIFT** section
whenever the two have diverged, and `hedgehog plan --recompile` rewrites
the layer-derived fields on not-yet-started tasks from the current
`core.yaml`, refusing — and naming — every task already building,
verifying, complete, or blocked. Never patch a task row in SQLite by
hand: the DB is derived and gitignored, so `hedgehog db rebuild` drops
the patch.

## The Domain Module Pattern

A **domain module = one entity.** `todos`, `notes`, `expenses` are each
their own module, carrying the full step sequence below. The Zod schema
is the source of truth for module boundaries.

**Cross-module references are FK-by-ID only.** If a `todos` record
references a `projects` record, `todos`' schema holds a plain id field —
the `todos` repository and hook depend only on their own module.

- Need the related row? Resolve it at the hook layer (a second query
  against the other module's own repository, composed in the consuming
  hook or screen), or join against the other module's *table* directly
  inside the repository (a Dexie `where`/`.and()` query, or a Supabase
  join for a `--remote` module) — never by importing another module's
  repository file.
- This keeps every feature's `index.ts` the only public surface other
  modules see, per this core's guardrail against deep imports
  (`@/features/todos` is allowed; `@/features/todos/data/todo.repository`
  from outside `todos` is not).

There is no `service`, `contract`, or `controller` layer here — a
local-first app with no server tier has no HTTP boundary to validate at
and rarely has domain logic that doesn't fit naturally in either the
repository or the hook. Five layers, not the six or seven a server-backed
core carries:

```
schema      (Zod schema + Dexie table registration)   — types before data
repository  (Dexie or Supabase adapter, behind one interface)
hook        (TanStack Query)
screen      (Next.js + ShadCN/Tailwind, UX judgment folded in)
join        (workspace-wide gate, once per module)
```

Every layer scaffolds from its own generator in `tools/generators/` (see
"Scaffolding a layer" below) — schema file, table registration, barrel
wiring, and the layer's conventional shape all land in one deterministic
step. What's authored on top is the entity-specific delta: the field
list and its types, the module's validation and mutation rules, and the
screen's layout and interaction pattern.

## Domain Module — Steps

One horizontal pass per module — schema through screen, then the
workspace-wide `join` gate. Each row is one compiled layer in this
core's `workspace/core.yaml`; delegate every layer to the `pwa-eng`
agent, one claimed packet per dispatch — it builds the layer, `hedgehog
verify` gates and commits it.

| # | Layer | Lives in | Commit |
|---|---|---|---|
| 1 | `schema` | `src/features/{module}/data/{module}.schema.ts` (Zod) and its `{module}.schema.spec.ts`, `src/db/tables/{module}.table.ts` (Dexie table registration), `src/db/schema.ts` (barrel, appended to — see below) | `feat({module}): schema` |
| 2 | `repository` | `src/features/{module}/data/**` (Dexie or, for a `--remote` module, Supabase adapter behind the same interface) | `feat({module}): repository` |
| 3 | `hook` | `src/features/{module}/hooks/**` (TanStack Query) | `feat({module}): hooks` |
| 4 | `screen` | `src/features/{module}/components/**`, `src/features/{module}/index.ts`, `src/app/{module}/**` | `feat({module}): screen` |
| 5 | `join` | workspace-wide, `exclusive: true` — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build` | `chore({module}): join` |

Repeat 1–5 per module in scope, via `hedgehog claim`/`hedgehog verify`.
There is no phase split to gate on the way a server-backed core gates
backend before frontend — schema through screen is one continuous pass
per module, all built by the same agent, with `join` as the single
workspace-wide backstop after each module's `screen` lands.

### The `src/db/schema.ts` barrel and migration ordering

`src/db/schema.ts` is a normal, hand-editable source file, not a
generated or derived one — the same append-only discipline
`hedgehog-core-full-stack-app`'s `packages/db/src/schema/index.ts`
barrel uses. Each module's `schema` layer appends one import and one
`.version(n).stores({...})` line to it, folding every table file's
exports into the single ordered version chain Dexie requires.

Each `src/db/tables/{module}.table.ts` file carries its own version
number, written once by the `entity`/`feature` generator at generation
time: it reads every existing `src/db/tables/*.table.ts` file's exported
version number, assigns `max(existing) + 1` to the new one, and appends
the matching line to `src/db/schema.ts`. Never hand-pick a version
number.

Two modules' `schema` layers can run in the same wall-clock window under
module-axis parallelism — each is a separate task on a disjoint
`{module}.table.ts` file, plus the one shared `src/db/schema.ts` both
tasks list in scope. Because `schema.ts` is in both tasks' declared
scope, the scheduler treats them as conflicting on that file and
serializes them — the same conflict-detection any two tasks sharing a
scoped file already get, no extra locking layer needed. `join`'s
workspace-wide, `exclusive: true` verify is the final backstop that
catches a version collision or a malformed chain, the same role it plays
for `full-stack-app`.

### `--remote` modules (§12)

A module generated with `entity --remote` has the same five-layer shape
with one difference: its `schema` layer's scope additionally includes
`supabase/migrations/{module}.sql`, and that layer's verify gains a
policy check (the migration exists, applies cleanly, and its RLS
policies cover every column the repository writes). `repository`,
`hook`, and `screen` are unchanged in scope and verify — a hook or
screen cannot tell whether the module underneath is Dexie- or
Supabase-backed, because the repository interface (`list`, `get`,
`create`, `update`, `delete`) is identical either way. This is a
per-module shape variation the generator applies to which files a given
module's `schema` task touches, not a branch in the layer table itself.

## The Loop (every unit of work)

1. **Run `hedgehog claim --count N --owner <owner>`.** `<owner>` is this
   session (a stable id — session id or equivalent). Claim is atomic and
   lease-based, safe for concurrent claimers, and is the entry point into
   the loop — `hedgehog next` still exists as a read-only preview of the
   single next task, but claim is what actually reserves work. `--count
   N` is a maximum, not a promise: it returns however many tasks are
   safe to run together right now (the conflict predicate already
   filtered them against each other), which may be fewer than N, or
   zero. `hedgehog ready` previews the same decision without claiming
   anything — CLAIMABLE vs HELD BACK, with the reason for each holdback —
   useful for understanding the scheduler before committing to a claim.
2. **Dispatch each claimed packet to its own `pwa-eng` subagent** — in
   ONE message with parallel tool calls, not one agent call after
   another. This is a Claude session orchestrating via the Agent tool's
   parallel-call mechanism: N claimed tasks means N Agent calls in the
   same message. If a dispatch by name reports the agent as not found —
   expected right after `init`/`update` installed it this same session —
   see root CLAUDE.md's "Delegating on this host" note rather than
   treating it as fatal.
3. Each agent **runs typecheck/lint/test on its own work** (mirrors
   lefthook, wired at bootstrap) as a sanity check before reporting
   back — necessary, not sufficient. Per task, per agent: the agent
   reports its work as done; it does not move the task and does not
   commit.
4. **As each report arrives, verify it — one at a time, serially.** Run
   `hedgehog verify <task-id> --owner <owner>` (the same owner that
   claimed it; verify requires the lease owner). Building happens in
   parallel; verifying does not — verify writes a commit, and commits go
   through one at a time. It checks the touched files against the
   packet's ALLOWED SCOPE, runs the layer's VERIFICATION command, and on
   a pass writes the commit (the exact Conventional Commit message from
   the table above, plus the updated build graph) and unlocks the next
   layer. On a scope violation or a failing check, the task moves to
   `blocked` with a `blocked_reason` of `scope_violation` or
   `verification_failed`, and nothing downstream unlocks. Fix the work,
   then run `hedgehog retry <task-id>` to return the task to `planned`,
   claim it again (by task id — see below), and verify again —
   `hedgehog verify` only accepts a task you currently hold in
   `building`, so a blocked task has to go back through `retry` and
   `claim` first. Don't hand-commit around it.

   A `blocked` task anywhere in the graph — in this module or any other —
   makes `hedgehog claim --count N` refuse to hand out anything at all,
   with a non-zero exit naming the blocked task(s). `hedgehog status`
   lists them too, under NEEDS ATTENTION. Fix and `retry` the named
   task(s) before claiming more. A **targeted** `hedgehog claim <task-id>
   --owner <owner>` is exempt — that's how the just-retried task gets
   reclaimed in the step above. A lease the same `claim` call reaps for
   having just expired is exempt too: that call still claims whatever
   else is ready, and the reaped task lands in NEEDS ATTENTION for the
   next `claim` call to stop on.
5. **Repeat** — `hedgehog claim --count N --owner <owner>` again for the
   next batch.

Each claimed packet is the full packet — STATUS/INTENT/RELEVANT
RULES/INHERITED DEBT/WHY NOW/BLOCKED DOWNSTREAM/ALLOWED
SCOPE/VERIFICATION — and its **INTENT** block carries the goal and
outcome of the whole intent, not just this layer's objective. A layer's
verify command runs the tests that layer wrote, so it measures internal
consistency, never coverage of what was asked; build the layer's share of
the goal and say so when the packet doesn't account for something the
goal asks for. When `hedgehog verify` closes the **last** layer of an
intent it prints the goal and outcome back as an **INTENT CHECK** — read
the built work against it there, because nothing else in the build does.

A layer that hits a limitation the next layer must compensate for
declares it with `hedgehog debt add <task-id> "<note>"`; the note lands
in the **INHERITED DEBT** section of every packet that depends on that
task. A comment in a source file is not a mechanism — nothing reads it.

Each `hedgehog verify` call commits exactly one layer, built right for
what's known now; a wrong layer is fixed forward later via the
Correction Protocol. Valid task statuses are `planned`, `ready`,
`building`, `verifying`, `complete`, and `blocked`; a task in `blocked`
also carries a `blocked_reason` (`scope_violation`, `verification_failed`,
or `lease_expired`).

## Scaffolding a layer

`tools/generators/` holds the three Nx generators this core ships
(§7): `feature`, `entity`, `integration` — invoked directly as Nx
generators, not through a `hedgehog` verb (`hedgehog` is the build-graph
CLI and gains no generator commands of its own):

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
every module's `schema` layer touches is `src/db/schema.ts`, already
covered above.

## Intra-step conventions

The Nx boundaries and lint own the *structural* rules (what imports
what). These are the conventions *inside* a step that those gates can't
see — apply them uniformly so a fresh-context session builds module N
the same way it built module 1.

- **Repository methods write only the fields they change.** A mutation
  is not a read-modify-write over the whole record — required for Dexie
  Cloud's conflict semantics to hold once sync is on (§9), and correct
  to write this way even before sync is on.
- **Multi-table mutations are transactional.** A repository method that
  writes more than one table wraps the writes in
  `db.transaction("rw", …)`; the `entity` generator emits the wrapper so
  the common case is correct by construction.
- **Errors are typed and discriminated**: validation, persistence,
  network, provider, and unexpected. A repository method surfaces one of
  these rather than letting a raw Dexie or Supabase exception reach a
  hook. User-facing messages never carry internal detail.
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

## Friction log

Real friction during a build — an agent's instructions were unclear, a
redline had to be issued twice for the same underlying gap, the user
had to correct the same kind of mistake more than once, or user
feedback implied something was wrong even without a direct correction
(a preference stated once that, read plainly, means an earlier step
missed something) — is signal worth keeping past this session, separate
from the Correction Protocol that fixes it in the moment. Log one entry
via `hedgehog friction add "<note>" [--task <task-id>]` when that
happens: what was tried, what went wrong or was implied, why if visible,
and the commit/message it traces to, all in the note text; pass `--task`
with the layer's task id when the friction traces to one. This is a log,
not a todo list — don't let it block or slow the Loop; log and keep
moving. `tweaker` reads it (via `hedgehog friction list`) once the build
reaches its Stop Condition.

## Correction Protocol

When a downstream step reveals an upstream step was wrong:

1. **Quiesce.** Dispatch nothing new. Let in-flight tasks finish and
   verify normally — do NOT kill running subagents. Release anything
   claimed but not yet started (`hedgehog release <task-id> --owner
   <owner>`).
2. Once nothing is in flight (`hedgehog quiesce` exits 0), patch the
   upstream step directly, in place. Before editing, run the LSP tool's
   findReferences/incomingCalls against the symbol being changed to see
   what already depends on it — the blast radius a stale mental model
   would otherwise miss.
3. Fast-forward every dependent step that breaks, each its own small
   commit.
4. The commit messages are the explanation.
5. Resume — `hedgehog claim` again.

Quiescing is correct, not a cautious fallback. The conflict predicate
already guarantees a correction cannot collide with in-flight work: if
the correction's scope conflicted with something currently building, the
scheduler would not have co-scheduled it in the first place. Letting
in-flight tasks finish and verify rather than killing them costs nothing
and throws away no progress.

The orchestrating session runs this protocol. `pwa-eng` reports a
problem it hits rather than correcting across layers itself: the
commits at step 3 are the session's act, the same way `hedgehog verify`
always is.

Use `conventional-commits` when a correction touches several layers in
one working-tree pass and needs splitting back into per-layer commits.

### Post-build entry

The protocol also runs after a build has reached its Stop Condition, when
a `tweaker` session finds that something structural is wrong rather than
something small (`tweaker` routes it here). Steps 2, 3, and 4 are
unchanged. The two ends differ:

- There is nothing to **quiesce** — no task is in flight. Start by naming
  which committed layer was wrong and what revealed it.
- There is no loop to **resume**: every task is already `complete`, so
  `hedgehog claim` has nothing to claim. Return to the `tweaker` session
  instead.

Every task the correction touches is already `complete` and stays that
way — a correction is fixed forward in new commits, never by reopening a
finished task. Verify each patched layer by running that layer's own
verify command directly. Log the correction with `hedgehog friction add`
so the next friction review sees what the build got wrong.

## Phase Transition Checks

This core has no backend/frontend phase split to gate — schema through
screen is one continuous pass per module, all built by `pwa-eng`. What
`reviewer` checks instead, once per module after its `join` task lands,
is the same class of thing a phase gate would catch in a server-backed
core, adapted to this one's actual seams:

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
- **Sync readiness**: does the table registration carry `@id`, `realmId`,
  and `owner` regardless of whether sync is on yet for this project (per
  `.hedgehog/addons.yaml`)?
- **`--remote` shape, if applicable**: does the migration's RLS policy
  cover every column the repository writes? Does the Edge Function stub
  exist for every method the generator marked as requiring one?
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
diff alone — boundary violations are invisible from a diff.

Before starting a module, confirm it's inside the stated scope boundary
from planning intake (`planner`). If not, stop and ask — and if the
answer is that the scope really should grow, that's `planner`'s
Re-entry pass, which adds it to the graph properly. Don't build a module
the graph doesn't have a task for.

## Rules

- **Concurrent across modules, bounded by the scheduler.** Never assume
  two tasks are safe to run together because they look independent — ask
  `hedgehog ready`.
- **A wrong step gets fixed at its source** — the Correction Protocol,
  not a downstream workaround.
- **Tests gate every commit** in the sequence.
- **`src/db/schema.ts` is the single shared file every module's
  `schema` layer appends to** — never restructure it, never regenerate
  it wholesale; a felt need to do either is a sign the append-only
  discipline was already broken upstream.
- **Only the repository reaches the database**, Dexie or Supabase alike.
  A per-screen or per-hook exception request signals to fix the
  repository boundary, not to add one.

## Stop Condition

A build session ends when `hedgehog status` shows every task for every
module in scope `complete`, or when scope is ambiguous enough that
continuing means guessing — ask one question and wait.

On the former (a real build completion, not an ambiguity stop), offer a
fresh-context handoff before doing anything else: tell the user the
build is complete, and that clearing context now costs nothing. The
permanent record is the committed intents, friction log, root
`core.yaml` (the shipped core definition — not `.hedgehog/core.yaml`,
which only exists on an authored core), and the commit history itself —
not `.hedgehog/hedgehog.db`, which is
gitignored and derived, rebuildable at any time via `hedgehog db
rebuild`. That's what makes the next session cheap.

Before offering that handoff, run `hedgehog boundary` and only declare
the Stop Condition met once it exits 0. Every task showing `complete` is
not sufficient on its own: a lease can be outstanding without a visible
status change, and the working tree can still hold uncommitted work.
`boundary` checks all three — nothing in flight, clean tree, last closed
task completed its intent — and names which one failed when it exits
non-zero. `hedgehog quiesce` covers only the first of the three; it is
the right check mid-correction, not the right check for a handoff.

The same command answers the mid-build question the project instructions
file's **Managing context** section depends on: whether *this* moment,
not just the end of the build, is one to clear the conversation at. Run
it at any point you're considering `/clear`, and start the next session
from `hedgehog boundary --handoff`, which prints where the build is,
what's next and why, and what's blocked, straight from the graph.

Name **both** ways forward, because which one applies depends on what the
user wants next:

- **Adjustments to what's built** — a `tweaker` session, in a *new* chat
  window, not a subagent call inside this one — this session's context
  has been building the whole project and is exactly what "clearing
  context now costs nothing" above means to discard. Tell the user
  plainly: close this chat window and open a new one, then paste this to
  start it:

  > The build is complete. Use the tweaker agent: first review the
  > friction log and ask me for feedback on the build, then take my
  > tweak requests one at a time.

  In the new window, `tweaker` starts clean, reviews the friction log
  (`hedgehog friction list`) once for a possible discipline-improvement
  suggestion, and takes tweak requests one at a time from there.
- **New scope** — a new module, a new integration, anything beyond
  adjusting what exists — goes to `planner`, which runs
  `hedgehog-planning-intake`'s Re-entry pass: it adds intents for the new
  work without re-running planning from scratch, and without disturbing
  anything already built. A completed build is extendable, not sealed.

Don't start making tweaks or planning new scope in the current,
already-large context; that's what the fresh session is for.
