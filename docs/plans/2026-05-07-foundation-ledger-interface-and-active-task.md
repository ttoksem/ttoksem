# Plan 1 — Foundation: `Ledger` Interface + Active Task Removal + close→archive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the codebase for a future remote `Ledger` adapter by (1) extracting the `Ledger` interface from `LedgerService`, (2) removing the workspace-level "active task" concept that won't survive multi-machine use, and (3) renaming `closeTask` → `archiveTask` with a deprecation grace period.

**Architecture:** Three changes land in this plan. (1) A new `Ledger` interface in `@ttoksem/core` mirrors `LedgerService`'s public surface; `LedgerService` gains `implements Ledger`. No behavior change. (2) The `workspace.active_task_id` column, the `LedgerStore.setActiveTask` method, the `GET /api/tasks/active` endpoint, and the implicit "active task" fallback in `closeTask` are all removed via a forward-only column-rebuild migration. The autocapture hook will eventually use `TTOKSEM_TASK` env var instead (Plan 3). (3) `closeTask` becomes `archiveTask` with deprecated aliases for two minor releases.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, better-sqlite3 (SQLite adapter), Cloudflare D1 (Worker adapter), Hono (HTTP).

**Related design:** [ai-usage-ledger-spec/docs/design/remote-storage-adapter.md](../../../ai-usage-ledger-spec/docs/design/remote-storage-adapter.md) and [ADR-0010](../../../ai-usage-ledger-spec/docs/adrs/ADR-0010-remote-storage-adapter.md).

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `packages/core/src/ledger.ts` | `Ledger` interface — public business operations surface |
| `packages/core/src/ledger.test.ts` | Type-level test ensuring `LedgerService` satisfies `Ledger` |
| `ttoksem/MIGRATION.md` | User-facing migration guide for active task removal |

### Files to modify

| Path | What changes |
|---|---|
| `packages/core/src/index.ts` | Re-export `Ledger` |
| `packages/core/src/ledger-service.ts` | `implements Ledger`; rename `closeTask` → `archiveTask` (alias kept); remove `setActiveTask` calls; remove `active_task_id` fallback in close path |
| `packages/core/src/ledger-service.test.ts` | Remove tests for active task pointer; add tests for archive |
| `packages/storage/src/index.ts` | Remove `setActiveTask` from `LedgerStore`; rename `closeTask` → `archiveTask` (with alias); remove `active_task_id` from `WorkspaceRecord` |
| `packages/storage-sqlite/src/index.ts` | Add migration `0003_drop_active_task_id`; remove `setActiveTask` impl; rename `closeTask` impl; drop `active_task_id` from row mapper |
| `packages/storage-d1/src/index.ts` | Same migration + impl changes mirrored for D1 |
| `packages/http/src/index.ts` | `GET /api/tasks/active` → 410 Gone with `Sunset` header; add `POST /api/tasks/{taskKey}/archive`; keep `/close` as alias with `Deprecation` + `Sunset` headers |
| `packages/http/src/index.test.ts` | Remove active task pointer tests; add archive tests + 410 Gone test |
| `packages/cli/src/index.ts` | Add `task archive` command; keep `task close` as alias emitting stderr deprecation warning; remove `setActiveTask` semantics from `task start` |

---

## Task 1 — Extract `Ledger` interface

Pure mechanical extraction. Behavior unchanged. Compile-time check that nothing drifts.

**Files:**
- Create: `packages/core/src/ledger.ts`
- Create: `packages/core/src/ledger.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/ledger-service.ts`

- [ ] **Step 1: Create the `Ledger` interface mirroring `LedgerService` public surface**

Read the current public surface of `LedgerService` (the methods listed in the agent report; verify against the file at `packages/core/src/ledger-service.ts`). Methods to include in `Ledger` (do NOT include `setActiveTask` / `getActiveTask` — they will be removed in Task 5; do NOT include `closeTask` — it will be renamed to `archiveTask` in Task 9 — but to avoid blocking work, include both `closeTask` and `archiveTask` here, where `closeTask` is annotated `@deprecated`):

Create `packages/core/src/ledger.ts`:

```ts
import type {
  AccessKeyRecord,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
  RunRecord,
  TaskRecord,
  WorkspaceRecord,
} from "@ttoksem/storage";
// Import any input/output types LedgerService uses publicly. Read
// packages/core/src/ledger-service.ts and copy the imports of types
// referenced by public method signatures.

/**
 * Business-operation interface that the local LedgerService and (in Plan 3)
 * the HttpLedgerClient both implement. Higher-level than LedgerStore.
 */
export interface Ledger {
  // Workspace
  init(input: { workspaceKey: string; rootPath?: string }): Promise<WorkspaceRecord>;
  resolveWorkspace(resolver: import("./ledger-service.js").WorkspaceResolver): Promise<WorkspaceRecord>;
  currentWorkspace(): Promise<WorkspaceRecord | null>;
  createWorkspace(input: import("./ledger-service.js").CreateWorkspaceInput): Promise<WorkspaceRecord>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;

  // Tasks
  startTask(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key: string; name?: string; description?: string }): Promise<TaskRecord>;
  /** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
  closeTask(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key?: string }): Promise<TaskRecord>;
  archiveTask(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key: string }): Promise<TaskRecord>;
  listTasks(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<TaskRecord[]>;
  updateTask(input: import("./ledger-service.js").UpdateTaskInput): Promise<TaskRecord>;
  getTaskStats(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key: string }): Promise<import("./ledger-service.js").TaskStats>;

  // Runs
  runActions(runId: string): Promise<import("./ledger-service.js").RunActionList>;
  runMeta(runId: string): Promise<import("./ledger-service.js").RunMeta>;

  // Usage
  recordUsage(input: import("./ledger-service.js").RecordUsageInput): Promise<import("./ledger-service.js").RecordUsageResult>;
  moveUsage(input: { usageId: string; taskKey: string; workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<void>;
  listUnpricedUsage(): Promise<import("./ledger-service.js").UnpricedUsageRow[]>;
  repriceUnpricedUsage(): Promise<{ updated: number }>;
  migrateUsageEventPricing(): Promise<{ updated: number }>;
  getLastImportedAt(): Promise<string | null>;

  // Inbox
  listInbox(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<import("./ledger-service.js").InboxEvent[]>;
  listInboxGroups(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<import("./ledger-service.js").InboxGroup[]>;
  assignInboxGroup(input: import("./ledger-service.js").AssignInboxGroupInput): Promise<void>;
  acceptInboxGroup(input: import("./ledger-service.js").AcceptInboxGroupInput): Promise<void>;
  assignInboxEvent(input: import("./ledger-service.js").AssignInboxEventInput): Promise<void>;
  howInboxGroup(input: { groupId: string }): Promise<import("./ledger-service.js").InboxHowResult>;

  // Dashboard / Reports
  dashboard(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<import("./ledger-service.js").DashboardResult>;
  dashboardTask(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key: string }): Promise<import("./ledger-service.js").DashboardTaskResult>;
  reportToday(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<import("./ledger-service.js").ReportTodayResult>;
  reportTask(input: { workspace: import("./ledger-service.js").WorkspaceResolver; key: string }): Promise<import("./ledger-service.js").ReportTaskResult>;

  // Pricing
  upsertPricingSourceSnapshot(input: import("./ledger-service.js").UpsertPricingSourceSnapshotInput): Promise<PricingSourceSnapshotRecord>;
  listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]>;
  getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null>;
  upsertPricingRule(input: import("./ledger-service.js").UpsertPricingRuleInput): Promise<PricingRuleRecord>;
  listPricingRules(input: { workspace: import("./ledger-service.js").WorkspaceResolver }): Promise<PricingRuleRecord[]>;

  // Auth
  createAccessKey(input: import("./ledger-service.js").CreateAccessKeyInput): Promise<{ key: AccessKeyRecord; token: string }>;
  listAccessKeys(): Promise<AccessKeyRecord[]>;
  revokeAccessKey(id: string): Promise<AccessKeyRecord>;
  verifyAccessKey(token: string): Promise<import("./ledger-service.js").AccessKeyVerificationResult>;
  countActiveAccessKeys(): Promise<number>;
}
```

> Note: any type referenced by `import("./ledger-service.js").Foo` that doesn't yet exist as a `Foo` export from `ledger-service.ts` must be exported there (or moved into a dedicated types file). When you encounter a missing export, add `export` to its declaration in `ledger-service.ts`. Don't invent new types — use what the service already returns.

- [ ] **Step 2: Re-export `Ledger` from package root**

Modify `packages/core/src/index.ts`:

```ts
// existing exports above
export * from "./ledger-service.js";
export * from "./money.js";
export type { Ledger } from "./ledger.js";
```

- [ ] **Step 3: Add `implements Ledger` to `LedgerService`**

In `packages/core/src/ledger-service.ts`, change the class declaration:

```ts
import type { Ledger } from "./ledger.js";

export class LedgerService implements Ledger {
  // ... existing body unchanged
}
```

The compiler will now complain about any signature drift between `Ledger` and `LedgerService`. Fix any drift by aligning `Ledger` to whatever `LedgerService` actually returns (the service is the source of truth for the existing surface).

- [ ] **Step 4: Add a type-level test**

Create `packages/core/src/ledger.test.ts`:

```ts
import { describe, expectTypeOf, test } from "vitest";
import { LedgerService } from "./ledger-service.js";
import type { Ledger } from "./ledger.js";

describe("Ledger interface", () => {
  test("LedgerService satisfies Ledger", () => {
    expectTypeOf<LedgerService>().toMatchTypeOf<Ledger>();
  });
});
```

- [ ] **Step 5: Run tests and verify**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem/ttoksem
pnpm --filter @ttoksem/core test
```

Expected: all existing tests still pass + new `Ledger interface > LedgerService satisfies Ledger` passes.

```bash
pnpm build
```

Expected: clean build, no TypeScript errors anywhere in the workspace.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ledger.ts packages/core/src/ledger.test.ts \
        packages/core/src/index.ts packages/core/src/ledger-service.ts
git commit -m "feat(core): extract Ledger interface from LedgerService

Mechanical extraction. LedgerService now implements Ledger. No behavior
change. Prepares for HttpLedgerClient (Plan 3) which will share this
interface with the local service.

Refs: ai-usage-ledger-spec/docs/design/remote-storage-adapter.md"
```

---

## Task 2 — SQLite migration: drop `workspace.active_task_id`

Forward-only column rebuild. Wraps in transaction. Idempotent via `schema_migrations` row.

**Files:**
- Modify: `packages/storage-sqlite/src/index.ts:51-271` (the `migrate()` body — append migration `0003`)
- Modify: `packages/storage-sqlite/src/index.test.ts` (add fixture-based migration test)

- [ ] **Step 1: Write the failing migration test**

Add to `packages/storage-sqlite/src/index.test.ts` (or create a dedicated migration test file):

