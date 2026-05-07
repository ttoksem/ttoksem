import { describe, expect, it } from "vitest";
import { createHttpApp } from "@ttoksem/http";
import type { LedgerService } from "@ttoksem/core";
import type { TaskRecord, WorkspaceRecord } from "@ttoksem/schema";
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
