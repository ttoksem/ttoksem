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

  it("creates and looks up runs by session id", async () => {
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
        session_id: "session-001",
        source: "test",
        started_at: "2026-04-27T00:00:01.000Z",
        external_ref_json: { system: "codex", id: "session-001" },
        now: "2026-04-27T00:00:00.000Z",
      });

      expect(run.session_id).toBe("session-001");
      expect(run.task_id).toBe("task_test");
      await expect(store.getRunBySessionId("ws_test", "session-001")).resolves.toMatchObject({
        id: "run_test",
        external_ref_json: { system: "codex", id: "session-001" },
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
});

function testDbPath(): string {
  return join(tmpdir(), `ttoksem-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}