```ts
import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { SqliteLedgerStore } from "./index.js";

describe("migration 0003_drop_active_task_id", () => {
  test("drops active_task_id column while preserving other workspace columns", async () => {
    // Set up a DB at schema version 0002 with a workspace row that has active_task_id set.
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        root_path TEXT,
        active_task_id TEXT,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES ('0001_initial', '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations VALUES ('0002_split_usage_event_currency', '2026-01-01T00:00:00Z');
      INSERT INTO workspaces VALUES (
        'ws_test', 'test-key', 'Test', NULL, 'active', '/tmp/x', 'task_xyz',
        'cli', NULL, NULL, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'
      );
    `);
    db.close();

    // Open via SqliteLedgerStore so migrate() runs.
    // (Implementation detail: SqliteLedgerStore takes a path. For an in-memory
    // test, you may need to expose a constructor variant that accepts a Database
    // instance, OR use a tmp file. Choose tmp file to match production behavior.)
    const tmpPath = `/tmp/ttoksem-test-${Date.now()}.db`;
    // Re-create the same fixture in the tmp file:
    const setup = new Database(tmpPath);
    setup.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        root_path TEXT,
        active_task_id TEXT,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES ('0001_initial', '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations VALUES ('0002_split_usage_event_currency', '2026-01-01T00:00:00Z');
      INSERT INTO workspaces VALUES (
        'ws_test', 'test-key', 'Test', NULL, 'active', '/tmp/x', 'task_xyz',
        'cli', NULL, NULL, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'
      );
    `);
    setup.close();

    const store = new SqliteLedgerStore(tmpPath);
    await store.migrate();

    // Re-open raw and inspect schema.
    const verify = new Database(tmpPath);
    const cols = verify.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain("active_task_id");
    // Other columns preserved:
    expect(colNames).toEqual(expect.arrayContaining([
      "id", "key", "name", "description", "status", "root_path",
      "source", "external_ref_json", "metadata_json",
      "created_at", "archived_at", "updated_at",
    ]));
    // Row preserved:
    const row = verify.prepare("SELECT * FROM workspaces WHERE id = 'ws_test'").get() as Record<string, unknown>;
    expect(row.id).toBe("ws_test");
    expect(row.key).toBe("test-key");
    // Migration recorded:
    const mig = verify.prepare("SELECT version FROM schema_migrations WHERE version = '0003_drop_active_task_id'").get();
    expect(mig).toBeDefined();
    verify.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem/ttoksem
pnpm --filter @ttoksem/storage-sqlite test -- migration
```

Expected: FAIL — `colNames` still includes `active_task_id` (migration doesn't exist yet).

- [ ] **Step 3: Implement the migration**

Open `packages/storage-sqlite/src/index.ts` and locate the `migrate()` method (starts at line 51). Migrations are applied as ordered version strings; find the existing pattern (likely a sequence of `if (!hasMigration("0001_initial")) { ... insert version row }` blocks). Append the new migration as the last block, BEFORE the method returns.

```ts
// Inside migrate(), append after the previous migration block:
if (!hasMigration("0003_drop_active_task_id")) {
  this.db.transaction(() => {
    // Recreate workspaces table without active_task_id.
    this.db.exec(`
      CREATE TABLE workspaces_new (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        root_path TEXT,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO workspaces_new (
        id, key, name, description, status, root_path, source,
        external_ref_json, metadata_json, created_at, archived_at, updated_at
      )
      SELECT
        id, key, name, description, status, root_path, source,
        external_ref_json, metadata_json, created_at, archived_at, updated_at
      FROM workspaces;
      DROP TABLE workspaces;
      ALTER TABLE workspaces_new RENAME TO workspaces;
    `);
    this.db
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run("0003_drop_active_task_id", new Date().toISOString());
  })();
}
```

> **Verify the helper name `hasMigration`** — read the existing migrate() body. The actual helper may be inline or named differently (e.g., direct `SELECT 1 FROM schema_migrations WHERE version = ?`). Match what's already there.

> **Note on indices/foreign keys**: if the `workspaces` table has indices or other DB objects (FKs, triggers) defined on it, those must be recreated after the rename. Check the existing CREATE TABLE block for any `CREATE INDEX` statements that follow it; replicate them for `workspaces_new` (but use the original index names — SQLite drops indices when the underlying table is dropped). The simplest approach: copy the full set of `CREATE INDEX IF NOT EXISTS ... ON workspaces (...)` statements that appear in the initial migration, and run them after the RENAME.

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm --filter @ttoksem/storage-sqlite test
```

Expected: all storage-sqlite tests pass, including the new migration test.

- [ ] **Step 5: Run wider workspace tests to catch regressions**

```bash
pnpm test
```

Expected: most things pass; some failures expected in `core` and `http` because `WorkspaceRecord.active_task_id` is still typed but no longer exists in the row mapper after this migration (we'll fix in Task 4). For now, only `storage-sqlite` tests should be green.

> **Do NOT proceed to commit until storage-sqlite is green.** If storage-sqlite tests fail, fix the migration. Other packages will be fixed in subsequent tasks.

- [ ] **Step 6: Commit (storage-sqlite migration in isolation)**

```bash
git add packages/storage-sqlite/src/index.ts packages/storage-sqlite/src/index.test.ts
git commit -m "feat(storage-sqlite): add migration 0003_drop_active_task_id

Forward-only column rebuild via CREATE TABLE workspaces_new + INSERT +
DROP + RENAME, all in a single transaction. Preserves existing rows.
Indices recreated after rename.

active_task_id removal is part of replacing workspace-level active task
with shell-scoped TTOKSEM_TASK env var. See ADR-0010.

Note: the WorkspaceRecord row mapper still references active_task_id,
which is fixed in the next commit (Task 4)."
```

---

## Task 3 — D1 migration mirror

D1 uses Cloudflare's batch API for transactions. Same conceptual change as Task 2.

**Files:**
- Modify: `packages/storage-d1/src/index.ts` (the `migrate()` method — around line 76+)
- Modify: `packages/storage-d1/src/index.test.ts` (mirror migration test using miniflare-style D1 fixture, or skip if there's no D1 test infra yet)

- [ ] **Step 1: Check whether D1 has equivalent tests**

```bash
ls packages/storage-d1/src/
cat packages/storage-d1/src/index.test.ts 2>/dev/null | head -40
```

If there's no test infrastructure for D1, skip the test write and rely on the SQLite test as proxy (the migration logic is identical). Note this in the commit message.

- [ ] **Step 2: Add the migration to D1 store**

Open `packages/storage-d1/src/index.ts`. Locate the `migrate()` method. Append:

```ts
if (!(await hasMigration("0003_drop_active_task_id"))) {
  // D1 batch API runs statements as one logical unit.
  await this.db.batch([
    this.db.prepare(`
      CREATE TABLE workspaces_new (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        root_path TEXT,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        updated_at TEXT NOT NULL
      )
    `),
    this.db.prepare(`
      INSERT INTO workspaces_new (
        id, key, name, description, status, root_path, source,
        external_ref_json, metadata_json, created_at, archived_at, updated_at
      )
      SELECT
        id, key, name, description, status, root_path, source,
        external_ref_json, metadata_json, created_at, archived_at, updated_at
      FROM workspaces
    `),
    this.db.prepare("DROP TABLE workspaces"),
    this.db.prepare("ALTER TABLE workspaces_new RENAME TO workspaces"),
    // Recreate any indices that existed on `workspaces`. Mirror the SQLite
    // migrate() block to keep them aligned.
    this.db
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .bind("0003_drop_active_task_id", new Date().toISOString()),
  ]);
}
```

> Verify the actual helper name (`hasMigration`) and migration application style by reading the existing migrate() method in this file. Match its style.

- [ ] **Step 3: Run D1 tests if any exist; otherwise verify build**

```bash
pnpm --filter @ttoksem/storage-d1 build
pnpm --filter @ttoksem/storage-d1 test 2>/dev/null || echo "no tests, build only"
```

- [ ] **Step 4: Commit**

```bash
git add packages/storage-d1/src/index.ts packages/storage-d1/src/index.test.ts 2>/dev/null
git commit -m "feat(storage-d1): mirror 0003_drop_active_task_id migration

D1 uses batch() for atomicity. Same conceptual rebuild as the SQLite
migration. Verified via build; D1 has no per-package test fixture so
relies on SQLite migration test as logic proxy."
```

---

## Task 4 — Remove `setActiveTask` and `active_task_id` from `LedgerStore` + impls + types

After this task the storage layer no longer knows about active task. The compiler will surface every place that reads `workspace.active_task_id` or calls `setActiveTask` so we can fix them in Task 5.

**Files:**
- Modify: `packages/storage/src/index.ts:273` (interface — remove `setActiveTask`)
- Modify: `packages/storage/src/index.ts` (the `WorkspaceRecord` type — remove `active_task_id` field)
- Modify: `packages/storage-sqlite/src/index.ts:515-526` (remove `setActiveTask` impl)
- Modify: `packages/storage-sqlite/src/index.ts` (the workspace row mapper — drop `active_task_id` field; verify the SQL used in `INSERT`/`SELECT` in workspace-related methods doesn't reference the dropped column)
- Modify: `packages/storage-d1/src/index.ts` (mirror)

- [ ] **Step 1: Remove from interface**

In `packages/storage/src/index.ts`, delete line 273 (the `setActiveTask(...)` declaration). Also locate the `WorkspaceRecord` type (search for `WorkspaceRecord =` or `interface WorkspaceRecord`) and remove the `active_task_id` field from it.

- [ ] **Step 2: Remove from SQLite impl**

In `packages/storage-sqlite/src/index.ts`:

1. Delete lines 515-526 (the `async setActiveTask(...)` method).
2. Find the workspace row mapper (a function named like `rowToWorkspace` or inline `(row) => ({ id: row.id, ...active_task_id: row.active_task_id... })`). Remove the `active_task_id` field.
3. Find any INSERT or UPDATE on `workspaces` that references `active_task_id`. After the migration, the column doesn't exist, so referencing it would error. Remove from INSERT column lists, UPDATE SET clauses, etc.
4. Find any SELECT that named the columns explicitly (e.g., `SELECT id, key, ..., active_task_id FROM workspaces`). Remove `active_task_id` from the column list. If it uses `SELECT *` it's fine.

- [ ] **Step 3: Remove from D1 impl**

Mirror Step 2 in `packages/storage-d1/src/index.ts`.

- [ ] **Step 4: Try to build**

```bash
pnpm build
```

Expected: build fails. Errors will appear in `packages/core` (LedgerService still calls `setActiveTask` and reads `workspace.active_task_id`) and possibly `packages/http`/`packages/cli`. List the errors but do not fix yet — Task 5 fixes them.

- [ ] **Step 5: Commit (incomplete state — explicitly noted)**

```bash
git add packages/storage/src/index.ts packages/storage-sqlite/src/index.ts packages/storage-d1/src/index.ts
git commit -m "refactor(storage): remove setActiveTask from LedgerStore + impls

Drops the workspace.active_task_id pointer from the store layer. The
compiler will now flag every caller; LedgerService is fixed in the next
commit (Task 5) and HTTP/CLI in subsequent tasks.

Build is intentionally broken until LedgerService is updated."
```

---

## Task 5 — Update `LedgerService` to drop active task semantics

**Files:**
- Modify: `packages/core/src/ledger-service.ts:432-433` (remove `setActiveTask` call from `startTask`)
- Modify: `packages/core/src/ledger-service.ts:437-450` (rework `closeTask` body — remove `active_task_id` fallback path and the post-close `setActiveTask(... null)` call)
- Modify: `packages/core/src/ledger-service.test.ts` (remove tests at line 437 and 522 that exercise active task pointer)

- [ ] **Step 1: Update `startTask` to drop the `setActiveTask` call**

Around line 433 in `packages/core/src/ledger-service.ts`, the current code is:

```ts
const activeTask = await this.store.startTask(task.id, now);
await this.store.setActiveTask(workspace.id, activeTask.id, now);
return activeTask;
```

Change to:

```ts
const activated = await this.store.startTask(task.id, now);
return activated;
```

(`activeTask` → `activated` is just for clarity; you can keep the name.)

- [ ] **Step 2: Update `closeTask` to drop the `active_task_id` fallback and pointer cleanup**

Lines 437-450 currently look like:

```ts
async closeTask(input: { workspace: WorkspaceResolver; key?: string }): Promise<TaskRecord> {
  const workspace = await this.resolveWorkspace(input.workspace);
  const task = input.key
    ? await this.store.getTaskByKey(workspace.id, input.key)
    : workspace.active_task_id
      ? await this.store.getTaskById(workspace.active_task_id)
      : null;
  if (!task) throw new Error("Task not found.");
  const closed = await this.store.closeTask(task.id, this.clock.now());
  if (workspace.active_task_id === task.id) {
    await this.store.setActiveTask(workspace.id, null, this.clock.now());
  }
  return closed;
}
```

Change to (note: `key` becomes required — no more "close whatever was active" mode):

```ts
async closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord> {
  const workspace = await this.resolveWorkspace(input.workspace);
  const task = await this.store.getTaskByKey(workspace.id, input.key);
  if (!task) throw new Error(`Task not found: ${input.key}`);
  return this.store.closeTask(task.id, this.clock.now());
}
```

> The `key` parameter is now required because there's no implicit "active task" fallback. Every caller must specify which task to close. This is a breaking signature change at the API; CLI/HTTP/tests are updated in their respective tasks.

- [ ] **Step 3: Remove obsolete tests**

In `packages/core/src/ledger-service.test.ts`, delete or rewrite the tests around line 437 and 522 that reference `setActiveTask` or `active_task_id`. If the test was useful (e.g., it covered "starting a task makes it close-able later"), keep the surviving behavior assertion and delete only the active-task-pointer assertions.

For any test that called `service.closeTask({ workspace })` (no key), update it to pass `key`. If multiple tests relied on the implicit active task fallback, decide per-test whether to keep them (with explicit key) or drop them.

- [ ] **Step 4: Update `Ledger` interface signature**

Since `closeTask` now requires `key`, update `packages/core/src/ledger.ts`:

```ts
/** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
```

(`key?: string` → `key: string`.)

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @ttoksem/core test
pnpm --filter @ttoksem/storage-sqlite test
```

Expected: both packages green. The wider workspace will still fail (HTTP and CLI have not been updated yet).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ledger-service.ts packages/core/src/ledger-service.test.ts packages/core/src/ledger.ts
git commit -m "refactor(core): drop workspace active_task_id from LedgerService

- startTask no longer calls setActiveTask
- closeTask no longer falls back to active_task_id; key is required
- Ledger.closeTask signature: key is required

Active task is being replaced by shell-scoped TTOKSEM_TASK env var
(Plan 3). HTTP and CLI still need updates; build broken until then."
```

---

## Task 6 — Replace `GET /api/tasks/active` with 410 Gone

**Files:**
- Modify: `packages/http/src/index.ts:140-146` (route definition); `:462-471` (handler)
- Modify: `packages/http/src/index.test.ts:229` (test referencing `active_task_id`)

- [ ] **Step 1: Write the failing test**

In `packages/http/src/index.test.ts`, add:

```ts
test("GET /api/tasks/active returns 410 Gone with Sunset header", async () => {
  const app = makeTestApp(); // existing helper, or build via the same pattern as other tests in this file
  const res = await app.request("/api/tasks/active?workspace=test", {
    headers: { Authorization: `Bearer ${validToken}` },
  });
  expect(res.status).toBe(410);
  expect(res.headers.get("Sunset")).toBeTruthy();
  const body = await res.json();
  expect(body).toMatchObject({ error: "endpoint_removed" });
});
```

Also, around line 229, find the existing test that asserts `active_task_id` and either delete or rewrite (the active task pointer no longer exists in the response).

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @ttoksem/http test -- index.test
```

Expected: FAIL — current handler returns 200 with the active task body.

- [ ] **Step 3: Replace handler with 410 Gone**

In `packages/http/src/index.ts`, locate the route definition for `GET /api/tasks/active` (line 140-146) and the handler (462-471). Replace the handler body with:

```ts
.openapi(getActiveTaskRoute, async (c) => {
  // Endpoint removed in favor of TTOKSEM_TASK env var (see ADR-0010).
  // Two-minor-release Sunset window: 2026-11-07.
  c.header("Sunset", "Sat, 07 Nov 2026 00:00:00 GMT");
  c.header("Deprecation", "Mon, 07 May 2026 00:00:00 GMT");
  return c.json(
    {
      error: "endpoint_removed",
      message: "Workspace active task is removed. Use TTOKSEM_TASK env var.",
      see: "https://github.com/<org>/ttoksem/blob/main/MIGRATION.md#active-task",
    },
    410,
  );
})
```

> Adjust the route name (`getActiveTaskRoute`) to match what the file actually uses. If the route is registered inline rather than via a named route object, replace the inline handler the same way.

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm --filter @ttoksem/http test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): GET /api/tasks/active returns 410 Gone

Workspace active task is removed (ADR-0010). Endpoint replies 410 with
Sunset and Deprecation headers and a pointer to MIGRATION.md.

Sunset window: two minor releases. Endpoint will be deleted entirely in
the release after."
```

---

## Task 7 — Add `archiveTask` at the store layer (alias of `closeTask`)

This is the lowest-risk way to introduce the new name: add `archiveTask` as a new method that just forwards to the existing `closeTask` implementation in the store. The next task does the same at the service layer. The OLD `closeTask` will be removed in a future plan after two minor releases.

**Files:**
- Modify: `packages/storage/src/index.ts` (add `archiveTask` to the `LedgerStore` interface, alongside `closeTask`)
- Modify: `packages/storage-sqlite/src/index.ts` (implement `archiveTask` — can simply call `this.closeTask(taskId, now)`)
- Modify: `packages/storage-d1/src/index.ts` (mirror)

- [ ] **Step 1: Add interface method**

In `packages/storage/src/index.ts`, immediately after the existing `closeTask` declaration (around line 272):

```ts
/** Archive a task. Replaces closeTask going forward. */
archiveTask(taskId: string, now: string): Promise<TaskRecord>;
```

Keep `closeTask` for now — other callers still use it. It will be removed once all callers migrate.

- [ ] **Step 2: Implement in SQLite store**

In `packages/storage-sqlite/src/index.ts`, near the existing `closeTask` implementation:

```ts
async archiveTask(taskId: string, now: string): Promise<TaskRecord> {
  return this.closeTask(taskId, now);
}
```

(They're identical at the storage layer — both flip status to closed/archived.)

- [ ] **Step 3: Mirror in D1 store**

Same one-line forwarding method in `packages/storage-d1/src/index.ts`.

- [ ] **Step 4: Build + verify**

```bash
pnpm build
```

Expected: storage layer compiles. core/http/cli still failing (closeTask vs archiveTask resolution will be fixed in Task 8).

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/index.ts packages/storage-sqlite/src/index.ts packages/storage-d1/src/index.ts
git commit -m "feat(storage): add archiveTask method (alias of closeTask)

Adds archiveTask alongside the existing closeTask. Same behavior — both
flip task status to closed. closeTask is kept for two minor releases as
alias and removed afterward."
```

---

## Task 8 — Add `archiveTask` at the service layer + keep `closeTask` deprecated alias

**Files:**
- Modify: `packages/core/src/ledger-service.ts` (add `archiveTask` method, keep `closeTask` as deprecated alias)
- Modify: `packages/core/src/ledger.ts` (already has both — verify signatures align)
- Modify: `packages/core/src/ledger-service.test.ts` (add tests for archiveTask; existing closeTask tests still pass via alias)

- [ ] **Step 1: Write failing tests for `archiveTask`**

In `packages/core/src/ledger-service.test.ts`:

```ts
test("archiveTask flips task status and returns archived record", async () => {
  const { service } = await setupService(); // existing helper
  await service.startTask({ workspace: { key: "ws" }, key: "t-1" });
  const archived = await service.archiveTask({ workspace: { key: "ws" }, key: "t-1" });
  expect(archived.status).toBe("closed"); // or whatever the closed/archived status string actually is — check WorkspaceRecord/TaskRecord status enum
});

test("closeTask still works as a deprecated alias", async () => {
  const { service } = await setupService();
  await service.startTask({ workspace: { key: "ws" }, key: "t-2" });
  const closed = await service.closeTask({ workspace: { key: "ws" }, key: "t-2" });
  expect(closed.status).toBe("closed");
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/core test
```

Expected: FAIL — `archiveTask` is not defined.

- [ ] **Step 3: Implement `archiveTask` in `LedgerService`**

In `packages/core/src/ledger-service.ts`:

```ts
async archiveTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord> {
  const workspace = await this.resolveWorkspace(input.workspace);
  const task = await this.store.getTaskByKey(workspace.id, input.key);
  if (!task) throw new Error(`Task not found: ${input.key}`);
  return this.store.archiveTask(task.id, this.clock.now());
}

/**
 * @deprecated Use archiveTask. Kept as alias until two minor releases pass.
 */
async closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord> {
  return this.archiveTask(input);
}
```

(Replace the existing `closeTask` body with the deprecated-alias forwarder.)

- [ ] **Step 4: Update `Ledger` interface to mirror final shape**

In `packages/core/src/ledger.ts` confirm:

```ts
archiveTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
/** @deprecated Use archiveTask. */
closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
```

- [ ] **Step 5: Run tests, verify pass**

```bash
pnpm --filter @ttoksem/core test
```

Expected: both new tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ledger-service.ts packages/core/src/ledger-service.test.ts packages/core/src/ledger.ts
git commit -m "feat(core): add archiveTask, deprecate closeTask as alias

LedgerService.archiveTask is the new name. closeTask is now a thin
forwarder to archiveTask, marked @deprecated. Both work for two minor
releases; closeTask removed after."
```

---

## Task 9 — Add `POST /api/tasks/{taskKey}/archive` endpoint + keep `/close` as deprecated alias

**Files:**
- Modify: `packages/http/src/index.ts:130-137` (route def for `/close`); `:451-460` (handler)
- Modify: `packages/http/src/index.test.ts` (add test for archive endpoint, update close test to assert deprecation headers)

- [ ] **Step 1: Write failing tests**

In `packages/http/src/index.test.ts`:

```ts
test("POST /api/tasks/:taskKey/archive archives a task", async () => {
  const app = makeTestApp();
  // setup: create workspace + task
  await app.request("/api/workspaces", { method: "POST", headers: authHeaders, body: JSON.stringify({ key: "ws" }) });
  await app.request("/api/tasks", { method: "POST", headers: authHeaders, body: JSON.stringify({ workspace: "ws", key: "t-1" }) });

  const res = await app.request("/api/tasks/t-1/archive", { method: "POST", headers: authHeaders });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("closed");
});

test("POST /api/tasks/:taskKey/close still works but emits deprecation headers", async () => {
  const app = makeTestApp();
  await app.request("/api/workspaces", { method: "POST", headers: authHeaders, body: JSON.stringify({ key: "ws" }) });
  await app.request("/api/tasks", { method: "POST", headers: authHeaders, body: JSON.stringify({ workspace: "ws", key: "t-2" }) });

  const res = await app.request("/api/tasks/t-2/close", { method: "POST", headers: authHeaders });
  expect(res.status).toBe(200);
  expect(res.headers.get("Deprecation")).toBeTruthy();
  expect(res.headers.get("Sunset")).toBeTruthy();
  expect(res.headers.get("Link")).toContain("rel=\"successor-version\"");
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
pnpm --filter @ttoksem/http test
```

Expected: archive test fails (no route); close test fails (no Deprecation header).

- [ ] **Step 3: Add archive route + deprecate close**

In `packages/http/src/index.ts`:

1. Define a new route for `POST /api/tasks/{taskKey}/archive`. Match the existing `/close` route's auth, scope, and handler shape. The handler calls `service.archiveTask(...)`.
2. Modify the existing `/close` handler (line 451-460) to:
   - Set `Deprecation: <RFC date>`
   - Set `Sunset: <RFC date 2 minor releases out>`
   - Set `Link: </api/tasks/{taskKey}/archive>; rel="successor-version"`
   - Forward to `service.closeTask` (which is itself the deprecated alias) — body unchanged.

Code sketch (adjust to match the file's existing OpenAPI route registration style):

```ts
// New route object — mirror the close route pattern
const archiveTaskRoute = createRoute({
  method: "post",
  path: "/api/tasks/{taskKey}/archive",
  // ... same security/responses/params as the close route
});

// In the route registration chain, after .openapi(closeTaskRoute, closeHandler):
.openapi(archiveTaskRoute, async (c) => {
  const { taskKey } = c.req.valid("param");
  const workspace = c.req.valid("query").workspace;
  const archived = await service.archiveTask({ workspace: { key: workspace }, key: taskKey });
  return c.json(archived);
})

// Modify the existing close handler — add deprecation headers, keep behavior
.openapi(closeTaskRoute, async (c) => {
  c.header("Deprecation", "Mon, 07 May 2026 00:00:00 GMT");
  c.header("Sunset", "Sat, 07 Nov 2026 00:00:00 GMT");
  c.header("Link", "</api/tasks/{taskKey}/archive>; rel=\"successor-version\"");
  const { taskKey } = c.req.valid("param");
  const workspace = c.req.valid("query").workspace;
  const archived = await service.archiveTask({ workspace: { key: workspace }, key: taskKey });
  return c.json(archived);
})
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm --filter @ttoksem/http test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add POST /api/tasks/:taskKey/archive, deprecate /close

Archive endpoint is the successor. Close endpoint still works for two
minor releases and emits Deprecation, Sunset, and Link successor-version
headers. After Sunset, /close will return 410 Gone, then be removed."
```

---

## Task 10 — Add CLI `task archive` command + deprecate `task close`

**Files:**
- Modify: `packages/cli/src/index.ts:146-160` (existing `task close` command)
- Modify: `packages/cli/src/index.ts:93-116` (existing `task start` command — verify no setActiveTask remnants)
- Modify: `packages/cli/src/index.ts:177-190` (existing `task active` listing — verify still works for "tasks with status=active", which is unchanged)

- [ ] **Step 1: Read the existing close + start commands and confirm they call into `service.closeTask` / `service.startTask`**

```bash
sed -n '90,200p' packages/cli/src/index.ts
```

Verify: `task start` calls `service.startTask` (no longer sets active pointer — already fixed in Task 5). `task close` calls `service.closeTask`. `task active` lists tasks where `status === "active"` (this is task lifecycle status, not workspace pointer; leave alone).

- [ ] **Step 2: Add `task archive` command**

Locate where the existing `task close` command is registered (line 146-160) and add a sibling `task archive` command. Match its argument shape (`<key>` positional + `--workspace`). Body calls `service.archiveTask(...)`.

```ts
// Around line 146, after the close command registration:
program
  .command("archive <key>")
  .description("Archive a task by key")
  .option("--workspace <key>", "Workspace key")
  .action(async (key: string, opts) => {
    const { service, close } = await makeLedger(opts);
    try {
      const archived = await service.archiveTask({
        workspace: opts.workspace ? { key: opts.workspace } : { rootPath: process.cwd() },
        key,
      });
      console.log(`task ${archived.key} archived ${archived.id} ${archived.status}`);
    } finally {
      close();
    }
  });
```

> Match the actual command-registration style used in this file. The codebase may use Commander, Yargs, or a custom CLI framework — read the close command as a template.

- [ ] **Step 3: Make `task close` emit deprecation warning + forward to archive**

Replace the body of the existing `task close` command so it prints to stderr and forwards:

```ts
program
  .command("close <key>")
  .description("(deprecated — use 'task archive') Close a task by key")
  .option("--workspace <key>", "Workspace key")
  .action(async (key: string, opts) => {
    process.stderr.write(
      "[deprecation] `task close` is renamed to `task archive`. Update your scripts. " +
      "This alias will be removed in two minor releases.\n",
    );
    const { service, close } = await makeLedger(opts);
    try {
      const archived = await service.archiveTask({
        workspace: opts.workspace ? { key: opts.workspace } : { rootPath: process.cwd() },
        key,
      });
      console.log(`task ${archived.key} archived ${archived.id} ${archived.status}`);
    } finally {
      close();
    }
  });
```

> Note: the previous `close` command may have allowed an optional key (with active-task fallback). After Task 5, `service.closeTask` requires a key. Update the CLI accordingly — make `<key>` positional and required.

- [ ] **Step 4: Verify `task start` no longer prints "active" language**

The existing `task start` (line 93-116) likely outputs something like `task <key> active <id>`. Update the log line to reflect that "start" now means "task upserted + status=active" with no workspace-level pointer:

```ts
console.log(`task ${started.key} ${started.status} ${started.id}`);
// e.g. "task design-foo active task_abc"
```

This is a cosmetic change to match the new mental model. The output format change is a minor breaking change for any scripts parsing this — note in MIGRATION.md (Task 12).

- [ ] **Step 5: Manual smoke test**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem/ttoksem
rm -f /tmp/ttoksem-cli-smoke.db
TTOKSEM_DB=/tmp/ttoksem-cli-smoke.db pnpm cli init --workspace cli-smoke --root-path /tmp
TTOKSEM_DB=/tmp/ttoksem-cli-smoke.db pnpm cli task start smoke-task --workspace cli-smoke
TTOKSEM_DB=/tmp/ttoksem-cli-smoke.db pnpm cli task archive smoke-task --workspace cli-smoke
TTOKSEM_DB=/tmp/ttoksem-cli-smoke.db pnpm cli task start smoke-task-2 --workspace cli-smoke
TTOKSEM_DB=/tmp/ttoksem-cli-smoke.db pnpm cli task close smoke-task-2 --workspace cli-smoke 2>&1 | grep -i deprecation
```

Expected:
- `task archive smoke-task` succeeds, prints status `closed`.
- `task close smoke-task-2` succeeds (still works), and stderr contains `[deprecation] task close is renamed`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add 'task archive' command, deprecate 'task close'

- task archive <key>: new canonical name
- task close <key>: works as alias, prints deprecation warning to stderr
- task start <key>: log line no longer references 'active' as a
  workspace concept (still uses status=active for task lifecycle)

Active task removal: with workspace.active_task_id gone, 'task close'
without a key is no longer ambiguous-but-default — key is required."
```

---

## Task 11 — Final test sweep

After all the above, run the whole workspace and fix lingering test breakage.

- [ ] **Step 1: Run everything**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem/ttoksem
pnpm test
```

- [ ] **Step 2: Inspect any remaining failures**

Likely sources:
- Tests that asserted `workspace.active_task_id === ...` — delete or rewrite
- Tests that called `service.closeTask({ workspace })` without `key` — update to pass key, or convert to `archiveTask`
- HTTP tests asserting the old close response shape without deprecation headers — update assertions

- [ ] **Step 3: Fix and commit per-package**

For each package with remaining failures:

```bash
pnpm --filter <package-name> test  # iterate until green
git add packages/<name>/...
git commit -m "test(<name>): align with active task removal + archive rename"
```

- [ ] **Step 4: Verify build is clean**

```bash
pnpm build
pnpm test
```

Both should be green workspace-wide.

---

## Task 12 — Write `MIGRATION.md`

User-facing migration guide.

**Files:**
- Create: `ttoksem/MIGRATION.md`

- [ ] **Step 1: Draft the migration guide**

```bash
cat > ttoksem/MIGRATION.md <<'EOF'
# Migration Guide

## v0.X → v0.Y — Active task removal + archive rename

### What changed

1. **Workspace-level "active task" is removed.** The `workspace.active_task_id`
   column is dropped from the database; `LedgerStore.setActiveTask` and
   `GET /api/tasks/active` are gone. The CLI command `task start <key>` no
   longer marks the task as the workspace's "current" one.
2. **`task close` is renamed to `task archive`.** Both work for two minor
   releases; `task close` prints a deprecation warning. After the Sunset
   date, `task close` is removed.
3. **`closeTask` requires `key`.** Previously, calling `service.closeTask`
   or the CLI `task close` without a key would close the workspace's active
   task. With active task gone, `key` is required.

### Why

A workspace-level active task pointer breaks down with multi-machine,
multi-terminal, multi-agent workflows. See ADR-0010.

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
export TTOKSEM_TASK=design-feature  # set in your shell
pnpm cli task start design-feature --workspace ws
# ... do work; autocapture reads $TTOKSEM_TASK
pnpm cli task archive design-feature --workspace ws
unset TTOKSEM_TASK
```

> Note: `TTOKSEM_TASK` plumbing through autocapture lands in Plan 3. Until
> then, you can still use `task start`/`task archive` to manage tasks; the
> autocapture hook just won't auto-inject a task without `TTOKSEM_TASK`.

#### Database migration

The schema migration (`0003_drop_active_task_id`) runs automatically the
first time you start the CLI/server after upgrading. It rebuilds the
`workspaces` table without the `active_task_id` column. The migration is
forward-only and idempotent.

If you want to inspect existing `active_task_id` values before they're
dropped:

```bash
sqlite3 .ttoksem/ttoksem.db "SELECT key, active_task_id FROM workspaces"
```

The migration runs in a single transaction; if it fails partway, the DB
rolls back to the previous state.

#### HTTP clients

- `GET /api/tasks/active` returns 410 Gone. Stop calling it. Track the
  active task client-side via your shell's `TTOKSEM_TASK`.
- `POST /api/tasks/{taskKey}/close` still works but sets a `Deprecation`
  header and a `Sunset` header. Switch to `POST /api/tasks/{taskKey}/archive`.
- The archive endpoint accepts the same `?workspace=` parameter as close.

### Sunset timeline

- `task close` (CLI), `POST /api/tasks/{taskKey}/close` (HTTP):
  Deprecated `2026-05-07`, removed `2026-11-07` (two minor releases).
- `GET /api/tasks/active`: 410 Gone now, route deleted at next minor
  after `2026-11-07`.

### Rollback

The DB migration is forward-only. To roll back, restore from a backup
taken before the upgrade. (Recommended: `cp .ttoksem/ttoksem.db
.ttoksem/ttoksem.db.bak.<timestamp>` before first launch on the new
version.)
EOF
```

- [ ] **Step 2: Verify the file exists and reads correctly**

```bash
wc -l ttoksem/MIGRATION.md
head -30 ttoksem/MIGRATION.md
```

- [ ] **Step 3: Commit**

```bash
git add ttoksem/MIGRATION.md
git commit -m "docs: add MIGRATION.md for active task removal + archive rename

User-facing guide covering: schema migration, CLI command rename, HTTP
endpoint deprecation, sunset timeline, and rollback note."
```

---

## Self-Review Checklist (run before declaring Plan 1 done)

- [ ] All 12 tasks above are committed
- [ ] `pnpm build` is clean across the workspace
- [ ] `pnpm test` is green across the workspace
- [ ] The new file `packages/core/src/ledger.ts` exports `Ledger` and is re-exported from `packages/core/src/index.ts`
- [ ] `LedgerService implements Ledger` compiles without `// @ts-expect-error` or `as unknown as Ledger`
- [ ] DB migration `0003_drop_active_task_id` is recorded in the schema_migrations table after a fresh CLI run; no `active_task_id` column remains
- [ ] `pnpm cli task close <key>` prints `[deprecation]` to stderr and still archives the task
- [ ] `curl http://localhost:.../api/tasks/active` returns 410 Gone with `Sunset` header
- [ ] `MIGRATION.md` exists at the repo root of the implementation repo

When all checked, Plan 1 is complete. Open Plan 2 (API parity) when ready.
