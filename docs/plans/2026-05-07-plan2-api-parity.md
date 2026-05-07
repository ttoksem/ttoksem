# Plan 2 — HTTP API parity for the `Ledger` interface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the HTTP surface to full parity with a refactored three-tier `Ledger` / `AdminLedger` / `LocalLedger` interface so that a future `HttpLedgerClient` (Plan 3) can implement `Ledger` purely via HTTP calls.

**Architecture:** Split `packages/core/src/ledger.ts` into `Ledger` (remote-safe), `AdminLedger extends Ledger` (privileged, CLI-only), and `LocalLedger extends AdminLedger` (filesystem-bound). `LedgerService implements LocalLedger`. Add 6 new GET routes for `Ledger` methods that currently lack HTTP coverage (`listWorkspaces`, `listInbox`, `showInboxGroup`, `getPricingSourceSnapshot`, `reportToday`, `reportTask`). All new routes use `dashboard:read` scope, matching the existing read-route convention. Privileged ops (key management, pricing upserts, reprice / migrate) and local ops (init, currentWorkspace, resolveWorkspace) intentionally stay off HTTP.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Hono + `@hono/zod-openapi`, Zod, `@ttoksem/schema`, `@ttoksem/core`.

**Related design:** [docs/specs/2026-05-07-plan2-api-parity-design.md](../specs/2026-05-07-plan2-api-parity-design.md).

---

## File Structure

### Files to modify

| Path | What changes |
|---|---|
| `packages/core/src/ledger.ts` | Split single `Ledger` into three interfaces (`Ledger`, `AdminLedger extends Ledger`, `LocalLedger extends AdminLedger`); export all three |
| `packages/core/src/index.ts` | Re-export `AdminLedger`, `LocalLedger` (in addition to existing `Ledger` export) |
| `packages/core/src/ledger-service.ts` | `class LedgerService implements LocalLedger` (was `implements Ledger`); update the type-only import |
| `packages/core/src/ledger.test.ts` | Replace the single type-level assertion with three: `LedgerService → LocalLedger`, `LocalLedger → AdminLedger`, `AdminLedger → Ledger` |
| `packages/http/src/index.ts` | Add 6 new route definitions + handlers; add reusable response Zod schemas; no edits to existing routes |
| `packages/http/src/index.test.ts` | Add 12 new tests (happy path + auth gate per new route); extend `fakeService()` defaults to cover `listWorkspaces`, `listInbox`, `showInboxGroup`, `getPricingSourceSnapshot`, `reportToday`, `reportTask` |

### Files NOT touched

- `packages/storage*` — no DB or schema changes.
- `packages/cli/*` — no CLI surface change.
- `apps/server`, `apps/worker` — they consume `createHttpApp` unchanged.
- `MIGRATION.md` — additive HTTP routes are not breaking; no migration note needed.

### Working directory

Implementation should run in a fresh worktree (recommended) at `/Users/johwanghee/Documents/hwanghee/ttoksem-plan2-api-parity` against branch `plan2-api-parity` cut from `main` (HEAD `ceb2ce5` after Plan 1 merge). Paths in this plan are repo-relative and resolve at the worktree root — there is no nested `ttoksem/` subdirectory.

---

## Task 1 — Split `Ledger` into a three-tier hierarchy

Pure type refactor. No runtime behavior change. Compile-time enforcement that admin/local methods are not callable through `Ledger` typed references.

**Files:**
- Modify: `packages/core/src/ledger.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/ledger-service.ts`
- Modify: `packages/core/src/ledger.test.ts`

- [ ] **Step 1: Refactor `packages/core/src/ledger.ts` into three interfaces**

Read the current file. It has one big `Ledger` interface. Split it as follows. Keep all existing JSDoc + `@deprecated` annotations on their current methods. Do NOT change any method signatures.

The destination shape:

