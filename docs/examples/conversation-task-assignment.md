# Conversation Task Assignment

This example describes one practical way a chat assistant can record an ongoing conversation into ttoksem.

It is an operating example, not a hard product API contract or a required taxonomy.

Different teams may define tasks differently:

```text
issue-sized tasks
milestone-sized tasks
session-sized tasks
cost-center tasks
research vs implementation tasks
```

The ledger should preserve usage first and make reassignment cheap. It should not require one universal task granularity.

## Rule Of Thumb

One useful default is:

```text
workspace = project or repo
task      = user goal
run       = one conversation, session, or attempt
event     = one model call, response, or logged turn
```

For task-level cost reporting, the task is usually most useful when it means "the user goal I want to price later."

However, session-sized tasks can be valid for teams that only need rough per-conversation cost tracking.

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

The user starts by asking to implement a new repo from the design source.

```text
workspace: ttoksem
task: initialize-implementation-repo
run: codex-thread-2026-04-27
```

Later the user asks to record the chat itself into the ledger.

That is a new user goal, so the assistant should switch task:

```text
workspace: ttoksem
task: implement-chat-usage-logging
run: codex-thread-2026-04-27
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

## Default Behavior

The assistant should not require the user to remember commands for normal logging.

One recommended behavior:

```text
1. If a task is explicit or obvious, record the turn to that task.
2. If the task is not clear, record the event as unassigned or suggested.
3. Let the user correct assignment with explicit commands.
4. Prefer recoverable records over perfect real-time classification.
```

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
usage move
inbox list
bulk assignment later
```

Those tools let users choose their own task granularity after usage is captured.
