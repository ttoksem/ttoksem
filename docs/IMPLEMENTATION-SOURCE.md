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
- `report today`
- `report task`
- `doctor`

Deferred from the design source:

- D1 adapter
- Hono HTTP API
- MCP tools
- pricing snapshot import and rule calculation
- correction/adjustment records
- inbox grouping and assignment actions
- run reconciliation

