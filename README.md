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

## Pricing Rule Policy

Pricing source snapshots record where a provider price catalog came from. Pricing rules are normalized rows imported from, or manually tied to, those snapshots. This keeps cost calculations auditable without parsing raw provider files during reports.

Snapshot metadata includes source name, source URL/version/commit, retrieval/bundle timestamps, `raw_sha256`, optional raw storage reference, and metadata JSON. Pricing rules can reference a snapshot through `source_snapshot_id`.

Pricing rules convert usage units into estimated cost when provider-observed cost is missing. Rules are scoped to a workspace and matched by:

```text
provider + model + usage_kind + unit_type + effective time
```

Supported unit types are intentionally string-based. Common values are:

```text
input_token
output_token
total_token
request
second
image
```

If a matching rule exists, usage is stored with `pricing_mode=rule_calculated`, `estimated_cost_nanos`, `estimated_currency`, pricing rule ids, pricing source snapshot ids, and `cost_calculated_at`. If no matching rule exists, the usage remains `pricing_mode=unpriced` with `unpriced_reason=missing_pricing_rule`.

Existing unpriced events can be recalculated after rules are added with `pricing reprice`.

## Usage Timing Policy

`occurred_at` remains the canonical event time for ordering and reporting. Usage records may also carry optional execution timing:

- `started_at`: when the measured assistant/model work started
- `ended_at`: when that work ended
- `duration_ms`: elapsed time in milliseconds

If `started_at` and `ended_at` are present but `duration_ms` is omitted, the core service derives `duration_ms`. Missing timing fields are allowed so lightweight/manual logging stays simple.

## Run Policy

A run groups multiple usage events from one explicit request, job, or attempt.

Inputs do not require a session concept. For ordinary one-off usage records, omit run fields and record the usage directly to a task or inbox. When an integration needs to group several measurable events, pass an explicit `run_id`; the core service creates or reuses that run and stores its `run_id` on each usage event.

Usage can still be recorded without a run. That keeps one-off/manual logging simple while allowing RAG, API, and tool workflows to group related events when the caller has enough context.

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
- [Token Estimation Examples](docs/examples/token-estimation.md): how an assistant should fill token counts and provenance when provider usage is missing.
- [Usage Event Taxonomy](docs/examples/usage-event-taxonomy.md): how to record RAG, API calls, tools, media, storage, and other measurable operations.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm cli doctor
```

Use `TTOKSEM_DB=/path/to/ttoksem.db` to select a local SQLite file. Without it, the CLI uses `.ttoksem/ttoksem.db` in the current directory.

## Current CLI Slice

The pricing numbers below are example rules, not provider price guidance.

```bash
pnpm cli workspace init --key ttoksem-dev --root .
pnpm cli task start implement-chat-usage-logging --workspace ttoksem-dev
pnpm cli pricing snapshot upsert --id price_snapshot_example --source-name litellm --raw-sha256 sha256:example --source-commit example --valid-from 2026-01-01T00:00:00.000Z
pnpm cli pricing upsert --workspace ttoksem-dev --source-snapshot-id price_snapshot_example --provider openai --model codex-chat --usage-kind conversation_turn --unit-type input_token --price 0.10 --per 1000000 --effective-from 2026-01-01T00:00:00.000Z
pnpm cli pricing upsert --workspace ttoksem-dev --source-snapshot-id price_snapshot_example --provider openai --model codex-chat --usage-kind conversation_turn --unit-type output_token --price 0.50 --per 1000000 --effective-from 2026-01-01T00:00:00.000Z
pnpm cli usage codex-turn --workspace ttoksem-dev --task implement-chat-usage-logging --started-at 2026-04-27T05:00:00.000Z --ended-at 2026-04-27T05:00:03.000Z
pnpm cli pricing reprice --workspace ttoksem-dev
pnpm cli inbox list --workspace ttoksem-dev
pnpm cli usage move <usage_id> --workspace ttoksem-dev --task implement-chat-usage-logging
pnpm cli report task implement-chat-usage-logging --workspace ttoksem-dev
```

If `usage codex-turn` is recorded without `--task`, the event remains unassigned and appears in `inbox list`.
