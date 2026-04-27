# ttoksem

Implementation repo for the local-first AI task costbook designed in `../ai-usage-ledger-spec`.

Current scope:

- TypeScript pnpm workspace
- Zod v4 schemas for initial ledger inputs and records
- Worker-compatible core service boundary
- SQLite-first local adapter with explicit SQL
- CLI entrypoint for workspace, task, usage, report, and doctor workflows

The product records AI usage and cost. It does not execute LLM calls.

## Project Shape

This repo is intentionally a pnpm workspace, not a single `src/` package.

The split is not mainly for public npm publishing. It exists to keep runtime boundaries visible while the implementation grows:

- `@ttoksem/schema`: shared validation and TypeScript types
- `@ttoksem/core`: runtime-neutral ledger behavior
- `@ttoksem/storage`: storage interfaces
- `@ttoksem/storage-sqlite`: local SQLite adapter
- `@ttoksem/cli`: Node.js CLI entrypoint

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning and execution model.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm cli doctor
```

Use `TTOKSEM_DB=/path/to/ttoksem.db` to select a local SQLite file. Without it, the CLI uses `.ttoksem/ttoksem.db` in the current directory.
