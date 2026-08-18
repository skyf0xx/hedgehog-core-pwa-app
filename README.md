# @skyf0xx/hedgehog-core-pwa-app

Hedgehog's pwa-app core: a pre-built, pre-verified Next.js + Dexie
local-first PWA workspace, module-axis build discipline, and the agents
and skills that drive a Hedgehog project built on it.

## Contents

- `workspace/` — the workspace a Hedgehog install copies to a project's
  repo root: Nx configuration, the Next.js app, `src/db`'s Dexie
  instance and table barrel, `tools/generators`, and every enforcement
  file (lefthook, commitlint, ESLint guardrails).
- `agents/` — `pwa-eng`.
- `skills/` — `hedgehog-loop`, `hedgehog-bootstrap-pwa-app-core`.
- `CLAUDE.core.md` — fills a Hedgehog project's root `CLAUDE.md`
  `{{CORE_SECTION}}` placeholder for this core.
- `hedgehog-core.yaml` — this package's manifest: name, flag, the
  selection prose the Hedgehog planner matches a project description
  against, and which agents/skills it carries.

## Using this package

A Hedgehog installation depends on this package for the `pwa-app` core
rather than carrying its content directly. See the Hedgehog engine
(`@skyf0xx/hedgehog`) for the installer and build-graph tooling that
consumes it.

## Working on this core

This is a versioned npm package that the Hedgehog engine's `init`
fetches by name, carrying `pwa-app`'s own agents, skills, a pre-built
workspace, and the `hedgehog-core.yaml` manifest that names all three to
the engine. See the engine repo
([`skyf0xx/hedgehog`](https://github.com/skyf0xx/hedgehog)) and its
[`ARCHITECTURE.md`](https://github.com/skyf0xx/hedgehog/blob/master/ARCHITECTURE.md)
for how `init` resolves and fetches a core package — that mechanism lives
there, not here.

No root `CLAUDE.md` lives in this repo. `CLAUDE.core.md` is a payload
file: its content is installed into a *consuming project's* generated
`CLAUDE.md`, filling that project's `{{CORE_SECTION}}` placeholder. A
plain root `CLAUDE.md` here would auto-load into any coding agent working
on this package itself, bleeding project-build context into a repo where
no Hedgehog build ever runs — build guidance for a project using this
core lives in that project's own generated `CLAUDE.md`, never here.

Changing this core means editing one of: the `workspace/` template (the
scaffold a Hedgehog install copies into a project's repo root), the
`agents/pwa-eng.md` agent, a skill under `skills/`, or a generator under
`workspace/tools/generators/`. A change here is a release of this
package, not of the engine: bump `package.json`'s version, commit, and
merge to `main` — this repo's own `publish.yml` tags and publishes from
there.

`workspace/`'s three generators (`feature`, `entity`, `integration`) are
the deterministic path for every domain-module layer this core's
`core.yaml` defines (`schema`, `repository`, `hook`, `screen`) — the
build agent invokes them rather than authoring that boilerplate
freehand. When a new piece of repeatable scaffolding is needed, extend a
generator rather than hand-writing the output once.
