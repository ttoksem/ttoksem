import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1LedgerStore, type D1Database, type D1PreparedStatement, type D1Result, type D1RunResult } from "./index.js";

describe("D1LedgerStore", () => {
  it("runs the core ledger workflow against a D1-compatible database", async () => {
    const db = new FakeD1Database();
    const store = new D1LedgerStore(db);
    await store.migrate();

    const workspace = await store.createWorkspace({
      id: "ws_test",
      key: "d1-test",
      name: "D1 Test",
      root_path: null,
      source: "test",
      now: "2026-04-28T00:00:00.000Z",
    });
    const task = await store.createTask({
      id: "task_test",
      workspace_id: workspace.id,
      key: "d1-worker",
      name: "D1 Worker",
      description: null,
      source: "test",
      now: "2026-04-28T00:00:01.000Z",
    });
    await store.startTask(task.id, "2026-04-28T00:00:02.000Z");
    const run = await store.createRun({
      id: "run_test",
      workspace_id: workspace.id,
      task_id: task.id,
      source: "test",
      started_at: "2026-04-28T00:00:03.000Z",
      now: "2026-04-28T00:00:03.000Z",
    });
    await store.createAccessKey({
      id: "key_test",
      name: "Dashboard",
      token_prefix: "ttok_test",
      token_hash: "sha256:test",
      scopes_json: ["dashboard:read"],
      workspace_keys_json: ["d1-test"],
      expires_at: null,
      now: "2026-04-28T00:00:04.000Z",
    });
    await store.upsertPricingRule({
      id: "price_test",
      workspace_id: workspace.id,
      source_snapshot_id: null,
      provider: "openai",
      model: "gpt-test",
      usage_kind: "conversation_turn",
      unit_type: "input_token",
      price_nanos_per_unit: 10,
      currency: "USD",
      effective_from: "2026-01-01T00:00:00.000Z",
      source: "test",
      now: "2026-04-28T00:00:05.000Z",
    });
    const usage = await store.createUsageEvent({
      id: "usage_test",
      workspace_id: workspace.id,
      task_id: task.id,
      run_id: run.id,
      message_id: "msg_test",
      source: "d1-test",
      idempotency_key: "idem_test",
      occurred_at: "2026-04-28T00:00:06.000Z",
      started_at: "2026-04-28T00:00:06.000Z",
      ended_at: "2026-04-28T00:00:08.000Z",
      duration_ms: 2000,
      provider: "openai",
      model: "gpt-test",
      usage_kind: "conversation_turn",
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 110,
      observed_cost_nanos: null,
      estimated_cost_nanos: 1000,
      observed_currency: null,
      estimated_currency: "USD",
      accuracy_mode: "exact",
      pricing_mode: "rule_calculated",
      unpriced_reason: null,
      pricing_rule_ids_json: ["price_test"],
      pricing_source_snapshot_ids_json: null,
      cost_calculated_at: "2026-04-28T00:00:09.000Z",
      assignment_status: "assigned",
      payload_json: {
        payload: {
          prompt_snapshot: {
            mode: "redacted",
            prompt_text: "D1 test prompt",
          },
        },
      },
      now: "2026-04-28T00:00:09.000Z",
    });

    await expect(store.getWorkspaceByKey("d1-test")).resolves.toMatchObject({ id: "ws_test" });
    await expect(store.getUsageEventByIdempotency(workspace.id, "d1-test", "idem_test")).resolves.toMatchObject({
      id: usage.id,
      pricing_rule_ids_json: ["price_test"],
    });
    await expect(store.getAccessKeyByTokenHash("sha256:test")).resolves.toMatchObject({
      scopes_json: ["dashboard:read"],
      workspace_keys_json: ["d1-test"],
    });
    await expect(store.getDashboardSummary(workspace.id)).resolves.toMatchObject({
      event_count: 1,
      estimated_cost_nanos: 1000,
      currency: "USD",
      run_count: 1,
    });
    await expect(store.listDashboardTaskInsights(workspace.id, 10)).resolves.toMatchObject([
      {
        task_key: "d1-worker",
        latest_prompt: "D1 test prompt",
      },
    ]);
    await expect(store.listDashboardRunsForTask(workspace.id, task.id, 10)).resolves.toMatchObject([
      {
        run_id: "run_test",
        span_duration_ms: 5000,
        event_duration_ms: 2000,
      },
    ]);
  });
});

class FakeD1Database implements D1Database {
  private readonly db = new DatabaseSync(":memory:");

  prepare(query: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.db.prepare(query), []);
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.db.exec(query);
    return { count: 0, duration: 0 };
  }
}

class FakeD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly statement: ReturnType<DatabaseSync["prepare"]>,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.statement, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement.get(...(this.values as SQLInputValue[])) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: this.statement.all(...(this.values as SQLInputValue[])) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const result = this.statement.run(...(this.values as SQLInputValue[]));
    const changes = Number(result.changes);
    return {
      success: true,
      meta: {
        changes,
        changed_db: changes > 0,
      },
    };
  }
}
