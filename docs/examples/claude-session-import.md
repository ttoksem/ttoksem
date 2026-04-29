# Claude Code Session Import

Claude Code writes local session JSONL files under `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (with subagent runs under `<session-id>/subagents/agent-*.jsonl`). Those files include `assistant` events with `message.usage`, which is closer to actual local Claude usage than character-based estimates.

This example is written for Claude Code agents as well as humans. In an agent workflow the user should not have to run this command after every request. The agent, skill, or local workflow hook should call the ttoksem CLI importer when it has access to the local session files.

## Agent-Operated Logging

When a Claude Code agent is working in a ttoksem-tracked workspace, it should treat session import as part of its own operating loop:

```text
1. Choose the current goal task only when the user goal is clear.
2. Omit --task when the goal is ambiguous or the session may span multiple goals.
3. Prefer the current Claude session id (sessionId in the JSONL) when known.
4. Use --since for incremental backfill after the last imported event.
5. Run --dry-run before broad imports.
6. Run the import itself; do not ask the user to type the command.
7. Verify with dashboard overview, task report, or direct event counts.
```

This is still a CLI-based local import, not a background daemon and not provider API billing. The important point is ownership: in an agent workflow, invoking the CLI is the agent's responsibility.

## Basic Import

```bash
pnpm cli usage import-claude-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <claude-session-id> \
  --dry-run
```

If the dry run looks right, run the same command without `--dry-run`:

```bash
pnpm cli usage import-claude-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <claude-session-id>
```

Use `--file <session.jsonl>` when the exact session file is known. Use `--projects-dir <path>` to override the default `~/.claude/projects`. Use `--since <UTC-ISO>` for a recent range. Use `--no-subagents` to skip `subagents/agent-*.jsonl` files; subagent files are imported by default and tagged with `source_context.session.is_subagent = true`.

For an incremental agent import, use the latest imported timestamp as the next lower bound:

```bash
sqlite3 .ttoksem/ttoksem.db \
  "SELECT MAX(occurred_at) FROM usage_events WHERE source='claude-session';"

pnpm cli usage import-claude-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <claude-session-id> \
  --since 2026-04-29T04:06:26.099Z
```

The importer creates one usage event per Claude `assistant` event that carries `message.usage`. It preserves:

- `input_tokens`
- `output_tokens`
- `cached_input_tokens` (mapped from Anthropic `cache_read_input_tokens`)
- `cache_write_input_tokens` (mapped from Anthropic `cache_creation_input_tokens`)
- `total_tokens`
- the latest local `user` event text before the assistant event as `payload.prompt_snapshot.prompt_text`
- a run id per Claude prompt group, so several assistant events caused by the same user prompt share one run
- raw token usage under `payload.usage.raw_usage`
- session metadata under `payload.source_context.session` (id, cwd, version, source, is_subagent, file)
- request id / message id under `payload.source_context`

Imported records use this idempotency key:

```text
claude-session:<session-id>:<assistant-event-uuid>
```

That makes repeated imports safe. Existing records are reused instead of duplicated.

## Pre-Import Preview And Multi-Goal Guard

Every `import-claude-sessions` invocation prints a stderr preview before any writes happen. The preview is the AI's primary judgment basis for the next decision (assign to a task vs. land in the inbox). Sample output:

```text
claude import preview:
  scanned_files=1
  events=4
  prompt_groups=2
  distinct_prompt_hashes=2
  models=claude-sonnet-4-6:4
  time_range=2026-04-29T05:00:05.000Z..2026-04-29T05:01:05.000Z
  tokens_total=47
prompt groups:
  [0001] hash=ab12cd34ef56 events=2 tokens=25 models=claude-sonnet-4-6 prompt="first goal prompt"
  [0002] hash=ff77ee66dd55 events=2 tokens=22 models=claude-sonnet-4-6 prompt="second unrelated prompt"
```

The preview is printed in dry-run, normal, and refusal modes. It always reflects the rows that would be (or were) written, after `--since`/`--limit`/`--no-subagents` filtering.

When `--task` is passed AND the import contains more than one prompt group, the importer **warns** but proceeds (does not refuse):

```text
claude import warning: --task <key> was passed with 2 distinct prompt groups.
All events will be assigned to <key>; if this import covers multiple goals,
move the wrong ones with `pnpm cli usage move <usage_id> --task <key>` or
`pnpm cli inbox assign-event <usage_id> --task <key>` after the fact.
Sample groups:
  [0001] first goal prompt
  [0002] second unrelated prompt
