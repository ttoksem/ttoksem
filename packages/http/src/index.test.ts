import type { DashboardData, DashboardTaskDetailData, LedgerService } from "@ttoksem/core";
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
});

function fakeService(): LedgerService {
  return {
    dashboard: async () => dashboardData(),
    dashboardTask: async () => taskDetailData(),
  } as unknown as LedgerService;
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
    task_insights: [],
    tasks: [],
    recent: [],
    pricing_breakdown: [],
    accuracy_breakdown: [],
    daily: [],
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
