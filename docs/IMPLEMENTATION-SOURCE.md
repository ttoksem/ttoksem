# Implementation Source

This repo implements the design source in:

```text
../ai-usage-ledger-spec
```

Initial implementation decisions mapped from that repo:

- TypeScript pnpm workspace package boundaries from `docs/design/runtime-stack.md`
- Zod v4 validation from `docs/adrs/ADR-0009-initial-validation-and-sql-adapters.md`
- SQLite-first explicit SQL adapter from `docs/design/persistence-schema.md`
- CLI-first setup/debug/report surface from `docs/design/command-surface.md`
- `ai.usage.observed` canonical ingest shape from `specs/schema/ai-usage-observed.schema.json`

Implemented first slice:

- `workspace init/current/list`
- `task start/close/list`
- `usage add`
- `usage codex-turn`
- `usage import-codex-sessions`
- `usage move`
- `inbox list`
- `auth key create/list/revoke`
- run grouping through explicit `run_id`
- pricing source snapshots
- LiteLLM pricing import
- pricing rules, repricing, and event-time pricing migration
- `report today`
- `report task`
- `dashboard overview`
- read-only local Hono dashboard
- access-key guard for dashboard/API data
- `doctor`

Deferred from the design source:

- D1 adapter
- MCP tools
- correction/adjustment records
- write-capable HTTP API
- write-scope enforcement for future HTTP/MCP mutation routes
- provider SDK collectors with exact provider usage capture
- cross-currency reporting
- prompt redaction automation