```

This is intentionally a warning, not a refusal. The principle is: surface judgment basis, do not gate the action. The AI agent reads the warning, decides whether the multi-goal import is intended (e.g., follow-up prompts under the same goal) or a mistake to fix with a follow-up `usage move`.

## Multi-Goal Sessions

A single Claude Code session often spans several user goals. The importer does not classify goals — that is a human or higher-level agent decision. When goals are likely to be mixed, **omit `--task`** at import time and assign through the inbox:

```bash
pnpm cli usage import-claude-sessions --workspace ttoksem-dev --file <session.jsonl>
```

All imported events become `assignment_status = unassigned`. The inbox groups them by prompt group (run), so each user prompt becomes one inbox group:

```bash
pnpm cli inbox list --workspace ttoksem-dev
```

```text
inbox_<group_id_1>  prompt="convert AGENT.md to CLAUDE.md format"   events=11  run=run_claude_..._prompt_0001_...
inbox_<group_id_2>  prompt="explain workspace contents"             events=8   run=run_claude_..._prompt_0002_...
inbox_<group_id_3>  prompt="add Claude support to ttoksem"          events=24  run=run_claude_..._prompt_0006_...
inbox_<group_id_4>  prompt="implement claude-import CLI"            events=63  run=run_claude_..._prompt_0007_...
```

Assign each prompt group to its own goal task:

```bash
pnpm cli inbox accept inbox_<group_id_1> --workspace ttoksem-dev --task convert-agent-to-claude-md --all
pnpm cli inbox accept inbox_<group_id_3> --workspace ttoksem-dev --task implement-claude-session-import --all
pnpm cli inbox accept inbox_<group_id_4> --workspace ttoksem-dev --task implement-claude-session-import --all
```

Leave ambiguous prompt groups in the inbox; do not force them into a generic conversation task. Use `inbox assign-event <usage_id>` for fine-grained per-event moves.

The decision rule:

```text
single, clearly-scoped goal across the whole import   -> use --task
mixed goals OR uncertain                              -> omit --task, use the inbox
```

This keeps task-level cost reports honest. See [conversation-task-assignment.md](./conversation-task-assignment.md) for the broader task granularity policy.

## What Gets Stored

Imported session records store usage measurements and the latest user prompt that preceded the assistant event. By default the importer sets `prompt_snapshot.mode = "full"` when local user prompt text is available.

Use a stricter prompt mode when the workspace may contain secrets or unrelated private content:

```bash
pnpm cli usage import-claude-sessions \
  --workspace ttoksem-dev \
  --file <session.jsonl> \
  --prompt-mode redacted
```

Available modes:

```text
full      stores the latest local user prompt as prompt_snapshot.prompt_text
redacted  stores built-in redacted prompt text and keeps source_context.user_message redacted too
hash      stores a SHA-256 prompt_hash under prompt_snapshot, not prompt text
none      stores no prompt_snapshot text or hash
```

The built-in redaction pass masks obvious API keys, bearer tokens, ttoksem access tokens, private-key blocks, credential assignment values, and email addresses. It is intended as a local safety net, not a replacement for deciding whether a workspace should retain prompts at all.

Run grouping is prompt-based inside the Claude session. A Claude session can contain many user requests, and each request can produce several `assistant` events while tools, edits, tests, and final responses happen. ttoksem treats the latest `user` event with text content as the run boundary, not the whole Claude session. That keeps the task detail report useful for finding which prompt/request consumed the most tokens.

User events that are tool results (no text content) do not open a new run. Slash commands like `/model` or `/clear` that Claude Code handles locally without an LLM call also do not produce assistant events, so they may increment the prompt index without contributing usage records.

The importer does not reconstruct the full assistant response. If a workflow needs a manually curated prompt/response pair for a specific turn, record that turn separately with `usage claude-turn` and a deliberate prompt retention policy.

## Pricing

Claude Pro/Max subscription pricing is not the same as Anthropic API billing. ttoksem treats imported Claude session costs as API-style estimates only.

The repository ships an Anthropic API pricing snapshot (`price_snapshot_anthropic_api_<date>`) covering the current Claude model line. For local use, conversation-turn rules are priced as:

```text
claude-sonnet-4-6 / claude-sonnet-4-5
  input_token              3.00 USD / 1M
  output_token            15.00 USD / 1M
  cached_input_token       0.30 USD / 1M
  cache_write_input_token  3.75 USD / 1M

claude-opus-4-7 / claude-opus-4-6 / claude-opus-4-5
  input_token             15.00 USD / 1M
  output_token            75.00 USD / 1M
  cached_input_token       1.50 USD / 1M
  cache_write_input_token 18.75 USD / 1M

claude-haiku-4-5
  input_token              1.00 USD / 1M
  output_token             5.00 USD / 1M
  cached_input_token       0.10 USD / 1M
  cache_write_input_token  1.25 USD / 1M
```

The fallback labels `claude-app` (used by the importer when an assistant event has no model field) and `claude-chat` (used by `usage claude-turn` for manual logging) are priced at Sonnet 4.6 rates by default.

After adding or changing pricing rules, recalculate stored imported events:

```bash
pnpm cli pricing reprice --workspace ttoksem-dev
pnpm cli pricing migrate-events --workspace ttoksem-dev --mode unpriced --limit 500
```

Cache-creation tokens are billed at the 5-minute ephemeral rate by default. If a workspace uses 1-hour ephemeral caching, override the rule with the higher per-token price under the same `cache_write_input_token` unit type.

## Timezone

Session timestamps are stored as UTC ISO text. The local browser dashboard applies the client's timezone only while rendering timestamps and daily dashboard buckets. The stored ledger facts remain UTC.
