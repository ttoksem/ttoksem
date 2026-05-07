# Migration Guide

## Active task removal + archive rename

> **Pre-1.0 caveat.** ttoksem is at `0.x`; the version numbers used below
> are placeholders for the minor releases that ship the changes described
> here. The Sunset _date_ (`2026-11-07`) is what's contractual, not a
> specific semver bump.

### What changed

1. **Workspace-level "active task" is removed.** The
   `workspace.active_task_id` column is dropped from the database;
   `LedgerStore.setActiveTask` and `GET /api/tasks/active` are gone.
   The CLI command `task start <key>` no longer marks the task as the
   workspace's "current" one.
2. **`task close` is renamed to `task archive`.** Both work for two
   minor releases; `task close` prints a deprecation warning. After the
   Sunset date, `task close` is removed.
3. **`closeTask` requires `key`.** Previously, calling
   `service.closeTask` or the CLI `task close` without a key would
   close the workspace's active task. With active task gone, `key` is
   required.

### Why

A workspace-level active-task pointer breaks down with multi-machine,
multi-terminal, multi-agent workflows: only one of N concurrent
contexts can "own" the pointer at a time, and the others either
clobber it or silently log to the wrong task. See ADR-0010.

### How to migrate

#### CLI users

Before:

```bash
pnpm cli task start design-feature --workspace ws
# ... do work; autocapture infers task from workspace.active_task_id
pnpm cli task close
```

After:

```bash
export TTOKSEM_TASK=design-feature   # set per shell / per agent
pnpm cli task start design-feature --workspace ws
# ... do work
pnpm cli task archive design-feature --workspace ws
unset TTOKSEM_TASK
```

This is the canonical workflow. The autocapture Stop hook reads
`$TTOKSEM_TASK` directly: when set, imported events are attributed to
that task; when unset, events fall through to the inbox for later
classification via `pnpm cli inbox accept`. Because the variable is
shell-scoped, two terminals can each have their own active task
without collision.

The CLI command `pnpm cli task start <key>` now prints a stderr hint
suggesting the matching `export TTOKSEM_TASK=<key>` line, so you don't
have to remember to copy the key by hand.

The previous `pnpm cli task active` command is deprecated (see the
sunset table below). Use `echo $TTOKSEM_TASK` for the current
shell-scoped task, or `task list` to see tasks with `status='active'`
in the ledger.

#### Database migration

The schema migration `0008_drop_active_task_id` runs automatically the
first time you start the CLI/server after upgrading. It rebuilds the
`workspaces` table without the `active_task_id` column. The migration
is forward-only and idempotent — running it again on an
already-migrated database is a no-op.

If you want to inspect existing `active_task_id` values before they're
dropped:

```bash
sqlite3 .ttoksem/ttoksem.db "SELECT key, active_task_id FROM workspaces"
```

The migration runs in a single transaction; if it fails partway, the
DB rolls back to the previous state.

#### HTTP clients

- `GET /api/tasks/active` returns **410 Gone**. Response includes
  `Deprecation` and `Sunset` headers. Stop calling it. Track the
  active task client-side (e.g. via your shell's `TTOKSEM_TASK`).
- `POST /api/tasks/{taskKey}/close` still works but emits the
  following response headers:
  - `Deprecation: true`
  - `Sunset: Sat, 07 Nov 2026 00:00:00 GMT`
  - `Link: </api/tasks/{taskKey}/archive>; rel="successor-version"`

  Switch to `POST /api/tasks/{taskKey}/archive`. The archive endpoint
  accepts the same `?workspace=` query parameter as close, so the
  migration is a path-only swap.

### Sunset timeline

| Surface | Status now | Removal |
| --- | --- | --- |
| `task close` (CLI) | Deprecated `2026-05-07`, warns on use | Removed `2026-11-07` |
| `task active` (CLI) <a id="task-active"></a> | Deprecated `2026-05-07`, warns on use; replaced by `echo $TTOKSEM_TASK` (current shell-scoped task) and `task list` (status='active' tasks) | Removed `2026-11-07` |
| `POST /api/tasks/{taskKey}/close` (HTTP) | Deprecated `2026-05-07`, headers attached | Removed `2026-11-07` |
| `GET /api/tasks/active` (HTTP) | Already `410 Gone` | Route deleted in the next minor after `2026-11-07` |

`Sunset` value (RFC 8594): `Sat, 07 Nov 2026 00:00:00 GMT`.

### Rollback

The DB migration is **forward-only**. To roll back, restore from a
backup taken before the upgrade. Recommended:

```bash
cp .ttoksem/ttoksem.db .ttoksem/ttoksem.db.bak.$(date +%Y%m%dT%H%M%S)
```

before the first launch on the new version. If you skip this and
later need to downgrade, the dropped `active_task_id` column cannot
be reconstructed from the migrated schema alone.

## Remote mode (Plan 4)

`HttpLedgerClient` ships in `@ttoksem/ledger-http` and the CLI auto-
detects `TTOKSEM_HTTP_URL`. See [docs/REMOTE-MODE.md](docs/REMOTE-MODE.md)
for the env vars, supported subcommands, and the admin/local
restrictions in remote mode.

No DB migration. No breaking changes. Local mode (no env var) is
unchanged.
