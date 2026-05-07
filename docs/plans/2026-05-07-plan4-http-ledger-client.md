# Plan 4 — `HttpLedgerClient` + CLI remote-mode wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `Ledger`-implementing HTTP client (`@ttoksem/ledger-http`) and wire the CLI to switch to remote mode when `TTOKSEM_HTTP_URL` is set.

**Architecture:** New package `packages/ledger-http/` with `HttpLedgerClient` (one method per `Ledger` member, each a thin fetch wrapper) and `HttpLedgerError` (status-aware error class). CLI gains a `makeLedger()` factory: returns `HttpLedgerClient` when `TTOKSEM_HTTP_URL` is set, falls back to `LedgerService` otherwise. Subcommands needing admin/local capabilities are guarded by `requireLocalLedger(ledger)` which hard-errors in remote mode.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Hono (`app.fetch` injection for tests), global fetch (Node ≥22).

**Related design:** [docs/specs/2026-05-07-plan4-http-ledger-client-design.md](../specs/2026-05-07-plan4-http-ledger-client-design.md).

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `packages/ledger-http/package.json` | `@ttoksem/ledger-http` workspace package |
| `packages/ledger-http/tsconfig.json` | TS project ref pointing at core + schema |
| `packages/ledger-http/src/index.ts` | Re-exports `HttpLedgerClient`, `HttpLedgerError`, types |
| `packages/ledger-http/src/errors.ts` | `HttpLedgerError` class |
| `packages/ledger-http/src/client.ts` | `HttpLedgerClient` — one method per `Ledger` member |
| `packages/ledger-http/src/client.type.test.ts` | Type-level `expectTypeOf<HttpLedgerClient>().toMatchTypeOf<Ledger>()` |
| `packages/ledger-http/src/client.test.ts` | Per-method behavioral tests (in-process Hono `app.fetch`) |
| `packages/cli/src/ledger-factory.ts` | `makeLedger()` + `requireLocalLedger()` |
| `docs/REMOTE-MODE.md` | User-facing guide for remote mode |

### Files to modify

| Path | What changes |
|---|---|
| `packages/cli/package.json` | Add `@ttoksem/ledger-http` dependency |
| `packages/cli/tsconfig.json` | Add `{ "path": "../ledger-http" }` reference |
| `packages/cli/src/index.ts` | Subcommands switch from direct `makeService()` to `makeLedger()`; admin/local subcommands wrap with `requireLocalLedger` |
| `MIGRATION.md` | Add a "Remote mode (Plan 4)" section linking to REMOTE-MODE.md |
| `pnpm-workspace.yaml` (if it lists packages explicitly) | Add `packages/ledger-http` |

### Working directory

Implementation runs in a fresh worktree at `/Users/johwanghee/Documents/hwanghee/ttoksem-plan4-http-ledger-client` against branch `plan4-http-ledger-client` cut from `main` (HEAD `ad6afdc` after the spec commit).

---

## Task 1 — Bootstrap `@ttoksem/ledger-http` package

Pure scaffolding. After this task the package builds (empty), the workspace recognizes it, and a failing type-level test exists to drive subsequent tasks.

**Files:**
- Create: `packages/ledger-http/package.json`
- Create: `packages/ledger-http/tsconfig.json`
- Create: `packages/ledger-http/src/errors.ts`
- Create: `packages/ledger-http/src/client.ts` (skeleton)
- Create: `packages/ledger-http/src/index.ts`
- Create: `packages/ledger-http/src/client.type.test.ts`

- [ ] **Step 1: Create `packages/ledger-http/package.json`**

```json
{
  "name": "@ttoksem/ledger-http",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ttoksem/core": "workspace:*",
    "@ttoksem/schema": "workspace:*"
  },
  "devDependencies": {
    "@ttoksem/http": "workspace:*",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

> `@ttoksem/http` is a devDependency only — it's used by tests to spin up the in-process server, never at runtime by HttpLedgerClient.

- [ ] **Step 2: Create `packages/ledger-http/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../core" }, { "path": "../schema" }],
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/ledger-http/src/errors.ts`**

```ts
export interface HttpLedgerErrorBody {
  error?: string;
  detail?: string;
}

export class HttpLedgerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: HttpLedgerErrorBody,
  ) {
    super(message);
    this.name = "HttpLedgerError";
  }
}
```

- [ ] **Step 4: Create `packages/ledger-http/src/client.ts` skeleton**

```ts
import type { Ledger } from "@ttoksem/core";
import type { WorkspaceResolver } from "@ttoksem/core";
import { HttpLedgerError } from "./errors.js";

export interface HttpLedgerClientOptions {
  baseUrl: string;
  token?: string;
  defaultWorkspaceKey?: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpLedgerClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly defaultWorkspaceKey: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpLedgerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.defaultWorkspaceKey = options.defaultWorkspaceKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new HttpLedgerError(`Network error: ${cause instanceof Error ? cause.message : String(cause)}`, 0);
    }

    if (response.status === 204) return undefined;

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new HttpLedgerError(`Server returned non-JSON response: ${text.slice(0, 100)}`, response.status);
        }
        // Non-JSON error body — fall through to the status-based message below
      }
    }

    if (!response.ok) {
      const body = (parsed && typeof parsed === "object") ? (parsed as { error?: string; detail?: string }) : undefined;
      throw new HttpLedgerError(`HTTP ${response.status}`, response.status, body);
    }

    return parsed;
  }

  protected resolveWorkspaceKey(resolver: WorkspaceResolver | undefined): string {
    if (resolver && "key" in resolver && typeof resolver.key === "string") return resolver.key;
    if (this.defaultWorkspaceKey) return this.defaultWorkspaceKey;
    if (resolver && "rootPath" in resolver) {
      throw new HttpLedgerError(
        "rootPath workspace resolver is not supported in remote mode; resolve to a workspace key first",
        0,
      );
    }
    throw new HttpLedgerError("No workspace key provided and no defaultWorkspaceKey configured", 0);
  }
}

// Use a type assertion at the bottom so the class only needs to declare the
// methods we're actively implementing during the buildout. Once Task 5 lands
// (last batch of methods), we drop the assertion and rely on `implements Ledger`.
export const _httpLedgerClientImplementsLedger: Ledger | null = null as HttpLedgerClient | null;
```

> The dummy `_httpLedgerClientImplementsLedger` line uses the variable type to assert that `HttpLedgerClient` is assignable to `Ledger` at compile time. It will fail (intentionally) until all methods are added in Tasks 2-5. The line is removed in Task 5 in favor of `class HttpLedgerClient implements Ledger`.

- [ ] **Step 5: Create `packages/ledger-http/src/index.ts`**

```ts
export { HttpLedgerClient } from "./client.js";
export type { HttpLedgerClientOptions } from "./client.js";
export { HttpLedgerError } from "./errors.js";
export type { HttpLedgerErrorBody } from "./errors.js";
```

- [ ] **Step 6: Create `packages/ledger-http/src/client.type.test.ts`**

```ts
import { describe, expectTypeOf, test } from "vitest";
import type { Ledger } from "@ttoksem/core";
import { HttpLedgerClient } from "./client.js";

