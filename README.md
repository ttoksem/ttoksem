# ttoksem

Implementation repo for the local-first AI task costbook designed in `../ai-usage-ledger-spec`.

Current scope:

- TypeScript pnpm workspace
- Zod v4 schemas for initial ledger inputs and records
- Worker-compatible core service boundary
- SQLite-first local adapter with explicit SQL
- CLI entrypoint for workspace, task, usage, report, and doctor workflows

The product records AI usage and cost. It does not execute LLM calls.

## Currency Policy

ttoksem keeps currency as provenance on cost-bearing usage records:

- `observed_currency`: currency reported with provider-observed cost
- `estimated_currency`: currency used for rule-estimated cost

The MVP does not perform currency conversion, mixed-currency subtotaling, or primary-currency report selection.

In practice, most initial pricing data is expected to be USD. Reports should only show a single currency when all included cost rows use the same currency; mixed or missing currency rows should be surfaced as unknown or warning state instead of silently merged.

## Project Shape

This repo is intentionally a pnpm workspace, not a single `src/` package.

The split is not mainly for public npm publishing. It exists to keep runtime boundaries visible while the implementation grows:

- `@ttoksem/schema`: shared validation and TypeScript types
- `@ttoksem/core`: runtime-neutral ledger behavior
- `@ttoksem/storage`: storage interfaces
- `@ttoksem/storage-sqlite`: local SQLite adapter
- `@ttoksem/cli`: Node.js CLI entrypoint

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning and execution model.

## Examples

- [Conversation Task Assignment](docs/examples/conversation-task-assignment.md): how a chat assistant should map a long conversation to task, run, and usage events without forcing the user to remember commands.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm cli doctor
```

Use `TTOKSEM_DB=/path/to/ttoksem.db` to select a local SQLite file. Without it, the CLI uses `.ttoksem/ttoksem.db` in the current directory.

## Current CLI Slice

```bash
pnpm cli workspace init --key ttoksem-dev --root .
pnpm cli task start implement-chat-usage-logging --workspace ttoksem-dev
pnpm cli usage codex-turn --workspace ttoksem-dev --task implement-chat-usage-logging
pnpm cli inbox list --workspace ttoksem-dev
pnpm cli usage move <usage_id> --workspace ttoksem-dev --task implement-chat-usage-logging
pnpm cli report task implement-chat-usage-logging --workspace ttoksem-dev
```

If `usage codex-turn` is recorded without `--task`, the event remains unassigned and appears in `inbox list`.