```ts
import type {
  AccessKeyRecord,
  AccessKeyVerificationResult,
  AiUsageObserved,
  DailyReport,
  PricingMigrationResult,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
  RepriceResult,
  RunAction,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  AssignInboxEventInput,
  AssignInboxGroupInput,
  AcceptInboxGroupInput,
  CreateWorkspaceInput,
  DashboardData,
  DashboardTaskDetailData,
  InboxAssignmentResult,
  InboxGroup,
  PricingRuleUpsertInput,
  TaskStats,
  UpdateTaskInput,
  UpsertPricingSourceSnapshotInput,
  WorkspaceResolver,
} from "./ledger-service.js";

/**
 * Remote-safe business operations. HttpLedgerClient (Plan 3) implements
 * exactly this interface. Anything in here is callable over HTTP.
 *
 * Note: `verifyAccessKey` lives here because the HTTP server uses it
 * internally during request authorization — it is remote-safe in concept
 * even though no public route exposes it.
 */
export interface Ledger {
  // Workspaces (read + create)
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;

  // Tasks
  startTask(input: { workspace: WorkspaceResolver; key: string; name?: string; description?: string }): Promise<TaskRecord>;
  /** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
  closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
  archiveTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
  listTasks(input: { workspace: WorkspaceResolver }): Promise<TaskRecord[]>;
  updateTask(input: UpdateTaskInput): Promise<TaskRecord>;
  getTaskStats(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskStats>;

  // Runs
  runActions(input: { workspace: WorkspaceResolver; runId: string }): Promise<RunAction[]>;
  runMeta(input: { workspace: WorkspaceResolver; runId: string }): Promise<{ run_id: string; task_key: string; task_name: string } | null>;

  // Usage (read + record + assignment)
  recordUsage(message: AiUsageObserved): Promise<UsageEventRecord>;
  moveUsage(input: { workspace: WorkspaceResolver; usageEventId: string; taskKey: string }): Promise<UsageEventRecord>;
  listUnpricedUsage(input: { workspace: WorkspaceResolver; limit?: number }): Promise<UsageEventRecord[]>;
  getLastImportedAt(input: { workspace: WorkspaceResolver; source: string }): Promise<string | null>;

  // Inbox
  listInbox(input: { workspace: WorkspaceResolver; limit?: number }): Promise<UsageEventRecord[]>;
  listInboxGroups(input: { workspace: WorkspaceResolver; limit?: number }): Promise<InboxGroup[]>;
  showInboxGroup(input: { groupId: string }): Promise<{ group: InboxGroup; events: UsageEventRecord[] }>;
  assignInboxEvent(input: AssignInboxEventInput): Promise<UsageEventRecord>;
  assignInboxGroup(input: AssignInboxGroupInput): Promise<InboxAssignmentResult>;
  acceptInboxGroup(input: AcceptInboxGroupInput): Promise<InboxAssignmentResult>;

  // Dashboard / Reports
  dashboard(input: { workspace: WorkspaceResolver }): Promise<DashboardData>;
  dashboardTask(input: { workspace: WorkspaceResolver; key: string }): Promise<DashboardTaskDetailData>;
  reportToday(input: { workspace: WorkspaceResolver; date?: string }): Promise<DailyReport>;
  reportTask(input: { workspace: WorkspaceResolver; taskKey: string }): Promise<DailyReport>;

  // Pricing reads
  listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]>;
  getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null>;
  listPricingRules(input: { workspace: WorkspaceResolver }): Promise<PricingRuleRecord[]>;

  // Auth (server-internal)
  verifyAccessKey(input: { workspaceKey: string; tokenHash: string; requiredScopes: string[] }): Promise<AccessKeyVerificationResult>;
}

/**
 * Privileged operations layered on top of Ledger. Includes access-key
 * management, pricing-policy writes, and pricing-data maintenance.
 *
 * These are NOT exposed over HTTP. Any HTTP-exposing client should
 * implement only `Ledger`. The local CLI process implements `LocalLedger`
 * (which extends this), so it has admin powers automatically when run on
 * the same host as the database.
 */
export interface AdminLedger extends Ledger {
  // Access keys
  createAccessKey(input: { workspaceKey: string; name: string; scopes: string[]; tokenHash: string; tokenPrefix: string; createdBy?: string }): Promise<AccessKeyRecord>;
  listAccessKeys(): Promise<AccessKeyRecord[]>;
  revokeAccessKey(input: { id: string }): Promise<AccessKeyRecord>;
  countActiveAccessKeys(): Promise<number>;

  // Pricing writes
  upsertPricingRule(input: PricingRuleUpsertInput): Promise<PricingRuleRecord>;
  upsertPricingSourceSnapshot(input: UpsertPricingSourceSnapshotInput): Promise<PricingSourceSnapshotRecord>;

  // Pricing-data maintenance
  repriceUnpricedUsage(input: { workspace: WorkspaceResolver }): Promise<RepriceResult>;
  migrateUsageEventPricing(input: { workspace: WorkspaceResolver }): Promise<PricingMigrationResult>;
}

/**
 * Filesystem- or local-store-bound operations. These have no honest HTTP
 * semantics — `init` initializes a local SQLite DB, `currentWorkspace`
 * maps a client cwd to a workspace, `resolveWorkspace` is an internal
 * helper used to translate user-facing identifiers into a record.
 *
 * Only LedgerService (running in the local CLI process) implements this.
 * HttpLedgerClient does not.
 */
export interface LocalLedger extends AdminLedger {
  init(): Promise<void>;
  currentWorkspace(rootPath: string): Promise<WorkspaceRecord>;
  resolveWorkspace(resolver: WorkspaceResolver): Promise<WorkspaceRecord>;
}
```

