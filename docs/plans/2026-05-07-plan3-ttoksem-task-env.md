# Plan 3 — TTOKSEM_TASK env var for shell-scoped autocapture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the autocapture Stop hook from the heuristic `pnpm cli task active` to a shell-scoped `$TTOKSEM_TASK` env var, deprecate the now-orphaned `task active` CLI command, and add a stderr hint to `task start <key>` reminding users to export the variable.

**Architecture:** Three small surface changes — one bash script line, two CLI subcommand bodies, plus a docs update. No DB, no schema, no HTTP, no new packages. The Plan 1 design promised this; Plan 3 ships it.

**Tech Stack:** Bash 4+ (hook), TypeScript + Commander (CLI), Vitest (tests).

**Related design:** [docs/specs/2026-05-07-plan3-ttoksem-task-env.md](../specs/2026-05-07-plan3-ttoksem-task-env.md).

---

## File Structure

### Files to modify

| Path | What changes |
|---|---|
| `.claude/hooks/ttoksem-autocapture.sh` | Replace `ACTIVE_TASK=$(pnpm cli task active ...)` with `ACTIVE_TASK="${TTOKSEM_TASK:-}"`; drop the now-unused fallback path |
| `packages/cli/src/index.ts` | Add stderr deprecation banner at the top of the `task active` action body; add stderr hint to the end of the `task start` action body |
| `packages/cli/src/index.test.ts` | Add two new tests covering the deprecation banner and the start hint |
| `MIGRATION.md` | Drop "TTOKSEM_TASK is not yet shipped" caveats; add `task active` to the deprecation table |

### Files NOT touched

- `packages/core/*`, `packages/http/*`, `packages/schema/*`, `packages/storage*` — no behavior change.
- `apps/*` — no server change.
- HTTP routes — Plan 4 territory.

### Working directory

Implementation should run in a fresh worktree at `/Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env` against branch `plan3-ttoksem-task-env` cut from `main` (HEAD `57fb960` after the spec commit). Paths in this plan are repo-relative and resolve at the worktree root.

---

## Task 1 — CLI `task active` deprecation banner

Add a stderr banner at the start of the `task active` action body. Behavior unchanged; stdout still prints the most-recently-started active task key (or nothing).

