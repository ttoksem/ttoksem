# ttoksem

Implementation repo for the local-first AI task costbook designed in `../ai-usage-ledger-spec`.

Current scope:

- TypeScript pnpm workspace
- Zod v4 schemas for initial ledger inputs and records
- Worker-compatible core service boundary
- SQLite-first local adapter with explicit SQL
- Cloudflare D1 adapter and Worker entrypoint
- CLI entrypoint for workspace, task, usage, report, dashboard, and doctor workflows
- Hono HTTP package and local server entrypoint for the dashboard and write API
- Database access-key guard for local dashboard/API data

The product records AI usage and cost. It does not execute LLM calls.

## MVP Checkpoint

The current MVP is a local cost ledger for AI usage. It supports workspace and task setup, usage ingest, chat turn logging, Codex App/CLI session import, prompt snapshot retention/redaction modes, OpenAI SDK response usage capture, inbox reassignment, run grouping, pricing source snapshots, LiteLLM pricing import, event-time repricing, task/day cost reports, CLI dashboard summaries, persistent database access keys, a local Hono dashboard, write-capable HTTP API routes, and a D1-backed Worker entrypoint.

Post-MVP scope includes optional deferred MCP-facing assignment workflows.

## Currency Policy

ttoksem keeps currency as provenance on cost-bearing usage records:

- `observed_currency`: currency reported with provider-observed cost
- `estimated_currency`: currency used for rule-estimated cost