> **Cross-check before continuing:** every method currently on `Ledger` (verify by reading the existing `packages/core/src/ledger.ts`) must end up on exactly one of the three new interfaces. Do not drop or rename anything. If you find a method I have not listed, place it on `Ledger` by default unless it (a) takes a `tokenHash`, mutates pricing, or migrates pricing — in which case it goes on `AdminLedger`; or (b) takes a `rootPath` or returns no value with the name `init` — in which case it goes on `LocalLedger`.

> **Type imports:** keep `import type { ... } from "./ledger-service.js"` for service-internal types (e.g. `WorkspaceResolver`, `DashboardData`, `InboxGroup`). The `import type { ... } from "@ttoksem/schema"` block keeps schema-level types. Do not invent new types.

- [ ] **Step 2: Re-export the new tiers from `packages/core/src/index.ts`**

Find the existing `export type { Ledger } from "./ledger.js";` line and extend it:

```ts
export type { Ledger, AdminLedger, LocalLedger } from "./ledger.js";
```

- [ ] **Step 3: Update `packages/core/src/ledger-service.ts` to `implements LocalLedger`**

Locate the `import type { Ledger } from "./ledger.js";` line (added in Plan 1) and the `export class LedgerService implements Ledger {` declaration. Change both:

```ts
import type { LocalLedger } from "./ledger.js";

export class LedgerService implements LocalLedger {
  // ... existing body unchanged
}
```

The compiler will surface any signature drift between `LocalLedger`'s composed surface and `LedgerService`. Fix any drift by aligning the interface to whatever the service actually returns (the service is the source of truth for the existing surface). If `LedgerService` is missing a method that's on `LocalLedger`, that's a real bug — investigate before working around it.

- [ ] **Step 4: Replace the single type-level test with three**

In `packages/core/src/ledger.test.ts`, replace the existing single assertion with the three-tier check:

```ts
import { describe, expectTypeOf, test } from "vitest";
import { LedgerService } from "./ledger-service.js";
import type { AdminLedger, Ledger, LocalLedger } from "./ledger.js";

describe("Ledger interface hierarchy", () => {
  test("LedgerService satisfies LocalLedger", () => {
    expectTypeOf<LedgerService>().toMatchTypeOf<LocalLedger>();
  });

  test("LocalLedger extends AdminLedger", () => {
    expectTypeOf<LocalLedger>().toMatchTypeOf<AdminLedger>();
  });

  test("AdminLedger extends Ledger", () => {
    expectTypeOf<AdminLedger>().toMatchTypeOf<Ledger>();
  });
});
```

