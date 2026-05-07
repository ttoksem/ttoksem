# Spec — Plan 3: TTOKSEM_TASK env var for shell-scoped autocapture

Date: 2026-05-07
Status: Approved (brainstorming complete; ready for implementation plan)

## Goal

Replace the workspace-level "active task" pointer that Plan 1 removed with a shell-scoped `TTOKSEM_TASK` environment variable. The `.claude/hooks/ttoksem-autocapture.sh` Stop hook reads this env var to decide which task to attribute imported usage events to. When unset, events fall through to the inbox (Plan 1's intended fallback). Deprecate the now-orphaned CLI command `task active` on the standard two-minor-release timeline.

## Why

After Plan 1, `workspace.active_task_id` was dropped. The autocapture hook still calls `pnpm cli task active`, which returns "the most recently started task with status='active'" — a heuristic that is *not* what the user intends. This causes events to be auto-attributed to whatever task happens to be most recent, producing the warning the user has been seeing throughout this work:

> ttoksem-autocapture: active task 'execute-plan1-foundation' has accumulated 39 prompt groups...

A shell-scoped env var matches the user's mental model: "I'm working on goal X right now. Whichever terminal that means." Two terminals can each have their own `TTOKSEM_TASK`. Closing the terminal forgets the scope. No machine-wide pointer to drift out of sync.

Plan 1's MIGRATION.md already promised this behavior; Plan 3 ships it.

## Scope

### In scope

1. Modify `.claude/hooks/ttoksem-autocapture.sh` to read `$TTOKSEM_TASK` instead of calling `pnpm cli task active`.
2. Deprecate `pnpm cli task active` with a stderr warning. Behavior unchanged; sunset 2026-11-07.
3. Add a stderr hint to `pnpm cli task start <key>` reminding the user to `export TTOKSEM_TASK=<key>`.
4. Update `MIGRATION.md` to reflect that `TTOKSEM_TASK` is now shipped, and document `task active` deprecation under the existing Sunset timeline.
5. Add CLI tests covering the new deprecation warning and the `task start` hint.

### Out of scope

- HttpLedgerClient (deferred to Plan 4).
- Any persistent-file fallback for the active task. The design is *shell-scoped*; reintroducing a per-machine fallback would recreate the problem Plan 1 removed.
- Shell wrappers / `.envrc` integrations / direnv hooks. Users who want auto-export per directory can build that themselves; out of scope for the core CLI.
- Removing `task active`. Two-minor-release window per Plan 1 convention.

## Architecture

Three small surfaces touch:

```
┌─ user shell ──────────────────────────────────────────┐
│ export TTOKSEM_TASK=design-feature                    │
│ # ... work in Claude Code session ...                 │
│                                                       │
│ Claude Code Stop hook fires:                          │
│   ttoksem-autocapture.sh                              │
│     reads $TTOKSEM_TASK ─────────────┐                │
│     pnpm cli usage import-claude-...─┘                │
│       --task design-feature  (if env set)             │
│       (omit --task)          (if env unset → inbox)   │
└───────────────────────────────────────────────────────┘
```

### Hook script (`.claude/hooks/ttoksem-autocapture.sh`)

Replace the `ACTIVE_TASK=$(pnpm cli task active ...)` line with a direct env-var read:

```bash
ACTIVE_TASK="${TTOKSEM_TASK:-}"
```

Everything downstream stays the same. The drift-warning logic (prompt-groups accumulation threshold and "no active task" warning when events landed in inbox) continues to fire under the same conditions.

### CLI: `task active` deprecation

Add a stderr deprecation banner at the start of the action body, before any logic:

```ts
process.stderr.write(
  "[deprecation] `task active` is going away in two minor releases. " +
  "Use `echo $TTOKSEM_TASK` for the current shell-scoped task, or " +
  "`task list` to see tasks with status='active'. " +
  "See MIGRATION.md#task-active.\n",
);
```

The command's existing behavior (print the most-recently-started active-status task key, or nothing) is preserved.

### CLI: `task start` hint

After the existing success line, add a stderr hint:

```ts
process.stderr.write(
  `hint: export TTOKSEM_TASK=${started.key}  # autocapture will attribute future events to this task\n`,
);
```

stdout (`task <key> <status> <id> <name>`) is unchanged — scripts that parse the output still work.

### MIGRATION.md updates

- Replace the "TTOKSEM_TASK is not yet shipped" caveat with a "TTOKSEM_TASK is now the canonical way to scope autocapture" note.
- Add `task active` to the deprecation table with the same sunset window (deprecated 2026-05-07, removed 2026-11-07).
- Update the CLI before/after example to drop the "(Plan 3 not yet shipped)" comment.

## Tests

### CLI

Add to `packages/cli/src/index.test.ts`:

- A test that asserts `task active` writes the `[deprecation]` banner to stderr and still exits 0 with the expected stdout.
- A test that asserts `task start <key>` writes the `hint: export TTOKSEM_TASK=<key>` line to stderr.

### Hook script

The bash hook is not covered by Vitest. Verify manually:

```bash
# Without env var
unset TTOKSEM_TASK
bash .claude/hooks/ttoksem-autocapture.sh
# Expect: import without --task, events to inbox

# With env var
export TTOKSEM_TASK=ops-idle
bash .claude/hooks/ttoksem-autocapture.sh
# Expect: import with --task ops-idle
```

## Backward compatibility

- The `task active` CLI command keeps working through Sunset.
- The hook continues to handle the unset case gracefully (events to inbox — same as Plan 1's intended state).
- No DB migration, no HTTP route changes, no schema changes.
- Users with shell scripts that grepped `task active` output keep working; only stderr changes.

## File touch list

| Path | Change |
|---|---|
| `.claude/hooks/ttoksem-autocapture.sh` | Replace `pnpm cli task active` lookup with `${TTOKSEM_TASK:-}` |
| `packages/cli/src/index.ts` | Add deprecation banner to `task active`; add hint to `task start` |
| `packages/cli/src/index.test.ts` | Two new tests for the warnings |
| `MIGRATION.md` | Drop "not yet shipped" caveat; add `task active` row; update timeline |

## Sunset timeline

| Item | Deprecated | Removed |
|---|---|---|
| `pnpm cli task active` | 2026-05-07 | 2026-11-07 |

(Joins the existing entries from Plan 1: `task close` CLI, `POST /api/tasks/{taskKey}/close` HTTP.)

## Open questions

None. All design decisions captured above:
- Hook fallback: inbox (matches Plan 1).
- `task active` future: deprecate-then-remove (Plan 1 pattern).
- `task start` UX: stderr hint (no eval/--export flag — out of scope).
