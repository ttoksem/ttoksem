import type { DashboardData, DashboardTaskDetailData, LedgerService } from "@ttoksem/core";
import type {
  DailyReport,
  PricingSourceSnapshotRecord,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "./index.js";

describe("createHttpApp auth", () => {
  it("requires a dashboard-scoped database access key for dashboard API data", async () => {
    const app = createHttpApp({
      service: fakeService(),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "valid-token" && requiredScopes.includes("dashboard:read"),
      },
    });

    await expect(app.request("/api/dashboard?workspace=test")).resolves.toMatchObject({ status: 401 });
    await expect(
      app.request("/api/dashboard?workspace=test", {
        headers: { Authorization: "Bearer wrong-token" },
      }),
    ).resolves.toMatchObject({ status: 403 });

    const response = await app.request("/api/dashboard?workspace=test", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ workspace: { key: "test" } });
  });

  it("requires api:write for mutation routes", async () => {
    const startedTasks: Array<{ key: string; name?: string }> = [];
    const createdWorkspaces: string[] = [];
    const app = createHttpApp({
      service: fakeService({
        createWorkspace: async (input) => {
          createdWorkspaces.push(input.key);
          return workspaceRecord({ key: input.key, name: input.name ?? input.key });
        },
        startTask: async (input) => {
          startedTasks.push({ key: input.key, name: input.name });
          return taskRecord({ key: input.key, name: input.name ?? input.key });
        },
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "write-token" && requiredScopes.includes("api:write"),
      },
    });

    const workspaceResponse = await app.request("/api/workspaces", {
      method: "POST",
      headers: { Authorization: "Bearer write-token", "content-type": "application/json" },
      body: JSON.stringify({ key: "test", name: "Test workspace" }),
    });
    expect(workspaceResponse.status).toBe(201);
    expect(createdWorkspaces).toEqual(["test"]);

    await expect(
      app.request("/api/tasks?workspace=test", {
        method: "POST",
        headers: { Authorization: "Bearer read-token", "content-type": "application/json" },
        body: JSON.stringify({ key: "write-api", name: "Write API" }),
      }),
    ).resolves.toMatchObject({ status: 403 });

    const response = await app.request("/api/tasks?workspace=test", {
      method: "POST",
      headers: { Authorization: "Bearer write-token", "content-type": "application/json" },
      body: JSON.stringify({ key: "write-api", name: "Write API" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      task: { key: "write-api", name: "Write API" },
    });
    expect(startedTasks).toEqual([{ key: "write-api", name: "Write API" }]);
  });

  it("records canonical usage events through the write API", async () => {
    const recorded: unknown[] = [];
    const app = createHttpApp({
      service: fakeService({
        recordUsage: async (message) => {
          recorded.push(message);
          return usageEventRecord({
            id: "usage_write_api",
            provider: message.payload.usage.provider,
            model: message.payload.usage.model,
            input_tokens: message.payload.usage.input_tokens ?? null,
            output_tokens: message.payload.usage.output_tokens ?? null,
          });
        },
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes, workspaceKey }) =>
          token === "write-token" && workspaceKey === "test" && requiredScopes.includes("api:write"),
      },
    });

    const response = await app.request("/api/usage/events", {
      method: "POST",
      headers: { Authorization: "Bearer write-token", "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: "1.0",
        message_id: "msg_http_write",
        kind: "ingest_message",
        type: "ai.usage.observed",
        occurred_at: "2026-04-28T00:00:00.000Z",
        source: { system: "http-test" },
        workspace: { key: "test" },
        payload: {
          task: null,
          usage: {
            provider: "openai",
            model: "gpt-5.5",
            usage_kind: "conversation_turn",
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            accuracy_mode: "exact",
            pricing_mode: "unpriced",
            unpriced_reason: "missing_pricing_rule",
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      usage_event: { id: "usage_write_api", provider: "openai", model: "gpt-5.5" },
    });
    expect(recorded).toHaveLength(1);
  });

  it("archives a task via POST /api/tasks/:taskKey/archive", async () => {
    const archived: Array<{ key: string }> = [];
    const app = createHttpApp({
      service: fakeService({
        archiveTask: async (input) => {
          archived.push({ key: input.key });
          return taskRecord({ key: input.key, status: "closed" });
        },
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "write-token" && requiredScopes.includes("api:write"),
      },
    });

    const response = await app.request("/api/tasks/feature-x/archive?workspace=test", {
      method: "POST",
      headers: { Authorization: "Bearer write-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      task: { key: "feature-x", status: "closed" },
    });
    expect(archived).toEqual([{ key: "feature-x" }]);
  });

  it("requires api:write for POST /api/tasks/:taskKey/archive", async () => {
    const app = createHttpApp({
      service: fakeService(),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "write-token" && requiredScopes.includes("api:write"),
      },
    });

    await expect(
      app.request("/api/tasks/feature-x/archive?workspace=test", { method: "POST" }),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      app.request("/api/tasks/feature-x/archive?workspace=test", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
      }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("POST /api/tasks/:taskKey/close still archives but emits deprecation headers", async () => {
    const archived: Array<{ key: string }> = [];
    const app = createHttpApp({
      service: fakeService({
        // closeTask in service forwards to archiveTask, but the HTTP handler
        // calls service.closeTask directly. Track via closeTask here so the
        // existing service contract is preserved.
        closeTask: async (input) => {
          archived.push({ key: input.key });
          return taskRecord({ key: input.key, status: "closed" });
        },
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "write-token" && requiredScopes.includes("api:write"),
      },
    });

    const response = await app.request("/api/tasks/feature-x/close?workspace=test", {
      method: "POST",
      headers: { Authorization: "Bearer write-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      task: { key: "feature-x", status: "closed" },
    });
    expect(archived).toEqual([{ key: "feature-x" }]);

    expect(response.headers.get("Deprecation")).toBe("Thu, 07 May 2026 00:00:00 GMT");
    expect(response.headers.get("Sunset")).toBe("Sat, 07 Nov 2026 00:00:00 GMT");
    const link = response.headers.get("Link");
    expect(link).toContain("/api/tasks/feature-x/archive");
    expect(link).toContain('rel="successor-version"');
  });

  it("returns 410 Gone with Sunset and Deprecation headers for GET /api/tasks/active", async () => {
    const app = createHttpApp({
      service: fakeService(),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "valid-token" && requiredScopes.includes("dashboard:read"),
      },
    });

    const response = await app.request("/api/tasks/active?workspace=test", {
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(410);
    expect(response.headers.get("Sunset")).toBe("Sat, 07 Nov 2026 00:00:00 GMT");
    expect(response.headers.get("Deprecation")).toBe("Thu, 07 May 2026 00:00:00 GMT");
    await expect(response.json()).resolves.toMatchObject({ error: "endpoint_removed" });
  });

  it("lists workspaces via GET /api/workspaces", async () => {
    const app = createHttpApp({
      service: fakeService({
        listWorkspaces: async () => [
          workspaceRecord({ key: "test", name: "Test workspace" }),
          workspaceRecord({ id: "ws_other", key: "other", name: "Other workspace" }),
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

  it("shows an inbox group via GET /api/inbox/groups/:groupId, 404 on miss", async () => {
    const app = createHttpApp({
      service: fakeService({
        showInboxGroup: async ({ groupId }) => {
          if (groupId !== "grp_known") throw new Error(`Inbox group not found: ${groupId}`);
          return {
            group: {
              group_id: "grp_known",
              assignment_status: "unassigned",
              event_count: 1,
              run_count: 0,
              token_count: 1,
              estimated_total: 0,
              currency: null,
              first_occurred_at: "2026-04-28T00:00:00.000Z",
              last_occurred_at: "2026-04-28T00:00:00.000Z",
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
            },
            events: [usageEventRecord({ id: "evt_1" })],
          };
        },
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "valid-token" && requiredScopes.includes("dashboard:read"),
      },
    });

    const ok = await app.request("/api/inbox/groups/grp_known?workspace=test", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      group: { group_id: "grp_known" },
      events: [{ id: "evt_1" }],
    });

    const miss = await app.request("/api/inbox/groups/grp_unknown?workspace=test", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(miss.status).toBe(404);
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

    await expect(app.request("/api/inbox/groups/grp_x?workspace=test")).resolves.toMatchObject({ status: 401 });
    await expect(
      app.request("/api/inbox/groups/grp_x?workspace=test", { headers: { Authorization: "Bearer wrong-token" } }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("returns a pricing snapshot via GET /api/pricing/snapshots/:id, 404 on miss", async () => {
    const snapshot = pricingSnapshotRecord({ id: "price_snapshot_test" });
    const app = createHttpApp({
      service: fakeService({
        getPricingSourceSnapshot: async (id) => (id === "price_snapshot_test" ? snapshot : null),
      }),
      defaultWorkspaceKey: "test",
      auth: {
        mode: "access-key",
        verifyAccessToken: async ({ token, requiredScopes }) =>
          token === "valid-token" && requiredScopes.includes("dashboard:read"),
      },
    });

    const ok = await app.request("/api/pricing/snapshots/price_snapshot_test", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ snapshot: { id: "price_snapshot_test" } });

    const miss = await app.request("/api/pricing/snapshots/price_snapshot_missing", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(miss.status).toBe(404);
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

    await expect(app.request("/api/pricing/snapshots/price_snapshot_x")).resolves.toMatchObject({ status: 401 });
    await expect(
      app.request("/api/pricing/snapshots/price_snapshot_x", { headers: { Authorization: "Bearer wrong-token" } }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("returns today's report via GET /api/reports/today", async () => {
    const app = createHttpApp({
      service: fakeService({
        reportToday: async () => dailyReport({ date: "2026-05-07" }),
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

  it("returns a per-task report via GET /api/reports/tasks/:taskKey", async () => {
    const app = createHttpApp({
      service: fakeService({
        reportTask: async () => dailyReport({ date: "2026-05-07" }),
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
});

function fakeService(overrides: Partial<LedgerService> = {}): LedgerService {
  return {
    dashboard: async () => dashboardData(),
    dashboardTask: async () => taskDetailData(),
    createWorkspace: async () => workspaceRecord({}),
    startTask: async () => taskRecord({}),
    updateTask: async () => taskRecord({}),
    closeTask: async () => taskRecord({ status: "closed" }),
    archiveTask: async () => taskRecord({ status: "closed" }),
    recordUsage: async () => usageEventRecord({}),
    moveUsage: async () => usageEventRecord({ task_id: "task_test", assignment_status: "assigned" }),
    assignInboxGroup: async () => ({
      group: {
        group_id: "inbox_test",
        assignment_status: "unassigned",
        event_count: 1,
        run_count: 0,
        token_count: 1,
        estimated_total: 0,
        currency: null,
        first_occurred_at: "2026-04-28T00:00:00.000Z",
        last_occurred_at: "2026-04-28T00:00:00.000Z",
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
      },
      task: { key: "task", name: "Task" },
      assigned_count: 1,
      skipped_count: 0,
      assigned_event_ids: ["usage_test"],
      skipped_event_ids: [],
    }),
    acceptInboxGroup: async () => ({
      group: {
        group_id: "inbox_test",
        assignment_status: "suggested",
        event_count: 1,
        run_count: 0,
        token_count: 1,
        estimated_total: 0,
        currency: null,
        first_occurred_at: "2026-04-28T00:00:00.000Z",
        last_occurred_at: "2026-04-28T00:00:00.000Z",
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
        suggested_task: { task_key: "task", task_name: "Task", confidence: 0.9, level: "high", reason: "test" },
      },
      task: { key: "task", name: "Task" },
      assigned_count: 1,
      skipped_count: 0,
      assigned_event_ids: ["usage_test"],
      skipped_event_ids: [],
    }),
    assignInboxEvent: async () => usageEventRecord({ task_id: "task_test", assignment_status: "assigned" }),
    ...overrides,
  } as unknown as LedgerService;
}

function dailyReport(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    workspace: workspaceRecord({}),
    date: "2026-05-07",
    estimated_total: 0,
    observed_total: 0,
    currency: null,
    event_count: 0,
    unpriced_count: 0,
    ...overrides,
  };
}

function pricingSnapshotRecord(overrides: Partial<PricingSourceSnapshotRecord>): PricingSourceSnapshotRecord {
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
    ...overrides,
  };
}

function workspaceRecord(overrides: Partial<WorkspaceRecord>): WorkspaceRecord {
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
    ...overrides,
  };
}

function dashboardData(): DashboardData {
  return {
    workspace: { key: "test", name: "Test" },
    summary: {
      event_count: 0,
      estimated_total: 0,
      observed_total: 0,
      currency: "USD",
      unpriced_count: 0,
      unassigned_count: 0,
      assigned_count: 0,
      task_count: 0,
      run_count: 0,
    },
    attention: [],
    insights: [],
    task_insights: [],
    tasks: [],
    recent: [],
    pricing_breakdown: [],
    accuracy_breakdown: [],
    provider_breakdown: [],
    daily: [],
  };
}

function taskRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task_test",
    workspace_id: "ws_test",
    key: "task",
    name: "Task",
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
    ...overrides,
  };
}

function usageEventRecord(overrides: Partial<UsageEventRecord>): UsageEventRecord {
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
    ...overrides,
  };
}

function taskDetailData(): DashboardTaskDetailData {
  return {
    workspace: { key: "test", name: "Test" },
    task: {
      key: "task",
      name: "Task",
      description: null,
      status: "active",
      created_at: "2026-04-27T00:00:00.000Z",
      started_at: null,
      closed_at: null,
    },
    insight: {
      task_key: "task",
      task_name: "Task",
      status: "clear",
      event_count: 0,
      token_count: 0,
      estimated_total: 0,
      unpriced_count: 0,
      run_count: 0,
      first_activity_at: null,
      last_activity_at: null,
      latest_prompt: null,
      signals: [],
      insight: "No usage.",
    },
    recent: [],
    daily: [],
    runs: [],
    provider_breakdown: [],
    pricing_breakdown: [],
    accuracy_breakdown: [],
  };
}
