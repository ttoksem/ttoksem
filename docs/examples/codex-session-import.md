# Codex Session Import

Codex App/CLI writes local session JSONL files under `~/.codex/sessions`. Those files include `token_count` events with `info.last_token_usage`, which is closer to actual local Codex usage than character-based estimates.

This example is written for Codex agents as well as humans. In a Codex workflow, the user should not have to run this command after every request. The agent, skill, or local workflow hook should call the ttoksem CLI importer when it has access to the local session files.

## Agent-Operated Logging

When a Codex agent is working in a ttoksem-tracked workspace, it should treat session import as part of its own operating loop:

```text
1. Choose the current goal task if the user goal is clear.
2. Omit --task when the goal is ambiguous so usage lands in the inbox.
3. Prefer the current thread id when available.
4. Use --since for incremental backfill after the last imported event.
5. Run --dry-run before broad imports.
6. Run the import itself; do not ask the user to type the command.
7. Verify with dashboard overview, task report, or direct event counts.
```

This is still a CLI-based local import, not a background daemon and not provider API billing. The important point is ownership: in an agent workflow, invoking the CLI is the agent's responsibility.

## Basic Import

```bash
pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <codex-thread-id> \
  --model gpt-5.5 \
  --dry-run
```

If the dry run looks right, run the same command without `--dry-run`:

```bash
pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <codex-thread-id> \
  --model gpt-5.5
```

Use `--file <session.jsonl>` when the exact session file is known. Use `--since <UTC-ISO>` for a recent range. If the current user goal is ambiguous, omit `--task`; the imported events remain unassigned for later inbox cleanup. `ttoksem inbox list` groups those events by day and source context, `ttoksem inbox show <group_id>` explains the sample events, and `ttoksem inbox assign <group_id> --task <task_key> --all` performs explicit bulk assignment. Do not keep passing an old task key just because it was used in the previous import.

For an incremental agent import, use the latest imported timestamp as the next lower bound:

```bash
sqlite3 .ttoksem/ttoksem.db \
  "SELECT MAX(occurred_at) FROM usage_events WHERE source='codex-session';"

pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <codex-thread-id> \
  --model gpt-5.5 \
  --since 2026-04-28T04:23:05.263Z
```

The importer creates one usage event per `token_count.info.last_token_usage` item. It preserves:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`
- the latest Codex `user_message` before the token count as `payload.prompt_snapshot.prompt_text`
- a run id per Codex prompt group, so multiple `token_count` events caused by the same user prompt are shown as one run
- raw token usage under `payload.usage.raw_usage`
- session metadata under `payload.source_context.session`

Imported records use this idempotency key:

```text
codex-session:<thread-id>:<timestamp>
```

That makes repeated imports safe. Existing records are reused instead of duplicated.

## Pre-Import Preview And Multi-Goal Guard

Every `import-codex-sessions` invocation prints a stderr preview before any writes happen. The preview is the AI's primary judgment basis for the next decision (assign to a task vs. land in the inbox). It lists prompt groups, distinct prompt hashes, time range, model distribution, and per-group event/token counts.

When `--task` is passed AND the import contains more than one prompt group, the importer **warns** but proceeds. The warning lists sample groups and suggests `pnpm cli usage move` / `pnpm cli inbox assign-event` to relocate any events that don't belong under the chosen task. The warning is judgment basis, not a gate — the AI decides whether to act on it.

See [Claude Code Session Import — Pre-Import Preview And Multi-Goal Guard](./claude-session-import.md#pre-import-preview-and-multi-goal-guard) for sample output; the Codex importer prints the same shape with the `codex import` label.

## What Gets Stored

Imported session records store usage measurements and the latest user prompt that preceded the token count. By default the importer sets `prompt_snapshot.mode = "full"` when a local `user_message` is available.

Use a stricter prompt mode when the workspace may contain secrets or unrelated private content:

```bash
pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task <current-goal-task-key> \
  --thread-id <codex-thread-id> \
  --model gpt-5.5 \
  --prompt-mode redacted
```

Available modes:

```text
full      stores the latest local user_message as prompt_snapshot.prompt_text
redacted  stores built-in redacted prompt text and keeps source_context.user_message redacted too
hash      stores a SHA-256 prompt_hash under prompt_snapshot, not prompt text
none      stores no prompt_snapshot text or hash
```

The built-in redaction pass masks obvious API keys, bearer tokens, ttoksem access tokens, private-key blocks, credential assignment values, and email addresses. It is intended as a local safety net, not a replacement for deciding whether a workspace should retain prompts at all.

Run grouping is prompt-based inside the Codex session. A Codex session can contain many user requests, and each request can produce several `token_count` events while tools, edits, tests, and final responses happen. ttoksem treats the latest `user_message` group as the run boundary, not the whole Codex session. That keeps the task detail report useful for finding which prompt/request consumed the most tokens.

The importer does not reconstruct the full assistant response. If a workflow needs a manually curated prompt/response pair for a specific turn, record that turn separately with `usage codex-turn` and a deliberate prompt retention policy.

## Pricing

Codex subscription pricing is not the same as OpenAI API billing. ttoksem treats imported Codex session costs as API-style estimates only.

For current local usage, `openai/gpt-5.5` conversation turns are priced with:

```text
input_token         5.00 USD / 1M
cached_input_token  0.50 USD / 1M
output_token       30.00 USD / 1M
```

After adding or changing pricing rules, recalculate stored imported events:

```bash
pnpm cli pricing migrate-events \
  --workspace ttoksem-dev \
  --mode unpriced \
  --limit 500
```

## Timezone

Session timestamps are stored as UTC ISO text. The local browser dashboard applies the client's timezone only while rendering timestamps and daily dashboard buckets. The stored ledger facts remain UTC.