- [ ] **Step 5: Run tests and verify**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan2-api-parity
pnpm --filter @ttoksem/core test
```

Expected: all existing tests pass + the three new type-level tests pass.

```bash
pnpm build
```

Expected: clean build, no TypeScript errors workspace-wide.

If `pnpm build` reports errors in `packages/http`, `packages/cli`, or `apps/*`, those modules likely import `Ledger` for type purposes and now use methods that have moved to `AdminLedger` or `LocalLedger`. Switch the imports to `LocalLedger` (the broadest interface that LedgerService implements) — that preserves access to every method the prior code could call.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ledger.ts packages/core/src/ledger.test.ts \
        packages/core/src/index.ts packages/core/src/ledger-service.ts
git commit -m "refactor(core): split Ledger into Ledger / AdminLedger / LocalLedger

Three-tier hierarchy: Ledger (remote-safe ops only), AdminLedger
(privileged ops layered on top), LocalLedger (filesystem-bound ops
on top of admin). LedgerService implements LocalLedger.

HttpLedgerClient (Plan 3) will implement only Ledger, so the type
system enforces that admin and local-only methods are unreachable via
HTTP. No runtime behavior change in this commit.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 2 — `GET /api/workspaces` (listWorkspaces)

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the response schema**

Near the existing response schemas at the top of `packages/http/src/index.ts` (after `WorkspaceResponseSchema`):

```ts
const WorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceRecordSchema),
});
```

- [ ] **Step 2: Add the route definition**

Place the route alongside `routeCreateWorkspace`, before the route definitions for tasks:

```ts
const routeListWorkspaces = createRoute({
  method: "get", path: "/api/workspaces", tags: ["Workspaces"],
  summary: "List all workspaces",
  security: BEARER_AUTH,
  responses: {
    200: { content: { "application/json": { schema: WorkspacesResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
  },
});
```

- [ ] **Step 3: Write the failing tests**

Add to `packages/http/src/index.test.ts` (inside the existing `describe("createHttpApp auth", ...)` block, after the prior tests but before the closing `})`):

```ts
it("lists workspaces via GET /api/workspaces", async () => {
  const app = createHttpApp({
    service: fakeService({
      listWorkspaces: async () => [
        workspaceRecord({ key: "test", name: "Test workspace" }),
        workspaceRecord({ key: "other", name: "Other workspace" }),
      ],
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const response = await app.request("/api/workspaces", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    workspaces: [{ key: "test" }, { key: "other" }],
  });
});

it("requires dashboard:read for GET /api/workspaces", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/workspaces")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/workspaces", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

> If `fakeService()` does not yet have a `listWorkspaces` default, add one returning `[]` in the appropriate factory section of the test file. Find the existing fake-service factory and add `listWorkspaces: input.listWorkspaces ?? (async () => []),` near the other defaults. The same pattern is used for the other new methods in later tasks.

- [ ] **Step 4: Run tests, verify they fail**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan2-api-parity
pnpm --filter @ttoksem/http test
```

Expected: both new tests fail because the route is not registered yet.

- [ ] **Step 5: Implement the handler**

In `packages/http/src/index.ts`, register the handler near the other workspace handlers (after `routeCreateWorkspace`'s handler). Order by route declaration to keep the file's structure scannable:

```ts
app.openapi(routeListWorkspaces, async (c) => {
  const authResponse = await authorizeRequest(c, options.auth, defaultWorkspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  const workspaces = await options.service.listWorkspaces();
  return c.json({ workspaces }, 200);
});
```

> `listWorkspaces` does not take a workspace parameter — it returns all workspaces. The auth call still scopes to `defaultWorkspaceKey` because `authorizeRequest` requires a workspace context for token validation; the read scope `dashboard:read` is what gates the actual access.

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

Expected: both new tests pass; existing tests still green.

- [ ] **Step 7: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/workspaces

Lists all workspaces. Required scope: dashboard:read. Matches the
existing read-route convention. Closes one of six Ledger-parity gaps.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 3 — `GET /api/inbox` (listInbox)

Returns raw inbox events (events without an assigned task). Different from `GET /api/inbox/groups`, which returns aggregated groups.

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the response schema**

Near the existing schemas, add:

```ts
const InboxEventsResponseSchema = z.object({
  events: z.array(UsageEventRecordSchema),
});
```

- [ ] **Step 2: Add the route definition**

Place near `routeListInboxGroups`. Use `WorkspaceQuery` for `?workspace=` and add an optional `limit`:

```ts
const InboxQuery = z.object({
  workspace: z.string().optional(),
  limit: z.string().optional(),
});

const routeListInbox = createRoute({
  method: "get", path: "/api/inbox", tags: ["Inbox"],
  summary: "List inbox events (events with no assigned task)",
  security: BEARER_AUTH,
  request: { query: InboxQuery },
  responses: {
    200: { content: { "application/json": { schema: InboxEventsResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
  },
});
```

> If `InboxQuery` is already declared elsewhere in the file (search for `z.object({` referencing `workspace` and `limit` together), reuse it instead of re-declaring.

- [ ] **Step 3: Write the failing tests**

```ts
it("lists inbox events via GET /api/inbox", async () => {
  const app = createHttpApp({
    service: fakeService({
      listInbox: async () => [
        usageEventRecord({ id: "evt_1" }),
        usageEventRecord({ id: "evt_2" }),
      ],
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const response = await app.request("/api/inbox?workspace=test", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    events: [{ id: "evt_1" }, { id: "evt_2" }],
  });
});

it("requires dashboard:read for GET /api/inbox", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/inbox?workspace=test")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/inbox?workspace=test", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

> If a `usageEventRecord(...)` factory is not yet defined in the test file, add one near the existing `taskRecord` / `workspaceRecord` factories. Look at `UsageEventRecordSchema` in `@ttoksem/schema` for the required fields and provide reasonable defaults (e.g. `id: "evt_test"`, `workspace_id: "ws_test"`, `task_id: null`, `event_uuid: "uuid_test"`, plus zero-valued numeric fields and `created_at: "2026-05-07T00:00:00Z"`). Match what existing usage-event tests expect.

- [ ] **Step 4: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/http test
```

Expected: both new tests fail (route missing).

- [ ] **Step 5: Implement the handler**

```ts
app.openapi(routeListInbox, async (c) => {
  const query = c.req.valid("query");
  const workspaceKey = query.workspace ?? defaultWorkspaceKey;
  const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  const limit = parseLimit(query.limit, 200);
  const events = await options.service.listInbox({
    workspace: workspaceResolver(workspaceKey),
    limit,
  });
  return c.json({ events }, 200);
});
```

> `parseLimit` is the existing helper used by `routeListUnpriced`. Reuse it. If you can't find it, search `parseLimit` to confirm the signature `(value: string | undefined, defaultLimit: number) => number`.

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/inbox

Returns raw inbox events (events without an assigned task). Distinct
from /api/inbox/groups, which returns aggregated groups. Required
scope: dashboard:read.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 4 — `GET /api/inbox/groups/{groupId}` (showInboxGroup)

Returns a single inbox group plus the events it contains. Service signature: `showInboxGroup({ groupId }) → { group, events }`. No workspace parameter — `groupId` is global.

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the response schema**

```ts
const InboxGroupShowResponseSchema = z.object({
  group: z.unknown(), // InboxGroup is service-internal; z.unknown() matches the existing approach used by InboxAssignResultSchema
  events: z.array(UsageEventRecordSchema),
});
```

> If a Zod schema for `InboxGroup` exists in `@ttoksem/schema` or is locally declared in this file, use it instead of `z.unknown()`. Otherwise `z.unknown()` is consistent with how `InboxAssignResultSchema` already declares its `group` field.

- [ ] **Step 2: Add the route definition**

```ts
const InboxGroupIdParam = z.object({ groupId: z.string() });

const routeShowInboxGroup = createRoute({
  method: "get", path: "/api/inbox/groups/{groupId}", tags: ["Inbox"],
  summary: "Show a single inbox group with its events",
  security: BEARER_AUTH,
  request: { params: InboxGroupIdParam },
  responses: {
    200: { content: { "application/json": { schema: InboxGroupShowResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Group not found" },
  },
});
```

> Check whether `routeAssignInboxGroup` already declares `InboxGroupIdParam` (or a parameter object with `groupId`). Reuse if so.

- [ ] **Step 3: Write the failing tests**

```ts
it("shows an inbox group via GET /api/inbox/groups/:groupId", async () => {
  const app = createHttpApp({
    service: fakeService({
      showInboxGroup: async ({ groupId }) => ({
        group: { group_id: groupId, source: "claude-session", session_id: "s1", source_context: {}, prompt_text_sha256: null, prompt_text: null, model: null, event_count: 1, total_input_tokens: 0, total_output_tokens: 0, first_event_at: "2026-05-07T00:00:00Z", last_event_at: "2026-05-07T00:00:00Z", task: null },
        events: [usageEventRecord({ id: "evt_1" })],
      }),
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const response = await app.request("/api/inbox/groups/grp_123", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    group: { group_id: "grp_123" },
    events: [{ id: "evt_1" }],
  });
});

it("requires dashboard:read for GET /api/inbox/groups/:groupId", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/inbox/groups/grp_x")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/inbox/groups/grp_x", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

> The fake `showInboxGroup` returns a fully-shaped `InboxGroup`. If the actual `InboxGroup` type has additional required fields, copy them from the existing inbox tests' fixtures.

- [ ] **Step 4: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 5: Implement the handler**

```ts
app.openapi(routeShowInboxGroup, async (c) => {
  const authResponse = await authorizeRequest(c, options.auth, defaultWorkspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  try {
    const result = await options.service.showInboxGroup({
      groupId: c.req.valid("param").groupId,
    });
    return c.json(result, 200);
  } catch {
    return c.json({ error: "Inbox group not found" }, 404);
  }
});
```

> The service throws on missing groups (verify by reading `showInboxGroup` in `packages/core/src/ledger-service.ts`). The catch translates that to a 404 — same pattern as `routeTaskStats`. If the service returns `null` instead, change the handler to `if (!result) return c.json({ error: "Inbox group not found" }, 404);` and drop the try/catch.

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 7: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/inbox/groups/:groupId

Returns a single inbox group plus its events. 404 on unknown groupId.
Required scope: dashboard:read.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 5 — `GET /api/pricing/snapshots/{id}` (getPricingSourceSnapshot)

Returns a single pricing source snapshot by ID, or 404. Service: `getPricingSourceSnapshot(id) → PricingSourceSnapshotRecord | null`.

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the response schema**

```ts
const PricingSnapshotResponseSchema = z.object({
  snapshot: PricingSourceSnapshotRecordSchema,
});
```

- [ ] **Step 2: Add the route definition**

```ts
const PricingSnapshotIdParam = z.object({ id: z.string() });

const routeGetPricingSnapshot = createRoute({
  method: "get", path: "/api/pricing/snapshots/{id}", tags: ["Pricing"],
  summary: "Get a pricing source snapshot by ID",
  security: BEARER_AUTH,
  request: { params: PricingSnapshotIdParam },
  responses: {
    200: { content: { "application/json": { schema: PricingSnapshotResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Snapshot not found" },
  },
});
```

- [ ] **Step 3: Write the failing tests**

```ts
it("returns a pricing snapshot via GET /api/pricing/snapshots/:id", async () => {
  const snapshot = pricingSnapshotRecord({ id: "snap_test", label: "Anthropic 2026-05" });
  const app = createHttpApp({
    service: fakeService({
      getPricingSourceSnapshot: async (id) => (id === "snap_test" ? snapshot : null),
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const ok = await app.request("/api/pricing/snapshots/snap_test", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(ok.status).toBe(200);
  await expect(ok.json()).resolves.toMatchObject({ snapshot: { id: "snap_test" } });

  const missing = await app.request("/api/pricing/snapshots/missing", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(missing.status).toBe(404);
});

it("requires dashboard:read for GET /api/pricing/snapshots/:id", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/pricing/snapshots/snap_x")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/pricing/snapshots/snap_x", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

> Add a `pricingSnapshotRecord` factory in the test file if one does not exist. Pull the required fields from `PricingSourceSnapshotRecordSchema` in `@ttoksem/schema`. Defaults: `id`, `label`, `source: "anthropic"`, `source_url: null`, `fetched_at: "2026-05-07T00:00:00Z"`, `payload: {}`, `created_at: "2026-05-07T00:00:00Z"`. Match what `routeListPricingSnapshots`'s tests already use, if any.

- [ ] **Step 4: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 5: Implement the handler**

```ts
app.openapi(routeGetPricingSnapshot, async (c) => {
  const authResponse = await authorizeRequest(c, options.auth, defaultWorkspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  const snapshot = await options.service.getPricingSourceSnapshot(c.req.valid("param").id);
  if (!snapshot) return c.json({ error: "Pricing snapshot not found" }, 404);
  return c.json({ snapshot }, 200);
});
```

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 7: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/pricing/snapshots/:id

Returns a single pricing source snapshot by ID. 404 on miss. Required
scope: dashboard:read.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 6 — `GET /api/reports/today` (reportToday)

Returns the daily report for a workspace. Service: `reportToday({ workspace, date? }) → DailyReport`.

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the response schema**

`DailyReportSchema` already exists in `@ttoksem/schema`. Import it at the top of `packages/http/src/index.ts`:

```ts
import {
  AiUsageObservedSchema,
  WorkspaceRecordSchema,
  TaskRecordSchema,
  UsageEventRecordSchema,
  PricingSourceSnapshotRecordSchema,
  PricingRuleRecordSchema,
  DailyReportSchema,                                // <-- add
} from "@ttoksem/schema";
```

Then add a wrapper schema:

```ts
const ReportResponseSchema = z.object({ report: DailyReportSchema });
```

- [ ] **Step 2: Add the route definition**

```ts
const ReportTodayQuery = z.object({
  workspace: z.string().optional(),
  date: z.string().optional(),
});

const routeReportToday = createRoute({
  method: "get", path: "/api/reports/today", tags: ["Reports"],
  summary: "Daily report for a workspace",
  security: BEARER_AUTH,
  request: { query: ReportTodayQuery },
  responses: {
    200: { content: { "application/json": { schema: ReportResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
  },
});
```

- [ ] **Step 3: Write the failing tests**

```ts
it("returns today's report via GET /api/reports/today", async () => {
  const report = dailyReport({ date: "2026-05-07" });
  const app = createHttpApp({
    service: fakeService({
      reportToday: async () => report,
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const response = await app.request("/api/reports/today?workspace=test", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    report: { date: "2026-05-07" },
  });
});

it("requires dashboard:read for GET /api/reports/today", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/reports/today?workspace=test")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/reports/today?workspace=test", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

> Add a `dailyReport(...)` factory in the test file. Pull required fields from `DailyReportSchema` in `@ttoksem/schema`. Provide minimal defaults that satisfy the schema: `workspace_id`, `workspace_key`, `date`, totals, `rows: []`. Match the schema literally.

- [ ] **Step 4: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 5: Implement the handler**

```ts
app.openapi(routeReportToday, async (c) => {
  const query = c.req.valid("query");
  const workspaceKey = query.workspace ?? defaultWorkspaceKey;
  const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  const report = await options.service.reportToday({
    workspace: workspaceResolver(workspaceKey),
    date: query.date,
  });
  return c.json({ report }, 200);
});
```

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 7: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/reports/today

Daily report for a workspace. Optional ?date=YYYY-MM-DD; defaults to
today on the server clock. Required scope: dashboard:read.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 7 — `GET /api/reports/tasks/{taskKey}` (reportTask)

Per-task daily report. Service: `reportTask({ workspace, taskKey }) → DailyReport`.

**Files:**
- Modify: `packages/http/src/index.ts`
- Modify: `packages/http/src/index.test.ts`

- [ ] **Step 1: Add the route definition**

`ReportResponseSchema` was added in Task 6. Reuse.

```ts
const routeReportTask = createRoute({
  method: "get", path: "/api/reports/tasks/{taskKey}", tags: ["Reports"],
  summary: "Daily report for a single task",
  security: BEARER_AUTH,
  request: { params: TaskKeyParam, query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: ReportResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
  },
});
```

- [ ] **Step 2: Write the failing tests**

```ts
it("returns a per-task report via GET /api/reports/tasks/:taskKey", async () => {
  const report = dailyReport({ date: "2026-05-07" });
  const app = createHttpApp({
    service: fakeService({
      reportTask: async ({ taskKey }) => report,
    }),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  const response = await app.request("/api/reports/tasks/feature-x?workspace=test", {
    headers: { Authorization: "Bearer valid-token" },
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    report: { date: "2026-05-07" },
  });
});

it("requires dashboard:read for GET /api/reports/tasks/:taskKey", async () => {
  const app = createHttpApp({
    service: fakeService(),
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async ({ token, requiredScopes }) =>
        token === "valid-token" && requiredScopes.includes("dashboard:read"),
    },
  });

  await expect(app.request("/api/reports/tasks/feature-x?workspace=test")).resolves.toMatchObject({ status: 401 });
  await expect(
    app.request("/api/reports/tasks/feature-x?workspace=test", { headers: { Authorization: "Bearer wrong-token" } }),
  ).resolves.toMatchObject({ status: 403 });
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 4: Implement the handler**

```ts
app.openapi(routeReportTask, async (c) => {
  const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
  const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
  if (authResponse) return authResponse as never;
  const report = await options.service.reportTask({
    workspace: workspaceResolver(workspaceKey),
    taskKey: c.req.valid("param").taskKey,
  });
  return c.json({ report }, 200);
});
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/http test
```

- [ ] **Step 6: Commit**

```bash
git add packages/http/src/index.ts packages/http/src/index.test.ts
git commit -m "feat(http): add GET /api/reports/tasks/:taskKey

Per-task daily report. Required scope: dashboard:read.

Closes the final Ledger-parity gap on the read side. Privileged ops
(key management, pricing upserts, reprice / migrate) and local ops
(init, currentWorkspace, resolveWorkspace) intentionally remain off
HTTP per the Plan 2 design.

Refs: docs/specs/2026-05-07-plan2-api-parity-design.md"
```

---

## Task 8 — Final test sweep

After all the above, run the whole workspace and confirm everything is green.

- [ ] **Step 1: Run everything**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan2-api-parity
pnpm test
pnpm build
```

Expected: all packages green; clean build across all 10 projects.

- [ ] **Step 2: Inspect any remaining failures**

If anything fails, the most likely sources are:

- A test referencing a `fakeService` default that wasn't extended for one of the new methods. Fix the factory in `packages/http/src/index.test.ts`.
- An import of `Ledger` in some module that now needs a method on `AdminLedger` or `LocalLedger`. Switch the import to the broadest interface (`LocalLedger`) at that callsite.
- A type-only test failing because the three-tier hierarchy disagrees with the service. Fix the interface to match the service (the service is the source of truth).

Fix and commit per-package as needed:

```bash
pnpm --filter <package> test  # iterate until green
git add packages/<name>/...
git commit -m "test(<name>): align with Plan 2 Ledger split"
```

- [ ] **Step 3: No commit if everything is already green**

If `pnpm test` and `pnpm build` are both green at the start of Step 1, this task is a no-op — no commit needed. Just check, log the result, and move on.

---

## Self-Review Checklist (run before declaring Plan 2 done)

- [ ] All 8 tasks above are committed (Task 8 may produce zero commits if the workspace was already green).
- [ ] `pnpm build` is clean across the workspace.
- [ ] `pnpm test` is green across the workspace.
- [ ] `packages/core/src/ledger.ts` exports three interfaces: `Ledger`, `AdminLedger`, `LocalLedger`.
- [ ] `LedgerService implements LocalLedger` (verify by reading the class declaration).
- [ ] `expectTypeOf` assertions cover all three tier relationships (`LedgerService → LocalLedger`, `LocalLedger → AdminLedger`, `AdminLedger → Ledger`).
- [ ] All six new HTTP routes return 200 + the documented response shape on the happy path, 401 on missing token, 403 on wrong scope.
- [ ] `GET /api/inbox/groups/:groupId` returns 404 on unknown group; `GET /api/pricing/snapshots/:id` returns 404 on unknown snapshot.
- [ ] No HTTP routes were added for any `AdminLedger` or `LocalLedger` method — verify by re-reading the new `packages/http/src/index.ts` route registrations and cross-checking against the membership lists in `docs/specs/2026-05-07-plan2-api-parity-design.md`.
- [ ] The OpenAPI spec generated by Hono includes the six new routes with `dashboard:read` security.

When all checked, Plan 2 is complete. Open Plan 3 (HttpLedgerClient + TTOKSEM_TASK) when ready.