describe("HttpLedgerClient type conformance", () => {
  test("HttpLedgerClient satisfies Ledger", () => {
    expectTypeOf<HttpLedgerClient>().toMatchTypeOf<Ledger>();
  });
});
```

- [ ] **Step 7: Wire the package into the workspace and run install**

Check `pnpm-workspace.yaml` (or top-level `package.json`'s `workspaces` field) for an explicit package list. If `packages/*` is the glob, no edit needed. If it's an explicit list, add `packages/ledger-http`.

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan4-http-ledger-client
pnpm install
pnpm --filter @ttoksem/ledger-http build
```

Expected: package builds; the type-level test will fail (HttpLedgerClient is missing methods). That's intentional — it's the spec sentry for Tasks 2-5.

- [ ] **Step 8: Confirm the failing type test**

```bash
pnpm --filter @ttoksem/ledger-http test
```

Expected: type test fails because `HttpLedgerClient` does not yet implement `Ledger`. Other packages still build clean.

- [ ] **Step 9: Commit**

```bash
git add packages/ledger-http/ pnpm-workspace.yaml 2>/dev/null
git commit -m "feat(ledger-http): bootstrap @ttoksem/ledger-http package

Adds the package skeleton: package.json + tsconfig + HttpLedgerError +
HttpLedgerClient base class with constructor + private request helper
(fetch + JSON + bearer auth + error mapping) + resolveWorkspaceKey
helper. Methods are added in subsequent tasks; the type-level
conformance test currently fails by design and will pass once all
Ledger methods are implemented (Task 5).

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 2 — Workspace + Task methods

Wire 8 methods (`createWorkspace`, `listWorkspaces`, `startTask`, `archiveTask`, `closeTask`, `listTasks`, `updateTask`, `getTaskStats`) onto `HttpLedgerClient`. Each is a thin fetch wrapper.

**Files:**
- Modify: `packages/ledger-http/src/client.ts`
- Modify: `packages/ledger-http/src/client.test.ts` (create on first add)

- [ ] **Step 1: Write failing tests for all 8 methods**

Create `packages/ledger-http/src/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHttpApp } from "@ttoksem/http";
import type { LedgerService, WorkspaceResolver } from "@ttoksem/core";
import type {
  TaskRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import { HttpLedgerClient } from "./client.js";
import { HttpLedgerError } from "./errors.js";

function workspaceRecord(over: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: "ws_test",
    key: "test",
    name: "Test",
    description: null,
    status: "active",
    root_path: null,
    source: "test",
    external_ref_json: null,
    metadata_json: null,
    created_at: "2026-04-28T00:00:00.000Z",
    archived_at: null,
    updated_at: "2026-04-28T00:00:00.000Z",
    ...over,
  };
}

function taskRecord(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task_test",
    workspace_id: "ws_test",
    key: "alpha",
    name: "Alpha",
    description: null,
    type: null,
    status: "active",
    definition_mode: "explicit",
    source: "test",
    external_ref_json: null,
    labels_json: null,
    metadata_json: null,
    created_at: "2026-04-28T00:00:00.000Z",
    started_at: "2026-04-28T00:00:00.000Z",
    closed_at: null,
    updated_at: "2026-04-28T00:00:00.000Z",
    ...over,
  };
}

function buildClient(servicePartial: Partial<LedgerService>) {
  const app = createHttpApp({
    service: { dashboard: async () => undefined, ...servicePartial } as unknown as LedgerService,
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async () => true,  // tests don't exercise auth gating; that's covered by @ttoksem/http
    },
  });
  return new HttpLedgerClient({
    baseUrl: "http://test.invalid",
    token: "test-token",
    defaultWorkspaceKey: "test",
    fetch: app.fetch as typeof fetch,
  });
}

describe("HttpLedgerClient — workspace + task methods", () => {
  it("createWorkspace POSTs to /api/workspaces and returns the workspace", async () => {
    const created: Array<{ key: string; name?: string }> = [];
    const client = buildClient({
      createWorkspace: async (input) => {
        created.push({ key: input.key, name: input.name });
        return workspaceRecord({ key: input.key, name: input.name ?? input.key });
      },
    });
    const ws = await client.createWorkspace({ key: "alpha", name: "Alpha workspace" });
    expect(ws.key).toBe("alpha");
    expect(created).toEqual([{ key: "alpha", name: "Alpha workspace" }]);
  });

  it("listWorkspaces GETs /api/workspaces", async () => {
    const client = buildClient({
      listWorkspaces: async () => [workspaceRecord({ key: "a" }), workspaceRecord({ key: "b" })],
    });
    const ws = await client.listWorkspaces();
    expect(ws.map((w) => w.key)).toEqual(["a", "b"]);
  });

  it("startTask POSTs to /api/tasks", async () => {
    const seen: Array<{ key: string; name?: string }> = [];
    const client = buildClient({
      startTask: async (input) => {
        seen.push({ key: input.key, name: input.name });
        return taskRecord({ key: input.key });
      },
    });
    const t = await client.startTask({ workspace: { key: "test" }, key: "alpha", name: "Alpha" });
    expect(t.key).toBe("alpha");
    expect(seen).toEqual([{ key: "alpha", name: "Alpha" }]);
  });

  it("archiveTask POSTs to /api/tasks/:taskKey/archive", async () => {
    const client = buildClient({
      archiveTask: async ({ key }) => taskRecord({ key, status: "closed" }),
    });
    const t = await client.archiveTask({ workspace: { key: "test" }, key: "alpha" });
    expect(t.status).toBe("closed");
  });

  it("closeTask POSTs to /api/tasks/:taskKey/close (deprecated alias)", async () => {
    const client = buildClient({
      closeTask: async ({ key }) => taskRecord({ key, status: "closed" }),
    });
    const t = await client.closeTask({ workspace: { key: "test" }, key: "alpha" });
    expect(t.status).toBe("closed");
  });

  it("listTasks GETs /api/tasks?workspace=", async () => {
    const client = buildClient({
      listTasks: async () => [taskRecord({ key: "x" }), taskRecord({ key: "y" })],
    });
    const tasks = await client.listTasks({ workspace: { key: "test" } });
    expect(tasks.map((t) => t.key)).toEqual(["x", "y"]);
  });

  it("updateTask PATCHes /api/tasks/:taskKey", async () => {
    const seen: Array<{ key: string; name?: string }> = [];
    const client = buildClient({
      updateTask: async (input) => {
        seen.push({ key: input.key, name: input.name });
        return taskRecord({ key: input.key, name: input.name ?? "Old" });
      },
    });
    const t = await client.updateTask({ workspace: { key: "test" }, key: "alpha", name: "New" });
    expect(t.name).toBe("New");
    expect(seen).toEqual([{ key: "alpha", name: "New" }]);
  });

  it("getTaskStats GETs /api/tasks/:taskKey/stats", async () => {
    const client = buildClient({
      getTaskStats: async () => ({
        key: "alpha",
        status: "active",
        run_count: 3,
        event_count: 7,
        estimated_cost_nanos: 12345,
        unpriced_count: 0,
        first_activity_at: null,
        last_activity_at: null,
      }),
    });
    const stats = await client.getTaskStats({ workspace: { key: "test" }, key: "alpha" });
    expect(stats.run_count).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan4-http-ledger-client
pnpm --filter @ttoksem/ledger-http test
```

Expected: all 8 new tests fail because the methods don't exist yet.

- [ ] **Step 3: Implement the 8 methods on `HttpLedgerClient`**

Append these methods to the class body in `packages/ledger-http/src/client.ts`, before the closing `}`:

```ts
  // Workspace
  async createWorkspace(input: {
    key: string;
    name?: string;
    rootPath?: string | null;
  }): Promise<WorkspaceRecord> {
    const result = await this.request("POST", "/api/workspaces", {
      key: input.key,
      name: input.name,
      root_path: input.rootPath ?? undefined,
    });
    return (result as { workspace: WorkspaceRecord }).workspace;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const result = await this.request("GET", "/api/workspaces");
    return (result as { workspaces: WorkspaceRecord[] }).workspaces;
  }

  // Tasks
  async startTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request("POST", `/api/tasks?workspace=${encodeURIComponent(wk)}`, {
      key: input.key,
      name: input.name,
      description: input.description,
    });
    return (result as { task: TaskRecord }).task;
  }

  async archiveTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(input.key)}/archive?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { task: TaskRecord }).task;
  }

  /** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
  async closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(input.key)}/close?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { task: TaskRecord }).task;
  }

  async listTasks(input: { workspace: WorkspaceResolver }): Promise<TaskRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request("GET", `/api/tasks?workspace=${encodeURIComponent(wk)}`);
    return (result as { tasks: TaskRecord[] }).tasks;
  }

  async updateTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "PATCH",
      `/api/tasks/${encodeURIComponent(input.key)}?workspace=${encodeURIComponent(wk)}`,
      { name: input.name, description: input.description },
    );
    return (result as { task: TaskRecord }).task;
  }

  async getTaskStats(input: {
    workspace: WorkspaceResolver;
    key: string;
  }): Promise<{
    key: string;
    status: string;
    run_count: number;
    event_count: number;
    estimated_cost_nanos: number;
    unpriced_count: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
  }> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/tasks/${encodeURIComponent(input.key)}/stats?workspace=${encodeURIComponent(wk)}`,
    );
    return result as Awaited<ReturnType<HttpLedgerClient["getTaskStats"]>>;
  }
```

Add the corresponding imports at the top of `client.ts`:

```ts
import type { TaskRecord, WorkspaceRecord } from "@ttoksem/schema";
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/ledger-http test
```

Expected: 8 behavioral tests now pass. Type-level test still fails (more methods to add).

- [ ] **Step 5: Commit**

```bash
git add packages/ledger-http/src/client.ts packages/ledger-http/src/client.test.ts
git commit -m "feat(ledger-http): workspace + task methods (8 of ~28)

createWorkspace, listWorkspaces, startTask, archiveTask, closeTask,
listTasks, updateTask, getTaskStats. Each is a thin fetch wrapper that
calls the corresponding @ttoksem/http route and unwraps the JSON
envelope.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 3 — Run + Usage methods

Add 6 methods (`runActions`, `runMeta`, `recordUsage`, `listUnpricedUsage`, `moveUsage`, `getLastImportedAt`).

**Files:**
- Modify: `packages/ledger-http/src/client.ts`
- Modify: `packages/ledger-http/src/client.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `client.test.ts`:

```ts
import type { AiUsageObserved, UsageEventRecord, RunAction } from "@ttoksem/schema";

function usageEventRecord(over: Partial<UsageEventRecord> = {}): UsageEventRecord {
  return {
    id: "usage_test",
    workspace_id: "ws_test",
    task_id: null,
    run_id: null,
    message_id: "msg_test",
    source: "test",
    idempotency_key: null,
    occurred_at: "2026-04-28T00:00:00.000Z",
    started_at: null,
    ended_at: null,
    duration_ms: null,
    provider: "openai",
    model: "gpt-5.5",
    usage_kind: "conversation_turn",
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    observed_cost_nanos: null,
    estimated_cost_nanos: null,
    observed_currency: null,
    estimated_currency: null,
    accuracy_mode: "exact",
    pricing_mode: "unpriced",
    unpriced_reason: "missing_pricing_rule",
    pricing_rule_ids_json: null,
    pricing_source_snapshot_ids_json: null,
    cost_calculated_at: null,
    assignment_status: "unassigned",
    payload_json: {},
    created_at: "2026-04-28T00:00:00.000Z",
    ...over,
  };
}

describe("HttpLedgerClient — run + usage methods", () => {
  it("runActions GETs /api/runs/:runId/actions", async () => {
    const client = buildClient({
      runActions: async () => [{ run_id: "run_x", task_key: "alpha", task_name: "A", action_kind: "started", at: "2026-04-28T00:00:00Z" } as RunAction],
    });
    const actions = await client.runActions({ workspace: { key: "test" }, runId: "run_x" });
    expect(actions).toHaveLength(1);
  });

  it("runMeta GETs /api/runs/:runId/meta", async () => {
    const client = buildClient({
      runMeta: async () => ({ run_id: "run_x", task_key: "alpha", task_name: "Alpha" }),
    });
    const meta = await client.runMeta({ workspace: { key: "test" }, runId: "run_x" });
    expect(meta?.run_id).toBe("run_x");
  });

  it("recordUsage POSTs to /api/usage/events", async () => {
    const seen: AiUsageObserved[] = [];
    const client = buildClient({
      recordUsage: async (msg) => {
        seen.push(msg);
        return usageEventRecord({ id: "usage_new" });
      },
    });
    const event = await client.recordUsage({
      message_id: "m1",
      occurred_at: "2026-04-28T00:00:00Z",
      source: "test",
      provider: "openai",
      model: "gpt",
      usage_kind: "conversation_turn",
      tokens: { input: 1, output: 1 },
      workspace: { key: "test" },
    } as AiUsageObserved);
    expect(event.id).toBe("usage_new");
    expect(seen).toHaveLength(1);
  });

  it("listUnpricedUsage GETs /api/usage/unpriced", async () => {
    const client = buildClient({
      listUnpricedUsage: async () => [usageEventRecord({ id: "u1" }), usageEventRecord({ id: "u2" })],
    });
    const events = await client.listUnpricedUsage({ workspace: { key: "test" } });
    expect(events.map((e) => e.id)).toEqual(["u1", "u2"]);
  });

  it("moveUsage POSTs to /api/usage/events/:usageId/move", async () => {
    const seen: Array<{ usageEventId: string; taskKey: string }> = [];
    const client = buildClient({
      moveUsage: async (input) => {
        seen.push({ usageEventId: input.usageEventId, taskKey: input.taskKey });
        return usageEventRecord({ id: input.usageEventId, task_id: "task_target", assignment_status: "assigned" });
      },
    });
    const moved = await client.moveUsage({ workspace: { key: "test" }, usageEventId: "u1", taskKey: "target" });
    expect(moved.assignment_status).toBe("assigned");
    expect(seen).toEqual([{ usageEventId: "u1", taskKey: "target" }]);
  });

  it("getLastImportedAt GETs /api/usage/last-import", async () => {
    const client = buildClient({
      getLastImportedAt: async () => "2026-05-07T00:00:00Z",
    });
    const at = await client.getLastImportedAt({ workspace: { key: "test" }, source: "claude-session" });
    expect(at).toBe("2026-05-07T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run tests, verify failures**

```bash
pnpm --filter @ttoksem/ledger-http test
```

- [ ] **Step 3: Implement the 6 methods**

Append to `client.ts`:

```ts
import type { AiUsageObserved, UsageEventRecord, RunAction } from "@ttoksem/schema";
```

In the class body:

```ts
  // Runs
  async runActions(input: { workspace: WorkspaceResolver; runId: string }): Promise<RunAction[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/runs/${encodeURIComponent(input.runId)}/actions?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { actions: RunAction[] }).actions;
  }

  async runMeta(input: { workspace: WorkspaceResolver; runId: string }): Promise<{ run_id: string; task_key: string; task_name: string } | null> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/runs/${encodeURIComponent(input.runId)}/meta?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { meta: { run_id: string; task_key: string; task_name: string } | null }).meta;
  }

  // Usage
  async recordUsage(message: AiUsageObserved): Promise<UsageEventRecord> {
    const result = await this.request("POST", "/api/usage/events", message);
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async listUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/usage/unpriced?${params.toString()}`);
    return (result as { events: UsageEventRecord[] }).events;
  }

  async moveUsage(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/usage/events/${encodeURIComponent(input.usageEventId)}/move?workspace=${encodeURIComponent(wk)}`,
      { task_key: input.taskKey },
    );
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async getLastImportedAt(input: {
    workspace: WorkspaceResolver;
    source: string;
  }): Promise<string | null> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk, source: input.source });
    const result = await this.request("GET", `/api/usage/last-import?${params.toString()}`);
    return (result as { last_imported_at: string | null }).last_imported_at;
  }
```

> **Cross-check** the actual response envelope shapes by reading `packages/http/src/index.ts`. The plan reflects the conventions used in Plan 1/2/3 (e.g., `{ tasks }`, `{ task }`, `{ events }`, `{ usage_event }`). If a route returns a different shape (e.g., a bare value), adjust the unwrap accordingly.

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm --filter @ttoksem/ledger-http test
```

- [ ] **Step 5: Commit**

```bash
git add packages/ledger-http/src/client.ts packages/ledger-http/src/client.test.ts
git commit -m "feat(ledger-http): run + usage methods (14 of ~28)

runActions, runMeta, recordUsage, listUnpricedUsage, moveUsage,
getLastImportedAt.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 4 — Inbox methods

Add 6 methods (`listInbox`, `listInboxGroups`, `showInboxGroup`, `assignInboxEvent`, `assignInboxGroup`, `acceptInboxGroup`).

**Files:**
- Modify: `packages/ledger-http/src/client.ts`
- Modify: `packages/ledger-http/src/client.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import type { InboxGroup, InboxAssignmentResult } from "@ttoksem/core";

function inboxGroup(over: Partial<InboxGroup> = {}): InboxGroup {
  return {
    group_id: "grp_test",
    assignment_status: "unassigned",
    event_count: 1,
    run_count: 0,
    token_count: 1,
    estimated_total: 0,
    currency: null,
    first_occurred_at: "2026-04-28T00:00:00Z",
    last_occurred_at: "2026-04-28T00:00:00Z",
    source_context: {
      date_bucket: "2026-04-28",
      tool: null,
      cwd: null,
      git_branch: null,
      command: null,
      conversation_id: null,
      request_id: null,
      external_ref: null,
    },
    reason_codes: ["same_day"],
    sample_event_ids: ["usage_test"],
    prompt_samples: [],
    suggested_task: null,
    ...over,
  };
}

const stubAssignmentResult: InboxAssignmentResult = {
  group: inboxGroup(),
  task: { key: "alpha", name: "Alpha" },
  assigned_count: 1,
  skipped_count: 0,
  assigned_event_ids: ["usage_test"],
  skipped_event_ids: [],
};

describe("HttpLedgerClient — inbox methods", () => {
  it("listInbox GETs /api/inbox", async () => {
    const client = buildClient({
      listInbox: async () => [usageEventRecord({ id: "u1" })],
    });
    const events = await client.listInbox({ workspace: { key: "test" } });
    expect(events).toHaveLength(1);
  });

  it("listInboxGroups GETs /api/inbox/groups", async () => {
    const client = buildClient({
      listInboxGroups: async () => [inboxGroup({ group_id: "g1" })],
    });
    const groups = await client.listInboxGroups({ workspace: { key: "test" } });
    expect(groups[0].group_id).toBe("g1");
  });

  it("showInboxGroup GETs /api/inbox/groups/:groupId", async () => {
    const client = buildClient({
      showInboxGroup: async ({ groupId }) => ({
        group: inboxGroup({ group_id: groupId }),
        events: [usageEventRecord({ id: "u1" })],
      }),
    });
    const result = await client.showInboxGroup({ workspace: { key: "test" }, groupId: "g_test" });
    expect(result.group.group_id).toBe("g_test");
  });

  it("assignInboxEvent POSTs to /api/inbox/events/:usageId/assign", async () => {
    const client = buildClient({
      assignInboxEvent: async (input) => usageEventRecord({ id: input.usageEventId, task_id: "task_target", assignment_status: "assigned" }),
    });
    const result = await client.assignInboxEvent({ workspace: { key: "test" }, usageEventId: "u1", taskKey: "alpha" });
    expect(result.assignment_status).toBe("assigned");
  });

  it("assignInboxGroup POSTs to /api/inbox/:groupId/assign", async () => {
    const client = buildClient({
      assignInboxGroup: async () => stubAssignmentResult,
    });
    const result = await client.assignInboxGroup({ workspace: { key: "test" }, groupId: "g_test", taskKey: "alpha" });
    expect(result.assigned_count).toBe(1);
  });

  it("acceptInboxGroup POSTs to /api/inbox/:groupId/accept", async () => {
    const client = buildClient({
      acceptInboxGroup: async () => stubAssignmentResult,
    });
    const result = await client.acceptInboxGroup({ workspace: { key: "test" }, groupId: "g_test" });
    expect(result.assigned_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, verify failures**

```bash
pnpm --filter @ttoksem/ledger-http test
```

- [ ] **Step 3: Implement the 6 inbox methods**

Append imports to `client.ts`:

```ts
import type { InboxGroup, InboxAssignmentResult } from "@ttoksem/core";
```

In the class body:

```ts
  // Inbox
  async listInbox(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/inbox?${params.toString()}`);
    return (result as { events: UsageEventRecord[] }).events;
  }

  async listInboxGroups(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<InboxGroup[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/inbox/groups?${params.toString()}`);
    return (result as { groups: InboxGroup[] }).groups;
  }

  async showInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    limit?: number;
  }): Promise<{ group: InboxGroup; events: UsageEventRecord[] }> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request(
      "GET",
      `/api/inbox/groups/${encodeURIComponent(input.groupId)}?${params.toString()}`,
    );
    return result as { group: InboxGroup; events: UsageEventRecord[] };
  }

  async assignInboxEvent(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/events/${encodeURIComponent(input.usageEventId)}/assign?workspace=${encodeURIComponent(wk)}`,
      { task_key: input.taskKey },
    );
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async assignInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    taskKey: string;
    all?: boolean;
    createIfMissing?: boolean;
  }): Promise<InboxAssignmentResult> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/${encodeURIComponent(input.groupId)}/assign?workspace=${encodeURIComponent(wk)}`,
      {
        task_key: input.taskKey,
        all: input.all,
        create_if_missing: input.createIfMissing,
      },
    );
    return result as InboxAssignmentResult;
  }

  async acceptInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    all?: boolean;
  }): Promise<InboxAssignmentResult> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/${encodeURIComponent(input.groupId)}/accept?workspace=${encodeURIComponent(wk)}`,
      { all: input.all },
    );
    return result as InboxAssignmentResult;
  }
```

> **Cross-check** the response envelope: routes for assign/accept currently return the `InboxAssignmentResult` directly (no `{ result }` wrapper) — confirmed by Plan 1's tests. If you find a wrapper, adjust the unwrap.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ledger-http/src/client.ts packages/ledger-http/src/client.test.ts
git commit -m "feat(ledger-http): inbox methods (20 of ~28)

listInbox, listInboxGroups, showInboxGroup, assignInboxEvent,
assignInboxGroup, acceptInboxGroup.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 5 — Pricing reads + reports + auth (final batch)

Add 8 methods (`listPricingSourceSnapshots`, `getPricingSourceSnapshot`, `listPricingRules`, `dashboard`, `dashboardTask`, `reportToday`, `reportTask`, `verifyAccessKey`). After this, the type-level conformance test passes and the `_httpLedgerClientImplementsLedger` shim can be replaced with `class HttpLedgerClient implements Ledger`.

**Files:**
- Modify: `packages/ledger-http/src/client.ts`
- Modify: `packages/ledger-http/src/client.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import type {
  DailyReport,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
} from "@ttoksem/schema";
import type { DashboardData, DashboardTaskDetailData, AccessKeyVerificationResult } from "@ttoksem/core";

function pricingSnapshotRecord(over: Partial<PricingSourceSnapshotRecord> = {}): PricingSourceSnapshotRecord {
  return {
    id: "price_snapshot_test",
    source_name: "litellm",
    source_url: null,
    source_version: null,
    source_commit: null,
    source_retrieved_at: null,
    bundled_at: null,
    valid_from: null,
    raw_sha256: "0".repeat(64),
    raw_storage_ref: null,
    metadata_json: null,
    created_at: "2026-04-28T00:00:00.000Z",
    ...over,
  };
}

function dailyReport(over: Partial<DailyReport> = {}): DailyReport {
  return {
    workspace: workspaceRecord({}),
    date: "2026-05-07",
    estimated_total: 0,
    observed_total: 0,
    currency: null,
    event_count: 0,
    unpriced_count: 0,
    ...over,
  };
}

function dashboardData(): DashboardData {
  return {
    workspace: { key: "test", name: "Test" },
    summary: {
      event_count: 0, estimated_total: 0, observed_total: 0,
      currency: "USD", unpriced_count: 0, unassigned_count: 0,
      assigned_count: 0, task_count: 0, run_count: 0,
    },
    attention: [], insights: [], task_insights: [], tasks: [],
    recent: [], pricing_breakdown: [], accuracy_breakdown: [], daily: [],
  } as DashboardData;
}

describe("HttpLedgerClient — pricing reads, reports, auth", () => {
  it("listPricingSourceSnapshots GETs /api/pricing/snapshots", async () => {
    const client = buildClient({
      listPricingSourceSnapshots: async () => [pricingSnapshotRecord({ id: "price_snapshot_a" })],
    });
    const snapshots = await client.listPricingSourceSnapshots();
    expect(snapshots[0].id).toBe("price_snapshot_a");
  });

  it("getPricingSourceSnapshot GETs /api/pricing/snapshots/:id, throws on 404", async () => {
    const client = buildClient({
      getPricingSourceSnapshot: async (id) => (id === "price_snapshot_a" ? pricingSnapshotRecord({ id: "price_snapshot_a" }) : null),
    });
    const ok = await client.getPricingSourceSnapshot("price_snapshot_a");
    expect(ok?.id).toBe("price_snapshot_a");
    await expect(client.getPricingSourceSnapshot("price_snapshot_missing")).rejects.toBeInstanceOf(HttpLedgerError);
  });

  it("listPricingRules GETs /api/pricing/rules", async () => {
    const client = buildClient({
      listPricingRules: async () => [{ id: "price_a", workspace_id: "ws_test", source_snapshot_id: null, provider: "openai", model: "gpt", usage_kind: "conversation_turn", unit_type: "token", price_nanos_per_unit: 100, currency: "USD", effective_from: "2026-04-28T00:00:00Z", effective_to: null, source: "manual", attribution_json: null, metadata_json: null, created_at: "2026-04-28T00:00:00Z", updated_at: "2026-04-28T00:00:00Z" } as PricingRuleRecord],
    });
    const rules = await client.listPricingRules({ workspace: { key: "test" } });
    expect(rules[0].id).toBe("price_a");
  });

  it("dashboard GETs /api/dashboard", async () => {
    const client = buildClient({ dashboard: async () => dashboardData() });
    const dash = await client.dashboard({ workspace: { key: "test" } });
    expect(dash.workspace.key).toBe("test");
  });

  it("dashboardTask GETs /api/tasks/:taskKey (the dashboard-task route)", async () => {
    const client = buildClient({
      dashboardTask: async () => ({
        workspace: { key: "test", name: "Test" },
        task: { key: "alpha", name: "Alpha", description: null, status: "active", created_at: "2026-04-27T00:00:00.000Z", started_at: null, closed_at: null },
        insight: { task_key: "alpha", task_name: "Alpha", status: "clear", event_count: 0, token_count: 0, estimated_total: 0, unpriced_count: 0, run_count: 0, first_activity_at: null, last_activity_at: null, latest_prompt: null, signals: [], insight: "No usage." },
        recent: [], daily: [], runs: [], provider_breakdown: [], pricing_breakdown: [], accuracy_breakdown: [],
      } as DashboardTaskDetailData),
    });
    const detail = await client.dashboardTask({ workspace: { key: "test" }, taskKey: "alpha" });
    expect(detail.task.key).toBe("alpha");
  });

  it("reportToday GETs /api/reports/today", async () => {
    const client = buildClient({ reportToday: async () => dailyReport({ date: "2026-05-07" }) });
    const report = await client.reportToday({ workspace: { key: "test" } });
    expect(report.date).toBe("2026-05-07");
  });

  it("reportTask GETs /api/reports/tasks/:taskKey", async () => {
    const client = buildClient({ reportTask: async () => dailyReport({ date: "2026-05-07" }) });
    const report = await client.reportTask({ workspace: { key: "test" }, taskKey: "alpha" });
    expect(report.date).toBe("2026-05-07");
  });

  it("verifyAccessKey is exposed as a method", async () => {
    // verifyAccessKey is server-internal — there is no public route. The
    // client method exists for type conformance; calling it should throw a
    // clear error rather than fabricating a response.
    const client = buildClient({});
    await expect(
      client.verifyAccessKey({ workspaceKey: "test", tokenHash: "h", requiredScopes: ["api:read"] }),
    ).rejects.toBeInstanceOf(HttpLedgerError);
  });
});
```

- [ ] **Step 2: Run tests, verify failures**

- [ ] **Step 3: Implement the 8 methods + drop the type shim**

Add imports to `client.ts`:

```ts
import type { DailyReport, PricingRuleRecord, PricingSourceSnapshotRecord } from "@ttoksem/schema";
import type { AccessKeyVerificationResult, DashboardData, DashboardTaskDetailData } from "@ttoksem/core";
```

Replace the `_httpLedgerClientImplementsLedger` shim line at the bottom of the file:

```ts
// (delete the shim line)
```

Change the class declaration to:

```ts
export class HttpLedgerClient implements Ledger {
```

Add `import type { Ledger } from "@ttoksem/core";` at the top if it isn't already there.

Append the methods to the class body:

```ts
  // Pricing reads
  async listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]> {
    const result = await this.request("GET", "/api/pricing/snapshots");
    return (result as { snapshots: PricingSourceSnapshotRecord[] }).snapshots;
  }

  async getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null> {
    try {
      const result = await this.request("GET", `/api/pricing/snapshots/${encodeURIComponent(id)}`);
      return (result as { snapshot: PricingSourceSnapshotRecord }).snapshot;
    } catch (error) {
      if (error instanceof HttpLedgerError && error.status === 404) return null;
      throw error;
    }
  }

  async listPricingRules(input: { workspace: WorkspaceResolver }): Promise<PricingRuleRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request("GET", `/api/pricing/rules?workspace=${encodeURIComponent(wk)}`);
    return (result as { rules: PricingRuleRecord[] }).rules;
  }

  // Dashboard / Reports
  async dashboard(input: {
    workspace: WorkspaceResolver;
    taskLimit?: number;
    recentLimit?: number;
    dayLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardData> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.taskLimit !== undefined) params.set("taskLimit", String(input.taskLimit));
    if (input.recentLimit !== undefined) params.set("recentLimit", String(input.recentLimit));
    if (input.dayLimit !== undefined) params.set("dayLimit", String(input.dayLimit));
    if (input.timeZoneOffsetMinutes !== undefined) params.set("timeZoneOffsetMinutes", String(input.timeZoneOffsetMinutes));
    const result = await this.request("GET", `/api/dashboard?${params.toString()}`);
    return result as DashboardData;
  }

  async dashboardTask(input: {
    workspace: WorkspaceResolver;
    taskKey: string;
    recentLimit?: number;
    dayLimit?: number;
    runLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardTaskDetailData> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.recentLimit !== undefined) params.set("recentLimit", String(input.recentLimit));
    if (input.dayLimit !== undefined) params.set("dayLimit", String(input.dayLimit));
    if (input.runLimit !== undefined) params.set("runLimit", String(input.runLimit));
    if (input.timeZoneOffsetMinutes !== undefined) params.set("timeZoneOffsetMinutes", String(input.timeZoneOffsetMinutes));
    const result = await this.request(
      "GET",
      `/api/tasks/${encodeURIComponent(input.taskKey)}?${params.toString()}`,
    );
    return result as DashboardTaskDetailData;
  }

  async reportToday(input: { workspace: WorkspaceResolver; date?: string }): Promise<DailyReport> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.date !== undefined) params.set("date", input.date);
    const result = await this.request("GET", `/api/reports/today?${params.toString()}`);
    return (result as { report: DailyReport }).report;
  }

  async reportTask(input: { workspace: WorkspaceResolver; taskKey: string }): Promise<DailyReport> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/reports/tasks/${encodeURIComponent(input.taskKey)}?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { report: DailyReport }).report;
  }

  // Auth (server-internal — no public route)
  async verifyAccessKey(_input: {
    workspaceKey: string;
    tokenHash: string;
    requiredScopes: string[];
  }): Promise<AccessKeyVerificationResult> {
    throw new HttpLedgerError(
      "verifyAccessKey has no public HTTP route; the server uses it internally during request authorization. " +
      "If you need to verify a token from outside the server, make an authenticated request to any protected endpoint and observe the 200/401/403 response.",
      0,
    );
  }
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
pnpm --filter @ttoksem/ledger-http test
pnpm --filter @ttoksem/ledger-http build
```

Expected: all behavioral tests + the type-level conformance test pass. Build clean.

- [ ] **Step 5: Run workspace-wide build to confirm no leakage**

```bash
pnpm build
```

Expected: 11 projects build clean (the 10 existing + the new ledger-http).

- [ ] **Step 6: Commit**

```bash
git add packages/ledger-http/src/client.ts packages/ledger-http/src/client.test.ts
git commit -m "feat(ledger-http): pricing reads + reports + auth (28 of 28)

listPricingSourceSnapshots, getPricingSourceSnapshot, listPricingRules,
dashboard, dashboardTask, reportToday, reportTask, verifyAccessKey.

verifyAccessKey throws by design — it is server-internal and has no
public route; the method exists for type conformance with Ledger.

Replaces the type-shim with \`class HttpLedgerClient implements Ledger\`.
The compile-time conformance test now passes.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 6 — CLI `makeLedger()` factory

Introduce a factory that returns either a local `LedgerService` (existing behavior) or a remote `HttpLedgerClient` based on `TTOKSEM_HTTP_URL`.

**Files:**
- Create: `packages/cli/src/ledger-factory.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tsconfig.json`

- [ ] **Step 1: Add the workspace dep + project ref**

In `packages/cli/package.json`, add to `dependencies`:

```json
"@ttoksem/ledger-http": "workspace:*"
```

In `packages/cli/tsconfig.json`, add to `references`:

```json
{ "path": "../ledger-http" }
```

- [ ] **Step 2: Create `packages/cli/src/ledger-factory.ts`**

```ts
import type { Ledger, LocalLedger } from "@ttoksem/core";
import { HttpLedgerClient } from "@ttoksem/ledger-http";

export interface LedgerHandle {
  ledger: Ledger;
  /** True iff the ledger is a LocalLedger (file-system + admin capable). */
  isLocal: boolean;
  close: () => Promise<void>;
}

