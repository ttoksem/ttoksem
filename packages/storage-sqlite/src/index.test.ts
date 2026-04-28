import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteLedgerStore } from "./index.js";

describe("SqliteLedgerStore", () => {
  it("creates a workspace and preserves root path lookup", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      const workspace = await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });

      expect(workspace.key).toBe("test");
      await expect(store.getWorkspaceByRootPath("/tmp/test")).resolves.toMatchObject({
        id: "ws_test",
      });
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("lists unassigned usage and moves it to a task", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createTask({
        id: "task_test",
        workspace_id: "ws_test",
        key: "task",
        name: "Task",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createUsageEvent({
        id: "usage_test",
        workspace_id: "ws_test",
        task_id: null,
        run_id: null,
        message_id: "msg_test",
        source: "test",
        idempotency_key: "test:usage",
        occurred_at: "2026-04-27T00:00:00.000Z",
        started_at: "2026-04-27T00:00:01.000Z",
        ended_at: "2026-04-27T00:00:03.000Z",
        duration_ms: 2000,
        provider: "openai",
        model: "codex-chat",
        usage_kind: "conversation_turn",
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        observed_cost_nanos: null,
        estimated_cost_nanos: null,
        observed_currency: null,
        estimated_currency: null,
        accuracy_mode: "estimated",
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
        assignment_status: "unassigned",
        payload_json: {
          schema_version: "1.0",
          payload: { task: null },
        },
        now: "2026-04-27T00:00:00.000Z",
      });

      await expect(store.listUsageEventsByAssignment("ws_test", "unassigned", 10)).resolves.toHaveLength(
        1,
      );

      const moved = await store.moveUsageEventToTask("ws_test", "usage_test", "task_test");

      expect(moved.task_id).toBe("task_test");
      expect(moved.assignment_status).toBe("assigned");
      expect(moved.duration_ms).toBe(2000);
      await expect(store.listUsageEventsByAssignment("ws_test", "unassigned", 10)).resolves.toHaveLength(
        0,
      );
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("creates and looks up runs by id", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createTask({
        id: "task_test",
        workspace_id: "ws_test",
        key: "task",
        name: "Task",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });

      const run = await store.createRun({
        id: "run_test",
        workspace_id: "ws_test",
        task_id: "task_test",
        source: "test",
        started_at: "2026-04-27T00:00:01.000Z",
        external_ref_json: { system: "codex", id: "run-001" },
        now: "2026-04-27T00:00:00.000Z",
      });

      expect(run.task_id).toBe("task_test");
      await expect(store.getRunById("run_test")).resolves.toMatchObject({
        id: "run_test",
        external_ref_json: { system: "codex", id: "run-001" },
      });
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("upserts pricing rules and updates usage pricing", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });

      const snapshot = await store.upsertPricingSourceSnapshot({
        id: "price_snapshot_test",
        source_name: "litellm",
        source_commit: "abc123",
        raw_sha256: "sha256:test",
        raw_storage_ref: "package:pricing/test.json",
        now: "2026-04-27T00:00:00.000Z",
      });
      expect(snapshot.id).toBe("price_snapshot_test");
      await expect(store.listPricingSourceSnapshots()).resolves.toHaveLength(1);

      const rule = await store.upsertPricingRule({
        id: "price_test",
        workspace_id: "ws_test",
        source_snapshot_id: "price_snapshot_test",
        provider: "openai",
        model: "codex-chat",
        usage_kind: "conversation_turn",
        unit_type: "input_token",
        price_nanos_per_unit: 100,
        currency: "USD",
        effective_from: "2026-04-27T00:00:00.000Z",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      expect(rule.price_nanos_per_unit).toBe(100);
      expect(rule.source_snapshot_id).toBe("price_snapshot_test");

      await expect(
        store.listPricingRulesForUsage({
          workspaceId: "ws_test",
          provider: "openai",
          model: "codex-chat",
          usageKind: "conversation_turn",
          occurredAt: "2026-04-27T00:00:01.000Z",
        }),
      ).resolves.toHaveLength(1);

      await store.createUsageEvent({
        id: "usage_test",
        workspace_id: "ws_test",
        task_id: null,
        run_id: null,
        message_id: "msg_test",
        source: "test",
        idempotency_key: "test:usage",
        occurred_at: "2026-04-27T00:00:00.000Z",
        provider: "openai",
        model: "codex-chat",
        usage_kind: "conversation_turn",
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        observed_cost_nanos: null,
        estimated_cost_nanos: null,
        observed_currency: null,
        estimated_currency: null,
        accuracy_mode: "estimated",
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
        assignment_status: "unassigned",
        payload_json: {
          schema_version: "1.0",
          payload: { task: null },
        },
        now: "2026-04-27T00:00:00.000Z",
      });

      await expect(store.listUnpricedUsageEvents("ws_test", 10)).resolves.toHaveLength(1);
      const repriced = await store.updateUsageEventPricing("ws_test", "usage_test", {
        estimated_cost_nanos: 1000,
        estimated_currency: "USD",
        pricing_mode: "rule_calculated",
        unpriced_reason: null,
        pricing_rule_ids_json: ["price_test"],
        pricing_source_snapshot_ids_json: ["price_snapshot_test"],
        cost_calculated_at: "2026-04-27T00:00:01.000Z",
      });
      expect(repriced.estimated_cost_nanos).toBe(1000);
      expect(repriced.pricing_mode).toBe("rule_calculated");
      expect(repriced.pricing_rule_ids_json).toEqual(["price_test"]);
      expect(repriced.pricing_source_snapshot_ids_json).toEqual(["price_snapshot_test"]);
      expect(repriced.cost_calculated_at).toBe("2026-04-27T00:00:01.000Z");
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("returns dashboard summary, task costs, and recent usage rows", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createTask({
        id: "task_test",
        workspace_id: "ws_test",
        key: "task",
        name: "Task",
        description: "Original task description",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      const updatedTask = await store.updateTaskDetails({
        taskId: "task_test",
        name: "Named Task",
        description: "Updated task description",
        now: "2026-04-27T00:00:02.000Z",
      });
      expect(updatedTask).toMatchObject({
        name: "Named Task",
        description: "Updated task description",
        updated_at: "2026-04-27T00:00:02.000Z",
      });
      await store.createRun({
        id: "run_test",
        workspace_id: "ws_test",
        task_id: "task_test",
        source: "test",
        started_at: "2026-04-27T00:00:00.000Z",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createUsageEvent({
        id: "usage_test",
        workspace_id: "ws_test",
        task_id: "task_test",
        run_id: "run_test",
        message_id: "msg_test",
        source: "test",
        idempotency_key: "test:dashboard",
        occurred_at: "2026-04-27T00:00:00.000Z",
        provider: "openai",
        model: "codex-chat",
        usage_kind: "conversation_turn",
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        observed_cost_nanos: null,
        estimated_cost_nanos: 1500,
        observed_currency: null,
        estimated_currency: "USD",
        accuracy_mode: "estimated",
        pricing_mode: "rule_calculated",
        unpriced_reason: null,
        assignment_status: "assigned",
        payload_json: {
          schema_version: "1.0",
          payload: {
            task: { key: "task" },
            prompt_snapshot: { mode: "full", prompt_text: "dashboard prompt" },
          },
        },
        now: "2026-04-27T00:00:00.000Z",
      });

      await expect(store.getDashboardSummary("ws_test")).resolves.toMatchObject({
        event_count: 1,
        estimated_cost_nanos: 1500,
        unpriced_count: 0,
        unassigned_count: 0,
        assigned_count: 1,
        task_count: 1,
        run_count: 1,
        currency: "USD",
      });
      await expect(store.listDashboardTaskCosts("ws_test", 10)).resolves.toMatchObject([
        {
          task_key: "task",
          task_name: "Named Task",
          event_count: 1,
          token_count: 30,
          estimated_cost_nanos: 1500,
        },
      ]);
      await expect(store.listDashboardTaskInsights("ws_test", 10)).resolves.toMatchObject([
        {
          task_key: "task",
          task_name: "Named Task",
          task_status: "open",
          event_count: 1,
          run_count: 1,
          token_count: 30,
          estimated_cost_nanos: 1500,
          first_activity_at: "2026-04-27T00:00:00.000Z",
          last_activity_at: "2026-04-27T00:00:00.000Z",
          latest_prompt: "dashboard prompt",
        },
      ]);
      await expect(store.getDashboardTaskInsight("ws_test", "task_test")).resolves.toMatchObject({
        task_key: "task",
        task_name: "Named Task",
        task_status: "open",
        event_count: 1,
        run_count: 1,
        token_count: 30,
        estimated_cost_nanos: 1500,
        latest_prompt: "dashboard prompt",
      });
      await expect(store.listRecentUsageEvents("ws_test", 10)).resolves.toMatchObject([
        {
          id: "usage_test",
          task_key: "task",
          task_name: "Named Task",
          run_id: "run_test",
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          token_count: 30,
          prompt_text: "dashboard prompt",
        },
      ]);
      await expect(store.listRecentUsageEventsForTask("ws_test", "task_test", 10)).resolves.toMatchObject([
        {
          id: "usage_test",
          task_key: "task",
          task_name: "Named Task",
          run_id: "run_test",
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          token_count: 30,
          prompt_text: "dashboard prompt",
        },
      ]);
      await expect(store.listDashboardPricingModeBreakdown("ws_test")).resolves.toMatchObject([
        { key: "rule_calculated", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardPricingModeBreakdownForTask("ws_test", "task_test")).resolves.toMatchObject([
        { key: "rule_calculated", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardAccuracyModeBreakdownForTask("ws_test", "task_test")).resolves.toMatchObject([
        { key: "estimated", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardProviderModelBreakdownForTask("ws_test", "task_test")).resolves.toMatchObject([
        { key: "openai/codex-chat", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardDailyCosts("ws_test", 10)).resolves.toMatchObject([
        { date: "2026-04-27", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardDailyCostsForTask("ws_test", "task_test", 10)).resolves.toMatchObject([
        { date: "2026-04-27", event_count: 1, estimated_cost_nanos: 1500 },
      ]);
      await expect(store.listDashboardRunsForTask("ws_test", "task_test", 10)).resolves.toMatchObject([
        {
          run_id: "run_test",
          run_status: "active",
          event_count: 1,
          token_count: 30,
          estimated_cost_nanos: 1500,
        },
      ]);
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("groups dashboard daily costs by a dashboard timezone offset", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      await store.createUsageEvent({
        id: "usage_late_utc",
        workspace_id: "ws_test",
        task_id: null,
        run_id: null,
        message_id: "msg_late_utc",
        source: "test",
        idempotency_key: "test:late-utc",
        occurred_at: "2026-04-26T23:30:00.000Z",
        provider: "openai",
        model: "gpt-5.5",
        usage_kind: "conversation_turn",
        input_tokens: 10,
        output_tokens: 1,
        total_tokens: 11,
        observed_cost_nanos: null,
        estimated_cost_nanos: 1000,
        observed_currency: null,
        estimated_currency: "USD",
        accuracy_mode: "exact",
        pricing_mode: "rule_calculated",
        unpriced_reason: null,
        assignment_status: "unassigned",
        payload_json: { schema_version: "1.0", payload: { task: null } },
        now: "2026-04-27T00:00:00.000Z",
      });

      await expect(store.listDashboardDailyCosts("ws_test", 10)).resolves.toMatchObject([
        { date: "2026-04-26", event_count: 1, estimated_cost_nanos: 1000 },
      ]);
      await expect(store.listDashboardDailyCosts("ws_test", 10, 540)).resolves.toMatchObject([
        { date: "2026-04-27", event_count: 1, estimated_cost_nanos: 1000 },
      ]);
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  it("stores, uses, and revokes database access keys", async () => {
    const dbPath = testDbPath();
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });
      const key = await store.createAccessKey({
        id: "key_test",
        name: "Dashboard",
        token_prefix: "ttok_test_prefix",
        token_hash: "sha256:test",
        scopes_json: ["dashboard:read"],
        workspace_keys_json: ["test"],
        now: "2026-04-27T00:00:01.000Z",
      });

      expect(key).toMatchObject({
        id: "key_test",
        token_prefix: "ttok_test_prefix",
        scopes_json: ["dashboard:read"],
        workspace_keys_json: ["test"],
        revoked_at: null,
        last_used_at: null,
      });
      await expect(store.listAccessKeys()).resolves.toHaveLength(1);
      await expect(store.getAccessKeyByTokenHash("sha256:test")).resolves.toMatchObject({
        id: "key_test",
      });
      await expect(store.countActiveAccessKeys("2026-04-27T00:00:02.000Z")).resolves.toBe(1);

      await store.touchAccessKey("key_test", "2026-04-27T00:00:03.000Z");
      await expect(store.getAccessKeyById("key_test")).resolves.toMatchObject({
        last_used_at: "2026-04-27T00:00:03.000Z",
      });

      await store.revokeAccessKey("key_test", "2026-04-27T00:00:04.000Z");
      await expect(store.countActiveAccessKeys("2026-04-27T00:00:05.000Z")).resolves.toBe(0);
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });
});

function testDbPath(): string {
  return join(tmpdir(), `ttoksem-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}
