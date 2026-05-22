# Changelog

All notable changes to ttoksem are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository is a single-version pnpm workspace — every package under
`packages/*` and `apps/*` ships at the same version.

## [0.2.2] — 2026-05-22

LLM-friendly CLI hardening: explicit required values and structured stderr.

### CLI (`@ttoksem/cli`)

- `usage codex-turn` and `usage claude-turn` now require `--model` explicitly
  (no silent fallback to `"codex-chat"` / `"claude-chat"` that would mismatch
  pricing rules); `codex-turn` gains `--provider` (default `"openai"`,
  overridable for Azure etc.)
- `pricing import-litellm` gains `--currency` (default `"USD"`, overridable)
  instead of a hardcoded value
- `import-codex-sessions` / `import-claude-sessions` now emit a structured
  stderr warning when model or provider metadata is absent in the session file
  and the `--model` / `--provider` fallback fires
- All stderr output follows a consistent machine-readable format:
  `[ttoksem TYPE] CODE key=value … fix=<exact-command>`
  where TYPE is `warn`, `error`, or `info`; LLM callers can grep for the
  prefix to classify output and read `fix=` for the next action

### Worker (`@ttoksem/worker`)

- `TTOKSEM_WORKSPACE_KEY` is now required (no silent `"ttoksem-dev"` fallback);
  `wrangler.jsonc.example` uses a `REPLACE_WITH_YOUR_WORKSPACE_KEY` placeholder
- `defaultWorkspaceKey` in `createHttpApp` (`@ttoksem/http`) is now a required
  field — callers must supply an explicit value

## [0.2.1] — 2026-05-22

Worker deployment workflow fix.

### Worker (`@ttoksem/worker`)

- `apps/worker/wrangler.jsonc` is no longer tracked; a `.example` template
  (`apps/worker/wrangler.jsonc.example`) is committed instead, and the real
  `wrangler.jsonc` (which carries the deployment-specific D1 id and workspace
  key) is gitignored. Deployers copy the template and fill in their values
  without risking git conflicts on a tracked config file.
- `docs/WORKER-D1.md` deploy steps updated to reflect the copy-from-template
  workflow.

## [0.2.0] — 2026-05-21

Project-level configuration for the CLI, plus packaging and CLI polish.

### CLI (`@ttoksem/cli`)

- Project config file `ttoksem.config.json`: the CLI resolves the
  workspace from a committed config file, so commands and agents no
  longer need `--workspace` on every invocation. Resolution precedence
  is `--workspace` flag > `ttoksem.config.json` > `TTOKSEM_WORKSPACE_KEY`
  env var; discovery walks up from the working directory. The schema
  also accepts `promptMode`, `model`, and `remote` for forward
  compatibility (resolution of those is not yet wired).
- `ttoksem init` writes `ttoksem.config.json` for the project,
  idempotently — an existing config is never overwritten.
- `ttoksem init` installs the Claude Code autocapture hook as
  `ttoksem hook run`, which reads the workspace from the config file,
  instead of baking `--workspace <key>` into the hook command.
- Removed the hardcoded `ttoksem-dev` default from `--workspace`;
  commands resolve the workspace through the precedence chain above.
- `ttoksem worker key list` now shows `expires` and `last_used` for
  each access key, matching `auth key list`.

### Packaging

- The `ttoksem` CLI package gained npm publish metadata, a
  package-level README, and an MIT LICENSE; the repository README is
  refocused on the CLI as the published product.

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

[0.2.2]: https://github.com/ttoksem/ttoksem/releases/tag/v0.2.2
[0.2.1]: https://github.com/ttoksem/ttoksem/releases/tag/v0.2.1
[0.2.0]: https://github.com/ttoksem/ttoksem/releases/tag/v0.2.0
[0.1.0]: https://github.com/ttoksem/ttoksem/releases/tag/v0.1.0