/**
 * Build a Ledger from environment configuration.
 * - TTOKSEM_HTTP_URL set → HttpLedgerClient (remote mode; Ledger only).
 * - Unset → local LedgerService (LocalLedger; admin + file-system ops available).
 */
export async function makeLedger(opts: {
  /** Local-mode factory: builds a LedgerService. Imported here to avoid a circular import. */
  makeLocalService: () => Promise<{ service: LocalLedger; close: () => Promise<void> }>;
  defaultWorkspaceKey?: string;
}): Promise<LedgerHandle> {
  const httpUrl = process.env.TTOKSEM_HTTP_URL;
  if (httpUrl) {
    const client = new HttpLedgerClient({
      baseUrl: httpUrl,
      token: process.env.TTOKSEM_HTTP_TOKEN,
      defaultWorkspaceKey: opts.defaultWorkspaceKey,
    });
    return { ledger: client, isLocal: false, close: async () => {} };
  }
  const { service, close } = await opts.makeLocalService();
  return { ledger: service, isLocal: true, close };
}

/**
 * Narrow a Ledger to LocalLedger or throw a clear error. Use this in CLI
 * subcommands that need admin (access keys, pricing upserts) or local
 * (filesystem-bound) capabilities.
 */
export function requireLocalLedger(handle: LedgerHandle): LocalLedger {
  if (!handle.isLocal) {
    throw new Error(
      "This subcommand requires a local DB and is not available in remote mode. " +
      "Unset TTOKSEM_HTTP_URL or run the command on the server host.",
    );
  }
  return handle.ledger as LocalLedger;
}
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan4-http-ledger-client
pnpm install
pnpm --filter @ttoksem/cli build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/ledger-factory.ts
git commit -m "feat(cli): add makeLedger() / requireLocalLedger() factory

