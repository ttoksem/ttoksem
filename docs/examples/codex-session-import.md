# Codex Session Import

Codex App/CLI writes local session JSONL files under `~/.codex/sessions`. Those files include `token_count` events with `info.last_token_usage`, which is closer to actual local Codex usage than manual character-based estimates.

ttoksem can import those records manually through the CLI:

```bash
pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task improve-wide-task-dashboard \
  --thread-id 019dd187-51b3-7e02-b2dc-311a2b503dd2 \
  --model gpt-5.5 \
  --dry-run
```

If the dry run looks right, run the same command without `--dry-run`:

```bash
pnpm cli usage import-codex-sessions \
  --workspace ttoksem-dev \
  --task improve-wide-task-dashboard \
  --thread-id 019dd187-51b3-7e02-b2dc-311a2b503dd2 \
  --model gpt-5.5
```

Use `--file <session.jsonl>` when the exact session file is known. Use `--since <UTC-ISO>` for a recent range. If the current user goal is ambiguous, omit `--task`; the imported events remain unassigned for later inbox cleanup.

The importer creates one usage event per `token_count.info.last_token_usage` item. It preserves:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`
- raw token usage under `payload.usage.raw_usage`
- session metadata under `payload.source_context.session`

Imported records use this idempotency key:

```text
codex-session:<thread-id>:<timestamp>
```

That makes repeated imports safe. Existing records are reused instead of duplicated.

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
