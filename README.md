# Hedgehog PWA App Core ⭐

### Offline-First Apps That Don't Need a Backend

A tracker, a journal, a planner, a small team's board — most apps like
this don't need a server. They need data that's yours, works offline,
and syncs when you're back online.

This core builds exactly that: installable, offline-capable, and
structured to grow without turning into spaghetti.

```mermaid
flowchart LR
    A[Schema] --> B[Repository]
    B --> C[Hook]
    C --> D[Screen]
```

## What you get

- **Next.js + Dexie**, local-first by default — your data lives on the
  device, not behind a round trip.
- **Optional sync and auth via Dexie Cloud**, for a shared list, a
  family calendar, or a small team, without giving up local-first
  reads and writes.
- **A commit gate** (lefthook + commitlint + ESLint guardrails) that
  keeps every layer honest before it lands.

## Built for real personal and small-team apps

Reach for this core when the data fits on a device and belongs to the
person using it — even with sharing, accounts, or a point balance that
needs a server-authoritative record. What pushes a project to a full
backend instead is server-side logic across most of the app: background
jobs, webhooks, or authorization beyond row-level rules.

## Easy to install and use

Ask your agent:
*"Install Hedgehog and build me a [your app idea]"*

<details>
<summary>For your agent</summary>

```
npx @skyf0xx/hedgehog init
```

Hedgehog's planner selects this core automatically when your project's
data fits on a device and belongs to the person using it. You can also
request it directly:

```
npx @skyf0xx/hedgehog init --pwa-app
```

Technical details: [ARCHITECTURE.md](ARCHITECTURE.md)