ttoksem does not perform currency conversion, mixed-currency subtotaling, or primary-currency report selection.

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
cached_input_token
cache_write_input_token
reasoning_output_token
audio_input_token
audio_output_token
total_token
request
second
image
```

If a matching rule exists, usage is stored with `pricing_mode=rule_calculated`, `estimated_cost_nanos`, `estimated_currency`, pricing rule ids, pricing source snapshot ids, and `cost_calculated_at`. If no matching rule exists, the usage remains `pricing_mode=unpriced` with `unpriced_reason=missing_pricing_rule`.

Existing unpriced events can be recalculated after rules are added with `pricing reprice`.
Existing `unpriced` and `rule_calculated` events can be migrated against the current active rules with `pricing migrate-events`. This updates the denormalized pricing projection columns while preserving the original ingest `payload_json` as evidence.

## Usage Timing Policy

`occurred_at` remains the canonical event time for ordering and reporting. Usage records may also carry optional execution timing:

- `started_at`: when the measured assistant/model work started
- `ended_at`: when that work ended
- `duration_ms`: elapsed time in milliseconds

If `started_at` and `ended_at` are present but `duration_ms` is omitted, the core service derives `duration_ms`. Missing timing fields are allowed so lightweight/manual logging stays simple.

Stored timestamps are UTC ISO text. The browser dashboard keeps those source values unchanged and applies the client's timezone only while rendering timestamps and daily dashboard buckets. CLI reports remain UTC-oriented unless a later reporting command adds an explicit timezone option.

## Prompt Retention Policy

`usage chat-turn` and `usage import-codex-sessions` default to `--prompt-mode full` for local Codex logging, because the task and run reports use prompt samples to explain where tokens were spent.

Sensitive workspaces can choose stricter modes:

```text
full      store prompt/response text as provided
redacted  store text after built-in secret, token, private-key, and email redaction
hash      store SHA-256 hashes in prompt_snapshot, not text
none      store no prompt_snapshot text or hash
```

Redacted mode also avoids copying the original Codex `user_message` into source context, so dashboard and inbox samples read from the sanitized prompt text. This redaction is a local safety net, not a DLP product; do not intentionally paste secrets into usage records.

## Run Policy

A run groups multiple usage events from one explicit request, job, or attempt.

Inputs do not require a session concept. For ordinary one-off usage records, omit run fields and record the usage directly to a task or inbox. When an integration needs to group several measurable events, pass an explicit `run_id`; the core service creates or reuses that run, stores its `run_id` on each usage event, and reconciles the run's start/end range from attached usage.

Usage can still be recorded without a run. That keeps one-off/manual logging simple while allowing RAG, API, and tool workflows to group related events when the caller has enough context.

## Access Key Policy

ttoksem does not model users, passwords, sessions, organizations, or RBAC in the MVP. Local CLI commands use the OS user boundary.

Dashboard/API data is protected by database access keys. Tokens are shown once, while only `token_hash` and `token_prefix` are stored. Read-only dashboard APIs require `dashboard:read`; HTTP mutation routes require `api:write`. A key can optionally be restricted to specific workspace keys.

See [docs/ACCESS-AUTH.md](docs/ACCESS-AUTH.md) for the current policy and commands.

## Project Shape

This repo is intentionally a pnpm workspace, not a single `src/` package.

The split is not mainly for public npm publishing. It exists to keep runtime boundaries visible while the implementation grows:

- `@ttoksem/schema`: shared validation and TypeScript types
- `@ttoksem/core`: runtime-neutral ledger behavior
- `@ttoksem/providers`: provider SDK response mappers
- `@ttoksem/storage`: storage interfaces
- `@ttoksem/storage-sqlite`: local SQLite adapter
- `@ttoksem/storage-d1`: Cloudflare D1 adapter for Worker deployments
- `@ttoksem/http`: Hono routes for local dashboard/API surfaces
- `@ttoksem/cli`: Node.js CLI entrypoint
- `@ttoksem/server`: local Node server entrypoint under `apps/server`
- `@ttoksem/worker`: Cloudflare Worker entrypoint under `apps/worker`

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning and execution model.

## Examples

- [Conversation Task Assignment](docs/examples/conversation-task-assignment.md): how a chat assistant should map a long conversation to task, run, and usage events without forcing the user to remember commands.
- [Access Key Auth](docs/ACCESS-AUTH.md): how local dashboard/API access is guarded without adding user accounts or RBAC.
- [Codex Session Import](docs/examples/codex-session-import.md): how Codex agents or local hooks should import Codex App/CLI `token_count` records from local session JSONL files.
- [OpenAI SDK Collector](docs/examples/openai-sdk-collector.md): how to turn OpenAI SDK response usage into exact ttoksem usage events.
- [Worker D1 Deployment](docs/WORKER-D1.md): how the D1-backed Worker entrypoint is wired.
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
pnpm cli pricing import-litellm --workspace ttoksem-dev --source-snapshot-id price_snapshot_example --file .ttoksem/pricing-snapshots/litellm-model-prices.json
pnpm cli pricing upsert --workspace ttoksem-dev --source-snapshot-id price_snapshot_example --provider openai --model codex-chat --usage-kind conversation_turn --unit-type input_token --price 0.10 --per 1000000 --effective-from 2026-01-01T00:00:00.000Z
pnpm cli pricing upsert --workspace ttoksem-dev --source-snapshot-id price_snapshot_example --provider openai --model codex-chat --usage-kind conversation_turn --unit-type output_token --price 0.50 --per 1000000 --effective-from 2026-01-01T00:00:00.000Z
pnpm cli usage chat-turn --workspace ttoksem-dev --task implement-chat-usage-logging --started-at 2026-04-27T05:00:00.000Z --ended-at 2026-04-27T05:00:03.000Z
pnpm cli usage openai-response --workspace ttoksem-dev --task implement-chat-usage-logging --file ./openai-response.json --operation chat.completions.create
pnpm cli usage import-codex-sessions --workspace ttoksem-dev --task implement-chat-usage-logging --thread-id <codex_thread_id> --model gpt-5.5 --dry-run
pnpm cli usage import-codex-sessions --workspace ttoksem-dev --task implement-chat-usage-logging --thread-id <codex_thread_id> --model gpt-5.5
pnpm cli pricing reprice --workspace ttoksem-dev
pnpm cli pricing migrate-events --workspace ttoksem-dev
pnpm cli auth key create --name "hwanghee dashboard" --scope dashboard:read
pnpm cli auth key create --name "http writer" --scope api:write --workspace-scope ttoksem-dev
pnpm cli inbox list --workspace ttoksem-dev
pnpm cli inbox show <inbox_group_id> --workspace ttoksem-dev
pnpm cli inbox accept <inbox_group_id> --workspace ttoksem-dev --all
pnpm cli inbox assign <inbox_group_id> --workspace ttoksem-dev --task implement-chat-usage-logging --all
pnpm cli inbox assign-event <usage_id> --workspace ttoksem-dev --task implement-chat-usage-logging
pnpm cli report task implement-chat-usage-logging --workspace ttoksem-dev
pnpm cli dashboard serve --workspace ttoksem-dev --port 4317
```

If `usage chat-turn` or `usage import-codex-sessions` is recorded without `--task`, the event remains unassigned and appears in `inbox list`. The default inbox view is group-based; use `inbox list --events` for the raw event list. `usage codex-turn` remains available as the current Codex logging compatibility command.

For Codex-agent workflows, `usage import-codex-sessions` is intended to be called by the agent, skill, or local hook as part of the work loop. The user should not need to run the import command manually after each request.
