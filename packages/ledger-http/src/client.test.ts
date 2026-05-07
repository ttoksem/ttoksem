import { describe, expect, it } from "vitest";
import { createHttpApp } from "@ttoksem/http";
import type { LedgerService, RunAction, InboxGroup, InboxAssignmentResult } from "@ttoksem/core";
import type { TaskRecord, WorkspaceRecord, AiUsageObserved, UsageEventRecord } from "@ttoksem/schema";
import { HttpLedgerClient } from "./client.js";

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
  } as InboxGroup;
}

const stubAssignmentResult: InboxAssignmentResult = {
  group: inboxGroup(),
  task: { key: "alpha", name: "Alpha" },
  assigned_count: 1,
  skipped_count: 0,
  assigned_event_ids: ["usage_test"],
  skipped_event_ids: [],
};

function buildClient(servicePartial: Partial<LedgerService>) {
  const app = createHttpApp({
    service: servicePartial as unknown as LedgerService,
    defaultWorkspaceKey: "test",
    auth: {
      mode: "access-key",
      verifyAccessToken: async () => true,
    },
  });
  // Wrap app.request to work with fetch-like interface
  const mockFetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + (new URL(url).search || "");
    return app.request(path, {
      method: init?.method || "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body,
    });
  };
  return new HttpLedgerClient({
    baseUrl: "http://test.invalid",
    token: "test-token",
    defaultWorkspaceKey: "test",
    fetch: mockFetch as typeof fetch,
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
      listWorkspaces: async () => [workspaceRecord({ key: "a" }), workspaceRecord({ id: "ws_b", key: "b" })],
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
      listTasks: async () => [taskRecord({ key: "x" }), taskRecord({ id: "task_y", key: "y" })],
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

describe("HttpLedgerClient — run + usage methods", () => {
  it("runActions GETs /api/runs/:runId/actions", async () => {
    const action: RunAction = {
      event_id: "evt_x",
      occurred_at: "2026-04-28T00:00:00Z",
      message_id: "msg_x",
      text_excerpt: "text",
      thinking_excerpt: null,
      tool_calls: [],
      has_thinking: false,
      source: "missing",
    };
    const client = buildClient({ runActions: async () => [action] });
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
    const mockFetch = async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/api/usage/events")) {
        return new Response(JSON.stringify({ usage_event: usageEventRecord({ id: "usage_new" }) }), { status: 201 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    };
    const client = new HttpLedgerClient({
      baseUrl: "http://test.invalid",
      token: "test-token",
      defaultWorkspaceKey: "test",
      fetch: mockFetch as typeof fetch,
    });
    const event = await client.recordUsage({
      schema_version: "1.0",
      message_id: "m1",
      kind: "ingest_message",
      type: "ai.usage.observed",
      occurred_at: "2026-04-28T00:00:00Z",
      source: { system: "test" },
      workspace: { key: "test" },
      payload: {
        usage: {
          provider: "openai",
          model: "gpt",
          usage_kind: "conversation_turn",
          input_tokens: 1,
          output_tokens: 1,
        },
      },
    } as AiUsageObserved);
    expect(event.id).toBe("usage_new");
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
      assignInboxEvent: async (input) =>
        usageEventRecord({ id: input.usageEventId, task_id: "task_target", assignment_status: "assigned" }),
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