Builds Ledger from environment config: TTOKSEM_HTTP_URL set → remote
HttpLedgerClient; unset → local LedgerService. Subcommands that need
admin or filesystem capabilities call requireLocalLedger() to narrow
the type and throw a clear error in remote mode.

No subcommands rewired yet — Tasks 7 + 8 do that.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 7 — Convert `Ledger`-only subcommands to `makeLedger`

Subcommands whose required surface is fully covered by `Ledger` (the remote-safe tier) switch to the factory and gain remote-mode support automatically.

**Files:**
- Modify: `packages/cli/src/index.ts`

### Subcommands in scope (Ledger-only)

| Subcommand | Method(s) used |
|---|---|
| `task start` | `startTask` |
| `task archive` | `archiveTask` |
| `task close` | `closeTask` |
| `task list` | `listTasks` |
| `task active` | `listTasks` (filter client-side) |
| `task stats` | `getTaskStats` |
| `task update` | `updateTask` |
| `usage record` | `recordUsage` |
| `usage list-unpriced` | `listUnpricedUsage` |
| `usage move` | `moveUsage` |
| `inbox list` | `listInbox` / `listInboxGroups` (whichever the current command uses) |
| `inbox accept` | `acceptInboxGroup` |
| `inbox assign` | `assignInboxGroup` / `assignInboxEvent` |
| `inbox how` | `showInboxGroup` |
| `dashboard` | `dashboard` |
| `report today` | `reportToday` |
| `report task` | `reportTask` |