**Files:**
- Modify: `packages/cli/src/index.ts:197-211` (the `task active` action body)
- Modify: `packages/cli/src/index.test.ts` (append new test)

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/src/index.test.ts`, inside the existing `describe("ttoksem CLI workflows", ...)` block:

```ts
it("emits a deprecation banner when running `task active`", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
  try {
    runCli(["workspace", "init", "--key", "cli-test", "--root", tempDir], env);
    runCli(["task", "start", "alpha", "--workspace", "cli-test"], env);

    const result = runCliCaptureBoth(["task", "active", "--workspace", "cli-test"], env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("alpha");
    expect(result.stderr).toContain("[deprecation]");
    expect(result.stderr).toContain("task active");
    expect(result.stderr).toContain("$TTOKSEM_TASK");
    expect(result.stderr).toContain("MIGRATION.md");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

> The test reuses the existing `runCli`, `runCliCaptureBoth`, `mkdtempSync`, and `tmpdir` helpers already in this file. No new imports needed.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env
pnpm --filter @ttoksem/cli test 2>&1 | grep -E "(deprecation|FAIL|✓ task active|✗ task active)"
```

Expected: FAIL — `result.stderr` does not contain `[deprecation]`.

- [ ] **Step 3: Implement the deprecation banner**

In `packages/cli/src/index.ts`, locate the `task active` action body (around line 197-211). Insert the stderr write as the first line of the action:

```ts
task
  .command("active")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("(deprecated — use $TTOKSEM_TASK) Print the key of the most recently started active task, or nothing if none")
  .action(async (options: { workspace?: string; root?: string }) => {
    process.stderr.write(
      "[deprecation] `task active` is going away in two minor releases. " +
      "Use `echo $TTOKSEM_TASK` for the current shell-scoped task, or " +
      "`task list` to see tasks with status='active'. " +
      "See MIGRATION.md#task-active.\n",
    );
    const { service, close } = await makeService();
    await service.init();
    const tasks = await service.listTasks({ workspace: workspaceResolver(options) });
    const active = tasks
      .filter((t) => t.status === "active")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (active) console.log(active.key);
    await close();
  });
```

The `.description(...)` line was also updated to include the `(deprecated ...)` prefix so `--help` reflects the change.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @ttoksem/cli test
```

Expected: green — the new test passes alongside the existing 4.

- [ ] **Step 5: Commit**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): deprecate \`task active\` in favor of \$TTOKSEM_TASK

Stderr deprecation banner; behavior unchanged; sunset 2026-11-07.
Help text now flags the command as deprecated and points at
MIGRATION.md#task-active.

Refs: docs/specs/2026-05-07-plan3-ttoksem-task-env.md"
```

---

## Task 2 — CLI `task start` hint

Add a stderr line after the success log, suggesting the user export `$TTOKSEM_TASK` so future autocapture attributes events to this task.

**Files:**
- Modify: `packages/cli/src/index.ts:90-116` (the `task start` action body)
- Modify: `packages/cli/src/index.test.ts` (append new test)

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/src/index.test.ts`:

```ts
it("prints a TTOKSEM_TASK export hint after `task start`", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
  try {
    runCli(["workspace", "init", "--key", "cli-test", "--root", tempDir], env);

    const result = runCliCaptureBoth(
      ["task", "start", "design-feature", "--workspace", "cli-test"],
      env,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("task design-feature");
    expect(result.stderr).toContain("hint:");
    expect(result.stderr).toContain("export TTOKSEM_TASK=design-feature");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @ttoksem/cli test
```

Expected: FAIL — stderr does not contain `hint:`.

- [ ] **Step 3: Implement the hint**

In `packages/cli/src/index.ts`, locate the `task start` action body (around line 100-116). Add the stderr write immediately after the existing `console.log` line:

```ts
.action(
  async (
    key: string,
    options: { name?: string; description?: string; workspace?: string; root?: string },
  ) => {
    const { service, close } = await makeService();
    await service.init();
    const started = await service.startTask({
      workspace: workspaceResolver(options),
      key: slug(key),
      name: options.name ?? key,
      description: options.description,
    });
    console.log(`task ${started.key} ${started.status} ${started.id} ${started.name}`);
    process.stderr.write(
      `hint: export TTOKSEM_TASK=${started.key}  # autocapture will attribute future events to this task\n`,
    );
    await close();
  },
);
```

> Stdout (`task <key> <status> <id> <name>`) is unchanged — scripts that parse this output continue to work. Only stderr gains the hint.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @ttoksem/cli test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): print TTOKSEM_TASK export hint after \`task start\`

Stderr hint reminds the user to scope future autocapture to this task
via the shell env var. stdout output unchanged.

Refs: docs/specs/2026-05-07-plan3-ttoksem-task-env.md"
```

---

## Task 3 — Autocapture hook switches to `$TTOKSEM_TASK`

Replace the `pnpm cli task active` lookup with a direct env-var read. No CLI subprocess for the task lookup means slightly faster hook execution and (more importantly) the hook now respects the user's intent.

**Files:**
- Modify: `.claude/hooks/ttoksem-autocapture.sh`

- [ ] **Step 1: Replace the active-task lookup**

Open `.claude/hooks/ttoksem-autocapture.sh`. Locate this block:

```bash
# Look up active task and last-imported timestamp via CLI.
ACTIVE_TASK=$(pnpm cli task active --workspace "$WORKSPACE" 2>>"$LOG" | tail -1 || true)
SINCE=$(pnpm cli usage last-import --workspace "$WORKSPACE" --source claude-session 2>>"$LOG" | tail -1 || true)
```

Replace with:

```bash
# Read the user's shell-scoped task pointer (Plan 3). When unset, events
# fall through to the inbox — the documented Plan 1 fallback.
ACTIVE_TASK="${TTOKSEM_TASK:-}"
SINCE=$(pnpm cli usage last-import --workspace "$WORKSPACE" --source claude-session 2>>"$LOG" | tail -1 || true)
```

> Keep the `SINCE` lookup as-is. Only the active-task source changes.

- [ ] **Step 2: Update the header comment block**

The script's docstring at the top describes its behavior. Update step 1 of the behavior list:

Find this block (lines ~3-19):

```bash
# Behavior:
#   1. Look up the active task in workspace ttoksem-dev.
#   2. If found, run import-claude-sessions with --task <active>.
#      If not found, run without --task so events land in the inbox.
```

Replace with:

```bash
# Behavior:
#   1. Read $TTOKSEM_TASK (shell-scoped task pointer, Plan 3).
#   2. If set, run import-claude-sessions with --task "$TTOKSEM_TASK".
#      If unset, run without --task so events land in the inbox.
```

The rest of the docstring (drift detection, asyncRewake, log behavior) is unchanged.

- [ ] **Step 3: Smoke test the hook manually**

The bash script is not under Vitest. Verify by hand:

```bash
# Reset env so we test the unset path
unset TTOKSEM_TASK
bash /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env/.claude/hooks/ttoksem-autocapture.sh
echo "exit=$?"
tail -20 /tmp/ttoksem-autocapture.log
```

Expected: log shows `active_task=(none)`, import runs without `--task`, exit 0 (or 2 if drift triggers).

```bash
# Now test the set path with a known task
export TTOKSEM_TASK=ops-idle
bash /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env/.claude/hooks/ttoksem-autocapture.sh
echo "exit=$?"
tail -20 /tmp/ttoksem-autocapture.log
unset TTOKSEM_TASK
```

Expected: log shows `active_task=ops-idle`, import runs with `--task ops-idle`.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/ttoksem-autocapture.sh
git commit -m "feat(autocapture): read \$TTOKSEM_TASK instead of \`task active\`

Replaces the heuristic 'most recently started status=active task' with
the user's explicit shell-scoped task pointer. When \$TTOKSEM_TASK is
unset, events fall through to the inbox — the documented Plan 1
fallback. Resolves the recurring 'has accumulated N prompt groups'
warnings caused by autocapture latching onto whatever task happened to
be active.

Refs: docs/specs/2026-05-07-plan3-ttoksem-task-env.md"
```

---

## Task 4 — MIGRATION.md update

Plan 1 left a forward reference saying TTOKSEM_TASK isn't shipped yet. Plan 3 ships it. Update the doc.

**Files:**
- Modify: `MIGRATION.md`

- [ ] **Step 1: Read the current MIGRATION.md**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env
sed -n '1,120p' MIGRATION.md
```

Identify the sections that reference TTOKSEM_TASK forward-references (the `### CLI users` before/after block and any "(Plan 3 not yet shipped)" / "lands in Plan 3" callouts).

- [ ] **Step 2: Drop the "not yet shipped" caveats**

In the `### CLI users` section's "After" example, remove any caveat that says TTOKSEM_TASK plumbing isn't shipped yet. The before/after example becomes:

```bash
export TTOKSEM_TASK=design-feature  # set in your shell
pnpm cli task start design-feature --workspace ws
# ... do work; autocapture reads $TTOKSEM_TASK
pnpm cli task archive design-feature --workspace ws
unset TTOKSEM_TASK
```

If the existing doc has a `> Note: ...lands in Plan 3...` blockquote below this example, delete the blockquote entirely (or replace with a one-line note that this is now the canonical workflow).

- [ ] **Step 3: Add `task active` to the deprecation table**

Locate the existing Sunset timeline section (Plan 1 added a list/table for `task close` CLI and `POST /api/tasks/{taskKey}/close`). Add a new row for `task active`:

```markdown
- `pnpm cli task active` (CLI):
  Deprecated `2026-05-07`, removed `2026-11-07` (two minor releases).
  Replaced by `echo $TTOKSEM_TASK` for the current shell-scoped task,
  or `task list` for status='active' tasks.
```

If the existing doc uses a table format instead of a list, add a corresponding row matching the table's columns.

- [ ] **Step 4: Verify the file reads correctly**

```bash
head -60 MIGRATION.md
grep -n "TTOKSEM_TASK\|task active" MIGRATION.md
```

Expected:
- No occurrences of "not yet shipped" or "lands in Plan 3" or "Plan 3 ships".
- `task active` appears in the deprecation/sunset section.
- TTOKSEM_TASK appears in the canonical CLI workflow example without caveat.

- [ ] **Step 5: Commit**

```bash
git add MIGRATION.md
git commit -m "docs: MIGRATION.md — TTOKSEM_TASK shipped, deprecate \`task active\`

- Removes the 'TTOKSEM_TASK lands in Plan 3' caveats; the CLI workflow
  example now stands as the canonical pattern.
- Adds \`task active\` to the deprecation table with the same sunset
  window as Plan 1's \`task close\` (deprecated 2026-05-07, removed
  2026-11-07).

Refs: docs/specs/2026-05-07-plan3-ttoksem-task-env.md"
```

---

## Task 5 — Final test sweep

Confirm the workspace stays green after all the small changes.

- [ ] **Step 1: Run the workspace tests + build**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan3-ttoksem-task-env
pnpm test
pnpm build
```

Expected: all packages green, build clean.

- [ ] **Step 2: Inspect any remaining failures**

If anything fails, the most likely sources are:
- A test that asserted on the exact stdout of `task start` — should be unaffected since stdout shape is unchanged. If a test was checking the absence of stderr output, update it.
- A test that asserted `task active` produced no extra output — the deprecation banner now adds stderr. Update the test to expect or ignore stderr.

Fix and commit per-package as needed:

```bash
pnpm --filter <package> test  # iterate until green
git add packages/<name>/...
git commit -m "test(<name>): align with Plan 3 stderr additions"
```

- [ ] **Step 3: No commit if everything is already green**

If `pnpm test` and `pnpm build` are both green at the start of Step 1, this task is a no-op — no commit needed.

---

## Self-Review Checklist (run before declaring Plan 3 done)

- [ ] All 5 tasks above are committed (Task 5 may produce zero commits).
- [ ] `pnpm build` is clean across the workspace.
- [ ] `pnpm test` is green across the workspace.
- [ ] `.claude/hooks/ttoksem-autocapture.sh` reads `$TTOKSEM_TASK` directly; the `pnpm cli task active` call is gone.
- [ ] `pnpm cli task active` prints the `[deprecation]` banner to stderr and still produces the same stdout.
- [ ] `pnpm cli task start <key>` prints the `hint: export TTOKSEM_TASK=<key>` line to stderr and unchanged stdout.
- [ ] Manual smoke test confirmed both unset and set TTOKSEM_TASK paths in the hook.
- [ ] `MIGRATION.md` no longer contains "not yet shipped" caveats; `task active` is in the deprecation timeline.

When all checked, Plan 3 is complete. Open Plan 4 (HttpLedgerClient) when ready.
