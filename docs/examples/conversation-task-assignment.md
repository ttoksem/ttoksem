# Conversation Task Assignment

This example describes one practical way a chat assistant can record an ongoing conversation into ttoksem.

It is an operating example, not a hard product API contract or a required taxonomy.

Different teams may define tasks differently:

```text
issue-sized tasks
milestone-sized tasks
cost-center tasks
research vs implementation tasks
```

The ledger should preserve usage first and make reassignment cheap. It should not require one universal task granularity.

## Rule Of Thumb

One useful default is:

```text
workspace = project or repo
task      = user goal
run       = one explicit execution, request, job, or attempt
event     = one model call, response, or logged turn
```

For task-level cost reporting, the task is usually most useful when it means "the user goal I want to price later."

Good task names:

```text
implement-chat-usage-logging
fix-cli-db-path-resolution
document-currency-policy
```

Usually less useful for goal-level reporting:

```text
current-conversation
latest-question
readme-change
```

## Example Conversation

The user starts by asking to bootstrap a new implementation repo.

```text
workspace: ttoksem
task: initialize-implementation-repo
usage_event: codex conversation_turn
```

Later the user asks to record the chat itself into the ledger.

That is a new user goal, so the assistant should switch task:

```text
workspace: ttoksem
task: implement-chat-usage-logging
usage_event: codex conversation_turn
```

This could be one task, but it may become too broad as the work grows:

```text
usage_event: add codex-turn command
usage_event: store full prompt snapshots
usage_event: fix CLI default DB path
usage_event: clarify currency policy
usage_event: document conversation assignment example
```

If the user wants more precise accounting, split it into goal-sized tasks:

```text
task: implement-codex-turn-logging
  usage_event: add codex-turn command
  usage_event: store full prompt snapshots
  usage_event: fix CLI default DB path

task: define-conversation-task-policy
  usage_event: define task/run/event boundary
  usage_event: discuss slash command overrides
  usage_event: decide ambiguous turns stay unassigned

task: build-inbox-assignment-tools
  usage_event: add inbox list
  usage_event: add usage move
```

## Repeated Work Example

When the same user goal repeats, keep the same task and create a new run for each execution only when a run is useful.

Example: refresh a pricing catalog every day.

```text
task: refresh-pricing-catalog

run: run_refresh_pricing_20260427
  usage_event: fetch LiteLLM snapshot
  usage_event: normalize pricing rules
  usage_event: reprice unpriced usage

run: run_refresh_pricing_20260428
  usage_event: fetch LiteLLM snapshot
  usage_event: normalize pricing rules
  usage_event: reprice unpriced usage
```

Do not create a new task for every repeated execution if the accounting question is still the same:

```text
less useful:
  refresh-pricing-catalog-20260427
  refresh-pricing-catalog-20260428

more useful:
  task: refresh-pricing-catalog
  runs: one per execution
```

Create separate tasks only when each repetition is a distinct user-facing deliverable that should be reported independently.

## Default Behavior

The assistant should not require the user to remember commands for normal logging.

One recommended behavior:

```text
1. If a task is explicit or obvious, record the turn to that task.
2. If the task is not clear, record the event as unassigned or suggested.
3. Let the user correct assignment with explicit commands.
4. Prefer recoverable records over perfect real-time classification.
5. When local Codex session logs are available, the assistant should run
   usage import-codex-sessions itself instead of asking the user to run it.
```

In other words, "manual" means "CLI-based local import" rather than "the user must type the CLI command." A Codex agent, local skill, or workflow hook can own the CLI call.

## Topic Change Signals

Keep the current task when the request is part of the same user goal:

```text
bug check after the feature
README update for the feature
small design clarification
commit or push for the same change
```

Suggest a new task when the request changes the goal, if the workspace uses goal-sized tasks:

```text
different repo or workspace
different deliverable
new setup or debugging target
new research topic unrelated to the current implementation
```

## Long Sessions Crossing Multiple Goals

A single Codex or Claude Code session can span several user goals. The session importers do not classify goals — they only group events by prompt run. When a long session is likely to contain mixed goals, **omit `--task` at import time** so events land in the inbox, then assign per prompt group:

```bash
pnpm cli usage import-claude-sessions --workspace ttoksem-dev --file <session.jsonl>
pnpm cli usage import-codex-sessions  --workspace ttoksem-dev --thread-id <thread-id>
```

```bash
pnpm cli inbox list --workspace ttoksem-dev
pnpm cli inbox accept inbox_<group_id_a> --workspace ttoksem-dev --task convert-agent-to-claude-md --all
pnpm cli inbox accept inbox_<group_id_b> --workspace ttoksem-dev --task implement-claude-session-import --all
```

Decision rule for the importer's `--task` flag:

```text
single goal across the whole import        -> pass --task
mixed goals OR uncertain                   -> omit --task, use the inbox
ambiguous prompt group inside a mixed run  -> leave it in inbox; do not force-assign
```

Forcing every event into one task because a `--task` was already typed once is a common mistake. Importers are bulk operations, not turn-by-turn classifiers; the inbox is the classifier surface.

The CLI helps with this: every `import-codex-sessions` and `import-claude-sessions` invocation prints a stderr preview (events, distinct prompt groups, model distribution, time range, per-group prompt snippets). When `--task` is passed AND the import contains more than one prompt group, the CLI also prints a stderr warning suggesting `pnpm cli usage move` to relocate any events that turn out to belong under a different goal. The warning is judgment basis, not a gate — the AI/user decides whether to act on it.

See also: [Codex Session Import](./codex-session-import.md), [Claude Code Session Import](./claude-session-import.md).

## Slash Commands As Overrides

Slash or text commands are useful, but they should be overrides rather than the main workflow.

Possible command shape:

```text
/task start implement-chat-usage-logging
/task switch document-currency-policy
/task same
/task split
/task inbox
/task close
```

The assistant should still log usage even when the user forgets these commands. If assignment is unclear, leave the event unassigned.

Example:

```text
assistant:
  Topic appears to have changed. I will record this as unassigned unless you want
  it under `document-currency-policy`.
```

## Confidence Policy

A practical assignment policy for goal-sized tasks:

```text
confidence >= 0.75
  assign to the selected task automatically

0.45 <= confidence < 0.75
  record as suggested or unassigned and ask a short confirmation

confidence < 0.45
  record to inbox/unassigned
```

The ledger should prefer recoverable records over perfect real-time classification.

## Product Guidance

Do not hard-code this example as the only valid task model.

The product should provide:

```text
unassigned usage
suggested assignment
inbox list
inbox show
inbox accept suggested task
inbox assign group --all
inbox assign-event
```

Those tools let users choose their own task granularity after usage is captured.