> Read the actual subcommand list from `packages/cli/src/index.ts` first; the table above mirrors what's there at HEAD. If a subcommand is missing or differs, follow what's in the file.

- [ ] **Step 1: Read the current CLI structure**

```bash
sed -n '1,100p' packages/cli/src/index.ts | head -80
```

Identify the existing local-mode helper (likely `makeService()`). The factory in Task 6 takes `makeLocalService` as an opt; pass the existing helper.

- [ ] **Step 2: Convert each Ledger-only subcommand**

For each subcommand in the table above, replace:

```ts
.action(async (key, options) => {
  const { service, close } = await makeService();
  await service.init();
  // ...service.startTask(...) etc.
  await close();
});
```

with:

```ts
.action(async (key, options) => {
  const handle = await makeLedger({ makeLocalService: makeService, defaultWorkspaceKey: undefined });
  try {
    // ...handle.ledger.startTask(...) etc.
  } finally {
    await handle.close();
  }
});
```

> Note: `makeLocalService` should return `{ service: LocalLedger; close }`. If the existing `makeService` returns `{ service: LedgerService; ... }`, that's fine — `LedgerService implements LocalLedger`. You may need a small adapter shim if the return shape differs (e.g., `dbPath` field). Adapter:
>
> ```ts
> async function makeLocalService(): Promise<{ service: LocalLedger; close: () => Promise<void> }> {
>   const { service, close } = await makeService();
>   await service.init();
>   return { service, close };
> }
> ```

