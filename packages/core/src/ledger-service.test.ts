import type {
  PricingRuleRecord,
  RunRecord,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  CreateRunInput,
  CreateUsageEventInput,
  LedgerStore,
  UpsertPricingRuleInput,
} from "@ttoksem/storage";
import { describe, expect, it } from "vitest";
import { LedgerService } from "./ledger-service.js";

describe("LedgerService", () => {
  it("infers usage duration when start and end timestamps are present", async () => {
    const createdUsage: CreateUsageEventInput[] = [];
    const workspace = workspaceRecord();
    const task = taskRecord(workspace.id);
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        getTaskByKey: async () => task,
        createUsageEvent: async (input) => {
          createdUsage.push(input);
          return usageEventRecord(input);
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    await service.recordUsage({
      schema_version: "1.0",
      message_id: "msg_test",
      kind: "ingest_message",
      type: "ai.usage.observed",
      occurred_at: "2026-04-27T00:00:00.000Z",
      source: { system: "codex-chat" },
      workspace: { key: workspace.key },
      payload: {
        task: { key: task.key },
        usage: {
          provider: "openai",
          model: "codex-chat",
          usage_kind: "conversation_turn",
          started_at: "2026-04-27T00:00:01.000Z",
          ended_at: "2026-04-27T00:00:03.250Z",
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          accuracy_mode: "estimated",
          pricing_mode: "unpriced",
          unpriced_reason: "missing_pricing_rule",
        },
      },
    });

    expect(createdUsage[0]?.started_at).toBe("2026-04-27T00:00:01.000Z");
    expect(createdUsage[0]?.ended_at).toBe("2026-04-27T00:00:03.250Z");
    expect(createdUsage[0]?.duration_ms).toBe(2250);
  });

  it("creates a run from session_id and attaches usage to it", async () => {
    const createdRuns: CreateRunInput[] = [];
    const createdUsage: CreateUsageEventInput[] = [];
    const workspace = workspaceRecord();
    const task = taskRecord(workspace.id);
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        getTaskByKey: async () => task,
        getRunBySessionId: async () => null,
        createRun: async (input) => {
          createdRuns.push(input);
          return runRecord(input);
        },
        createUsageEvent: async (input) => {
          createdUsage.push(input);
          return usageEventRecord(input);
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    await service.recordUsage({
      schema_version: "1.0",
      message_id: "msg_test",
      kind: "ingest_message",
      type: "ai.usage.observed",
      occurred_at: "2026-04-27T00:00:00.000Z",
      source: { system: "codex-chat" },
      workspace: { key: workspace.key },
      payload: {
        task: { key: task.key },
        run: { session_id: "codex-thread-2026-04-27" },
        usage: {
          provider: "openai",
          model: "codex-chat",
          usage_kind: "conversation_turn",
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          accuracy_mode: "estimated",
          pricing_mode: "unpriced",
          unpriced_reason: "missing_pricing_rule",
        },
      },
    });

    expect(createdRuns[0]).toMatchObject({
      id: "run_test",
      workspace_id: workspace.id,
      task_id: task.id,
      session_id: "codex-thread-2026-04-27",
      source: "codex-chat",
      started_at: "2026-04-27T00:00:00.000Z",
    });
    expect(createdUsage[0]?.run_id).toBe("run_test");
  });

  it("calculates estimated cost from active pricing rules", async () => {
    const createdUsage: CreateUsageEventInput[] = [];
    const workspace = workspaceRecord();
    const task = taskRecord(workspace.id);
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        getTaskByKey: async () => task,
        listPricingRulesForUsage: async () => [
          pricingRule({ unit_type: "input_token", price_nanos_per_unit: 100 }),
          pricingRule({ unit_type: "output_token", price_nanos_per_unit: 500 }),
        ],
        createUsageEvent: async (input) => {
          createdUsage.push(input);
          return usageEventRecord(input);
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    await service.recordUsage({
      schema_version: "1.0",
      message_id: "msg_test",
      kind: "ingest_message",
      type: "ai.usage.observed",
      occurred_at: "2026-04-27T00:00:00.000Z",
      source: { system: "codex-chat" },
      workspace: { key: workspace.key },
      payload: {
        task: { key: task.key },
        usage: {
          provider: "openai",
          model: "codex-chat",
          usage_kind: "conversation_turn",
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          accuracy_mode: "estimated",
          pricing_mode: "unpriced",
          unpriced_reason: "missing_pricing_rule",
        },
      },
    });

    expect(createdUsage[0]?.estimated_cost_nanos).toBe(11_000);
    expect(createdUsage[0]?.estimated_currency).toBe("USD");
    expect(createdUsage[0]?.pricing_mode).toBe("rule_calculated");
    expect(createdUsage[0]?.unpriced_reason).toBeNull();
  });
});

function fakeStore(overrides: Partial<LedgerStore>): LedgerStore {
  return {
    migrate: async () => {},
    close: async () => {},
    createWorkspace: async () => workspaceRecord(),
    getWorkspaceById: async () => null,
    getWorkspaceByKey: async () => null,
    getWorkspaceByRootPath: async () => null,
    listWorkspaces: async () => [],
    createTask: async () => taskRecord("ws_test"),
    getTaskById: async () => null,
    getTaskByKey: async () => null,
    listTasks: async () => [],
    startTask: async () => taskRecord("ws_test"),
    closeTask: async () => taskRecord("ws_test"),
    setActiveTask: async () => workspaceRecord(),
    createRun: async (input) => runRecord(input),
    getRunById: async () => null,
    getRunBySessionId: async () => null,
    upsertPricingRule: async (input) => pricingRule(input),
    listPricingRules: async () => [],
    listPricingRulesForUsage: async () => [],
    createUsageEvent: async (input) => usageEventRecord(input),
    getUsageEventByIdempotency: async () => null,
    listUsageEventsByAssignment: async () => [],
    moveUsageEventToTask: async () => usageEventRecord(defaultUsageInput()),
    listUnpricedUsageEvents: async () => [],
    updateUsageEventPricing: async (_workspaceId, _usageEventId, input) =>
      usageEventRecord({
        ...defaultUsageInput(),
        estimated_cost_nanos: input.estimated_cost_nanos,
        estimated_currency: input.estimated_currency,
        pricing_mode: input.pricing_mode,
        unpriced_reason: input.unpriced_reason,
      }),
    reportUsageByDay: async () => [],
    reportUsageByTask: async () => [],
    ...overrides,
  };
}

function workspaceRecord(): WorkspaceRecord {
  return {
    id: "ws_test",
    key: "test",
    name: "Test",
    description: null,
    status: "active",
    root_path: "/tmp/test",
    active_task_id: null,
    source: "test",
    external_ref_json: null,
    metadata_json: null,
    created_at: "2026-04-27T00:00:00.000Z",
    archived_at: null,
    updated_at: "2026-04-27T00:00:00.000Z",
  };
}

function taskRecord(workspaceId: string): TaskRecord {
  return {
    id: "task_test",
    workspace_id: workspaceId,
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
    created_at: "2026-04-27T00:00:00.000Z",
    started_at: "2026-04-27T00:00:00.000Z",
    closed_at: null,
    updated_at: "2026-04-27T00:00:00.000Z",
  };
}

function pricingRule(input: Partial<UpsertPricingRuleInput> = {}): PricingRuleRecord {
  return {
    id: input.id ?? "price_test",
    workspace_id: input.workspace_id ?? "ws_test",
    provider: input.provider ?? "openai",
    model: input.model ?? "codex-chat",
    usage_kind: input.usage_kind ?? "conversation_turn",
    unit_type: input.unit_type ?? "input_token",
    price_nanos_per_unit: input.price_nanos_per_unit ?? 1,
    currency: input.currency ?? "USD",
    effective_from: input.effective_from ?? "2026-04-27T00:00:00.000Z",
    effective_to: null,
    source: input.source ?? "test",
    metadata_json: input.metadata_json ?? null,
    created_at: input.now ?? "2026-04-27T00:00:00.000Z",
    updated_at: input.now ?? "2026-04-27T00:00:00.000Z",
  };
}

function runRecord(input: CreateRunInput): RunRecord {
  return {
    id: input.id,
    workspace_id: input.workspace_id,
    task_id: input.task_id ?? null,
    session_id: input.session_id,
    status: "active",
    source: input.source,
    external_ref_json: input.external_ref_json ?? null,
    metadata_json: input.metadata_json ?? null,
    started_at: input.started_at ?? input.now,
    ended_at: null,
    created_at: input.now,
    updated_at: input.now,
  };
}

function usageEventRecord(input: CreateUsageEventInput): UsageEventRecord {
  return {
    id: input.id,
    workspace_id: input.workspace_id,
    task_id: input.task_id ?? null,
    run_id: input.run_id ?? null,
    message_id: input.message_id,
    source: input.source,
    idempotency_key: input.idempotency_key ?? null,
    occurred_at: input.occurred_at,
    started_at: input.started_at ?? null,
    ended_at: input.ended_at ?? null,
    duration_ms: input.duration_ms ?? null,
    provider: input.provider,
    model: input.model,
    usage_kind: input.usage_kind,
    input_tokens: input.input_tokens ?? null,
    output_tokens: input.output_tokens ?? null,
    total_tokens: input.total_tokens ?? null,
    observed_cost_nanos: input.observed_cost_nanos ?? null,
    estimated_cost_nanos: input.estimated_cost_nanos ?? null,
    observed_currency: input.observed_currency ?? null,
    estimated_currency: input.estimated_currency ?? null,
    accuracy_mode: input.accuracy_mode,
    pricing_mode: input.pricing_mode ?? null,
    unpriced_reason: input.unpriced_reason ?? null,
    assignment_status: input.assignment_status,
    payload_json: input.payload_json,
    created_at: input.now,
  };
}

function defaultUsageInput(): CreateUsageEventInput {
  return {
    id: "usage_test",
    workspace_id: "ws_test",
    task_id: null,
    run_id: null,
    message_id: "msg_test",
    source: "test",
    idempotency_key: null,
    occurred_at: "2026-04-27T00:00:00.000Z",
    provider: "openai",
    model: "codex-chat",
    usage_kind: "conversation_turn",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    observed_cost_nanos: null,
    estimated_cost_nanos: null,
    observed_currency: null,
    estimated_currency: null,
    accuracy_mode: "estimated",
    pricing_mode: "unpriced",
    unpriced_reason: "missing_pricing_rule",
    assignment_status: "unassigned",
    payload_json: {},
    now: "2026-04-27T00:00:00.000Z",
  };
}
