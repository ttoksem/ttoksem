# Changelog

All notable changes to ttoksem are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository is a single-version pnpm workspace — every package under
`packages/*` and `apps/*` ships at the same version.

## [0.1.0] — 2026-04-30

Initial public release. The local-first AI cost ledger reaches a usable
shape across CLI, HTTP API, dashboard, Cloudflare Worker, and the
provider importers.

### Ledger core (`@ttoksem/core`, `@ttoksem/schema`)

- Workspace, task, run, and usage-event records with explicit invariants
- Pricing rules + source snapshots; per-event `pricing_mode`
  (`rule_calculated`, `provider_reported`, `manual`, `unpriced`) so the
  dashboard can flag exactly which events still need a rule
- Run-grouping per assistant prompt for Codex and Claude session imports

### CLI (`@ttoksem/cli`)

- `workspace init`, `task start | switch | close`, `usage record`,
  `pricing snapshot upsert`, `pricing rule upsert`, `pricing import-litellm`
- Importers for Codex and Claude session JSONL with multi-goal preview
  and inbox flow when prompts span more than one task
- `auth key create | list | revoke` for persistent dashboard access keys
- `dashboard serve` boots the local read-only HTTP UI
- DB resolution walks up from `INIT_CWD` to the nearest `.ttoksem/`
  rather than silently spawning a fresh empty SQLite when the CLI runs
  from an unexpected directory

### HTTP API (`@ttoksem/http`, `@ttoksem/server`)

- OpenAPI-described Hono routes for workspaces, tasks, usage events,
  inbox triage, pricing snapshots/rules, and dashboard payloads
- Bearer access-key auth with `dashboard:read` and `api:write` scopes
  (plus `*` wildcard); cookie-backed login for the dashboard UI
- `POST /logout` so dashboard tokens can be rotated without manual
  cookie surgery
- `TTOKSEM_HTTP_DEBUG=1` env flag dumps request + response bodies on
  4xx/5xx for headless-server debugging; stack traces are always logged
  on 500

### Dashboard (`@ttoksem/http` HTML surface)

- Overview KPIs (cost, events, tokens, unpriced); the Unpriced card
  click-throughs to `/pricing#unpriced` and lists the events grouped by
  `provider · model · usage_kind`
- Action-needed banner separates actionable items (assignment, pricing,
  drift) from informational insights (top cost driver)
- Task detail with run timeline scatter, per-event cost distribution,
  hover/jump interactions, and an explicit close-task affordance
- Run detail reconstructs assistant actions from importer-enriched
  `assistant_summary` with a JSONL re-read fallback for older events
- Deep-link routing for `/`, `/inbox`, `/pricing`, `/tasks/:key`,
  `/runs/:runId`
- Inbox combobox sorts tasks by recency, filters by key + name, and
  offers an inline "+ Create '<key>' & assign" path (server creates the
  task on demand without activating it)

### Storage (`@ttoksem/storage`, `@ttoksem/storage-sqlite`, `@ttoksem/storage-d1`)

- SQLite-first local adapter with explicit SQL and migrations
- D1 adapter implementing the same `LedgerStore` surface for the
  Cloudflare Worker entrypoint
- Dashboard breakdown queries (pricing-mode, accuracy-mode, daily costs,
  per-task insights, unpriced provider/model groups)

### Providers (`@ttoksem/providers`)

- Anthropic and OpenAI usage-observation builders
- `summarizeClaudeAssistantContent` — extracts text excerpt, tool
  calls (with per-tool input formatters), and thinking excerpts so run
  traces show what Claude actually did, not just token counts

### Worker (`@ttoksem/worker`)

- D1-backed entrypoint that mounts the same Hono app with cookie + bearer
  auth; documented in `docs/WORKER-D1.md` including a one-shot helper to
  mint an access key and emit the matching SQL `INSERT`

[0.1.0]: https://github.com/ttoksem/ttoksem/releases/tag/v0.1.0