For subcommands that previously called `service.init()` directly, that responsibility moves to the local-mode adapter (`makeLocalService` calls `await service.init()` once on local-mode entry). HttpLedgerClient does not need init.

- [ ] **Step 3: Build + run existing CLI tests to confirm no regressions in local mode**

```bash
pnpm --filter @ttoksem/cli build
pnpm --filter @ttoksem/cli test
```

Expected: green. The existing 6 CLI tests don't set `TTOKSEM_HTTP_URL`, so they exercise the local path.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "refactor(cli): wire Ledger-only subcommands through makeLedger

Subcommands that only need the Ledger surface — task start/archive/close/
list/active/stats/update, usage record/list-unpriced/move, inbox list/
accept/assign/how, dashboard, report today/task — now go through
makeLedger() and gain remote-mode support automatically. Local mode
behavior unchanged (existing CLI tests pass).

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 8 — Convert admin / local-only subcommands with `requireLocalLedger`

Subcommands that need admin or filesystem capabilities go through `makeLedger()` for symmetry but immediately call `requireLocalLedger(handle)` to narrow + reject remote mode.

**Files:**
- Modify: `packages/cli/src/index.ts`

### Subcommands in scope (admin / local-only)

| Subcommand | Why local |
|---|---|
| `workspace init` | Creates `.ttoksem/ttoksem.db` on disk |
| `workspace current` | Resolves a filesystem path to a workspace |
| `auth key create` / `list` / `revoke` | AdminLedger |
| `pricing rule upsert`, `pricing snapshot upsert` | AdminLedger |
| `usage reprice`, `usage migrate-pricing` | AdminLedger |
| `usage import-claude-sessions` / `import-codex-sessions` | Reads local JSONL files; orchestrates many `recordUsage` calls — keep local for now |
| `usage claude-turn` / `codex-turn` | Same — local file reads |

- [ ] **Step 1: For each admin/local subcommand, wrap with `requireLocalLedger`**

Pattern:

```ts
.action(async (...) => {
  const handle = await makeLedger({ makeLocalService });
  try {
    const service = requireLocalLedger(handle);   // throws "requires local DB" in remote mode
    await service.init();                          // already done by makeLocalService, but no-op safety
    // ...service.createAccessKey(...) or service.upsertPricingRule(...) etc.
  } finally {
    await handle.close();
  }
});
```

The `requireLocalLedger(handle)` call replaces the previous direct `service` access. In remote mode the throw happens before any HTTP call, so users see a clean error with no spurious 401/404s.

- [ ] **Step 2: Build + tests**

```bash
pnpm --filter @ttoksem/cli build
pnpm --filter @ttoksem/cli test
```

Expected: green; all existing 6 tests still pass (they don't set TTOKSEM_HTTP_URL).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "refactor(cli): guard admin + local subcommands with requireLocalLedger

Subcommands that need AdminLedger (key management, pricing upserts,
reprice/migrate) or LocalLedger (workspace init/current, JSONL imports)
now go through makeLedger() then narrow via requireLocalLedger(). In
remote mode they emit a clear 'requires local DB' error before any
HTTP request — no spurious 401/404 from the server.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 9 — End-to-end CLI integration test

Spin up an in-process Hono server backed by a real `LedgerService` + tmp SQLite, point `TTOKSEM_HTTP_URL` at it via a custom fetch adapter, run a CLI subcommand, and verify the round trip.

**Files:**
- Modify: `packages/cli/src/index.test.ts` (append new test)

- [ ] **Step 1: Append the e2e test**

```ts
it("uses HttpLedgerClient when TTOKSEM_HTTP_URL is set (e2e)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  // Boot a local SqliteLedgerStore + LedgerService backing the test server.
  const store = new SqliteLedgerStore({ databaseUrl: dbPath });
  await store.init();

  // (paths simplified; adapt to actual constructors and helpers in the file)
  const { LedgerService } = await import("@ttoksem/core");
  const service = new LedgerService({ store });
  await service.init();
  const workspace = await service.createWorkspace({ key: "e2e", name: "E2E", rootPath: tempDir });

  const { createHttpApp } = await import("@ttoksem/http");
  const app = createHttpApp({
    service,
    defaultWorkspaceKey: "e2e",
    auth: { mode: "access-key", verifyAccessToken: async ({ token }) => token === "valid" },
  });

  // Inject app.fetch into the CLI process via a tiny shim that NodeJS understands:
  // we set a dedicated env var that the CLI reads only in tests, then run the CLI
  // in this same process (not via spawnSync). This bypasses real network.
  // (If the existing CLI test pattern is sub-process via spawnSync, add a small
  // patch: a TTOKSEM_HTTP_FETCH env var that, when set to "stdio:test-app",
  // makes makeLedger swap in a fetch impl — but that adds production code only
  // for tests. Cleaner: invoke the CLI's command handlers directly via export.
  // Implementer should pick whichever fits the existing test architecture.)

  const env = {
    ...process.env,
    TTOKSEM_HTTP_URL: "http://test.invalid",
    TTOKSEM_HTTP_TOKEN: "valid",
    TTOKSEM_DB: dbPath,
    INIT_CWD: tempDir,
  };

  // Minimum assertion: HttpLedgerClient round-trips. Proves the wiring.
  const { HttpLedgerClient } = await import("@ttoksem/ledger-http");
  const client = new HttpLedgerClient({
    baseUrl: "http://test.invalid",
    token: "valid",
    defaultWorkspaceKey: "e2e",
    fetch: app.fetch as typeof fetch,
  });
  const tasks = await client.listTasks({ workspace: { key: "e2e" } });
  expect(tasks).toEqual([]);

  await store.close();
  rmSync(tempDir, { recursive: true, force: true });
});
```

> The test as written exercises HttpLedgerClient directly with a real backing service. Doing a true CLI subprocess test with TTOKSEM_HTTP_URL pointed at an in-process server requires either a real listening port (slow/flaky) or a custom transport hook. Both are heavier than the value they add. The test above proves the seam (HttpLedgerClient + real service round trip) — Task 7's local-mode CLI tests already cover the CLI invocation path.
>
> If the implementer concludes a true subprocess e2e is needed, they should: (a) bind a real port via `node:net` `listen(0)`, (b) run the CLI via `spawnSync('tsx', [cliPath, 'task', 'list', '--workspace', 'e2e'], { env: { ...env, TTOKSEM_HTTP_URL: \`http://127.0.0.1:\${port}\` } })`, (c) assert stdout contains the expected task list. This is documented but not required.

- [ ] **Step 2: Run the new test**

```bash
pnpm --filter @ttoksem/cli test
```

Expected: green; new e2e test passes alongside existing 6.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.test.ts
git commit -m "test(cli): add e2e test for HttpLedgerClient wiring

Verifies that HttpLedgerClient round-trips against a real
LedgerService + tmp SQLite via in-process Hono app.fetch. Subprocess-
level CLI exercise via TTOKSEM_HTTP_URL is documented as optional;
the existing local-mode CLI tests cover the subprocess path.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 10 — Documentation

Create `docs/REMOTE-MODE.md` and link from MIGRATION.md.

**Files:**
- Create: `docs/REMOTE-MODE.md`
- Modify: `MIGRATION.md`

- [ ] **Step 1: Create `docs/REMOTE-MODE.md`**

```markdown
# Remote mode (Plan 4)

ttoksem CLI can talk to a running ttoksem server instead of a local
SQLite DB. Use this for multi-machine setups, multi-agent
configurations, or when several Claude Code sessions on the same host
need to share one ledger.

## Enable

```bash
export TTOKSEM_HTTP_URL=https://ledger.example.com
export TTOKSEM_HTTP_TOKEN=ttoksem_live_…   # bearer token; required when the server enforces auth
```

The CLI auto-detects `TTOKSEM_HTTP_URL`. Unset both vars to revert to
local mode.

## What works

Every Ledger-tier subcommand:

- `task start` / `archive` / `close` / `list` / `stats` / `update` / `active`
- `usage record` / `list-unpriced` / `move`
- `inbox list` / `accept` / `assign` / `how`
- `dashboard`
- `report today` / `report task`

## What doesn't (and why)

The following subcommands need admin or filesystem capabilities and
hard-error in remote mode with the message:

> This subcommand requires a local DB and is not available in remote
> mode. Unset TTOKSEM_HTTP_URL or run the command on the server host.

- `workspace init`, `workspace current` — operate on a local
  filesystem path.
- `auth key create` / `list` / `revoke` — admin tier; managed
  server-side, e.g. via the server host's CLI.
- `pricing rule upsert`, `pricing snapshot upsert`,
  `usage reprice`, `usage migrate-pricing` — admin tier.
- `usage import-claude-sessions` / `import-codex-sessions` /
  `claude-turn` / `codex-turn` — read local JSONL files; running them
  remotely would have no source data.

## Token

If the server runs `auth: { mode: "access-key" }`, you need a bearer
token with the right scopes. Most read subcommands require
`dashboard:read`; mutating subcommands require `api:write`. Generate
tokens on the server host with `pnpm cli auth key create`.

If the server runs `auth: { mode: "none" }` (e.g., a private intranet
server), `TTOKSEM_HTTP_TOKEN` may be omitted.

## Errors

The client throws `HttpLedgerError` on non-2xx responses. The error
carries `status` and the parsed response body when available:

- `0` — network error or invalid response (server down, DNS failure,
  non-JSON body)
- `401` — missing or invalid token
- `403` — token lacks required scopes
- `404` — resource not found (some methods, like
  `getPricingSourceSnapshot`, translate 404 to `null` instead of
  throwing)
- `410` — endpoint removed (e.g., `task active` after Sunset)
- `5xx` — server error
```

- [ ] **Step 2: Append a section to `MIGRATION.md`**

```markdown
## Remote mode (Plan 4)

`HttpLedgerClient` ships in `@ttoksem/ledger-http` and the CLI
auto-detects `TTOKSEM_HTTP_URL`. See [docs/REMOTE-MODE.md](docs/REMOTE-MODE.md)
for the env vars, supported subcommands, and the admin/local
restrictions in remote mode.

No DB migration; no breaking changes. Local mode (no env var) is
unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add docs/REMOTE-MODE.md MIGRATION.md
git commit -m "docs: REMOTE-MODE.md + MIGRATION.md note for Plan 4

User-facing guide for running the CLI against a remote ttoksem
server: env vars, supported subcommands, admin/local restrictions,
HttpLedgerError mapping.

Refs: docs/specs/2026-05-07-plan4-http-ledger-client-design.md"
```

---

## Task 11 — Final test sweep

After all the above, confirm the workspace stays green and produce a clean summary.

- [ ] **Step 1: Run everything**

```bash
cd /Users/johwanghee/Documents/hwanghee/ttoksem-plan4-http-ledger-client
pnpm test
pnpm build
```

- [ ] **Step 2: Inspect any remaining failures**

Most likely sources:
- Wrong response envelope shape on a method (e.g., assumed `{ tasks }` but route returns bare array). Fix the unwrap in `client.ts`.
- A Ledger method signature drift the type test caught. Align HttpLedgerClient to the canonical Ledger signature.
- CLI tests breaking because a subcommand still calls `service.X` directly post-refactor. Wrap with `makeLedger` + `requireLocalLedger` as needed.

Fix and commit per-package as needed.

- [ ] **Step 3: No commit if everything is already green**

If `pnpm test` and `pnpm build` are both green at the start of Step 1, this task is a no-op.

---

## Self-Review Checklist (run before declaring Plan 4 done)

- [ ] All 10 tasks above are committed (Task 11 may produce zero commits).
- [ ] `pnpm build` is clean across the workspace (11 projects).
- [ ] `pnpm test` is green across the workspace.
- [ ] `packages/ledger-http/` exports `HttpLedgerClient`, `HttpLedgerError`, and their option/body types.
- [ ] `class HttpLedgerClient implements Ledger` compiles without `// @ts-expect-error` or `as unknown as Ledger`.
- [ ] All 28 `Ledger` methods on the class call the correct route and return the unwrapped JSON.
- [ ] Behavioral tests cover every method (one happy-path round trip each).
- [ ] `verifyAccessKey` throws `HttpLedgerError` with a clear message (no public route).
- [ ] CLI `makeLedger()` switches on `TTOKSEM_HTTP_URL`; `requireLocalLedger()` throws cleanly in remote mode.
- [ ] Every CLI subcommand goes through `makeLedger` (no direct `makeService()` calls remain in subcommand bodies).
- [ ] `docs/REMOTE-MODE.md` exists and matches the actual subcommand triage.
- [ ] `MIGRATION.md` links to REMOTE-MODE.md.

When all checked, Plan 4 is complete. With Plans 1–4 shipped, the original ADR-0010 design is fully realized.
