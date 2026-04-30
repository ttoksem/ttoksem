import type {
  AccessKeyRecord,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
  RunRecord,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  CreateAccessKeyInput,
  CreateRunInput,
  CreateUsageEventInput,
  LedgerStore,
  UpsertPricingSourceSnapshotInput,
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

  it("creates an explicit run and attaches usage to it", async () => {
    const createdRuns: CreateRunInput[] = [];
    const createdUsage: CreateUsageEventInput[] = [];
    const runTimingUpdates: Array<{
      workspaceId: string;
      runId: string;
      startedAt?: string | null;
      endedAt?: string | null;
      now: string;
    }> = [];
    const workspace = workspaceRecord();
    const task = taskRecord(workspace.id);
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        getTaskByKey: async () => task,
        createRun: async (input) => {
          createdRuns.push(input);
          return runRecord(input);
        },
        createUsageEvent: async (input) => {
          createdUsage.push(input);
          return usageEventRecord(input);
        },
        updateRunTiming: async (input) => {
          runTimingUpdates.push(input);
          return runRecord({
            id: input.runId,
            workspace_id: input.workspaceId,
            task_id: task.id,
            source: "codex-chat",
            started_at: input.startedAt ?? null,
            now: input.now,
          });
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
        run: { id: "run_explicit" },
        usage: {
          provider: "openai",
          model: "codex-chat",
          usage_kind: "conversation_turn",
          started_at: "2026-04-27T00:00:01.000Z",
          ended_at: "2026-04-27T00:00:04.000Z",
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
      id: "run_explicit",
      workspace_id: workspace.id,
      task_id: task.id,
      source: "codex-chat",
      started_at: "2026-04-27T00:00:01.000Z",
    });
    expect(createdUsage[0]?.run_id).toBe("run_explicit");
    expect(runTimingUpdates[0]).toMatchObject({
      workspaceId: workspace.id,
      runId: "run_explicit",
      startedAt: "2026-04-27T00:00:01.000Z",
      endedAt: "2026-04-27T00:00:04.000Z",
    });
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
          pricingRule({
            id: "price_input",
            source_snapshot_id: "price_snapshot_test",
            unit_type: "input_token",
            price_nanos_per_unit: 100,
          }),
          pricingRule({
            id: "price_output",
            source_snapshot_id: "price_snapshot_test",
            unit_type: "output_token",
            price_nanos_per_unit: 500,
          }),
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
    expect(createdUsage[0]?.pricing_rule_ids_json).toEqual(["price_input", "price_output"]);
    expect(createdUsage[0]?.pricing_source_snapshot_ids_json).toEqual(["price_snapshot_test"]);
    expect(createdUsage[0]?.cost_calculated_at).toBe("2026-04-27T00:00:10.000Z");
  });

  it("migrates existing rule-calculated event pricing from current rules", async () => {
    const updates: CreateUsageEventInput[] = [];
    const workspace = workspaceRecord();
    const existing = usageEventRecord({
      ...defaultUsageInput(),
      id: "usage_existing",
      workspace_id: workspace.id,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      estimated_cost_nanos: 1,
      estimated_currency: "USD",
      pricing_mode: "rule_calculated",
      unpriced_reason: null,
      payload_json: {
        schema_version: "1.0",
        message_id: "msg_existing",
        kind: "ingest_message",
        type: "ai.usage.observed",
        occurred_at: "2026-04-27T00:00:00.000Z",
        source: { system: "codex-chat" },
        workspace: { key: workspace.key },
        payload: {
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
      },
    });
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        listUsageEventsForPricingMigration: async () => [existing],
        listPricingRulesForUsage: async () => [
          pricingRule({
            id: "price_input",
            source_snapshot_id: "price_snapshot_test",
            unit_type: "input_token",
            price_nanos_per_unit: 100,
          }),
          pricingRule({
            id: "price_output",
            source_snapshot_id: "price_snapshot_test",
            unit_type: "output_token",
            price_nanos_per_unit: 500,
          }),
        ],
        updateUsageEventPricing: async (_workspaceId, _usageEventId, input) => {
          updates.push({
            ...defaultUsageInput(),
            ...input,
            pricing_mode: input.pricing_mode,
          });
          return usageEventRecord({
            ...defaultUsageInput(),
            ...input,
            pricing_mode: input.pricing_mode,
          });
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    const result = await service.migrateUsageEventPricing({
      workspace: { key: workspace.key },
      mode: "repriceable",
    });

    expect(result).toEqual({ checked: 1, migrated: 1, unchanged: 0, still_unpriced: 0 });
    expect(updates[0]?.estimated_cost_nanos).toBe(11_000);
    expect(updates[0]?.pricing_rule_ids_json).toEqual(["price_input", "price_output"]);
  });

  it("preserves manual estimated costs during pricing migration", async () => {
    const updates: CreateUsageEventInput[] = [];
    const workspace = workspaceRecord();
    const existing = usageEventRecord({
      ...defaultUsageInput(),
      id: "usage_manual_existing",
      workspace_id: workspace.id,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      estimated_cost_nanos: null,
      estimated_currency: null,
      pricing_mode: null,
      unpriced_reason: null,
      payload_json: {
        schema_version: "1.0",
        message_id: "msg_manual_existing",
        kind: "ingest_message",
        type: "ai.usage.observed",
        occurred_at: "2026-04-27T00:00:00.000Z",
        source: { system: "manual-import" },
        workspace: { key: workspace.key },
        payload: {
          usage: {
            provider: "openai",
            model: "codex-chat",
            usage_kind: "conversation_turn",
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            estimated_cost: 0.25,
            estimated_currency: "USD",
            accuracy_mode: "manual",
            pricing_mode: "manual",
          },
        },
      },
    });
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        listUsageEventsForPricingMigration: async () => [existing],
        updateUsageEventPricing: async (_workspaceId, _usageEventId, input) => {
          updates.push({
            ...defaultUsageInput(),
            ...input,
            pricing_mode: input.pricing_mode,
          });
          return usageEventRecord({
            ...defaultUsageInput(),
            ...input,
            pricing_mode: input.pricing_mode,
          });
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    const result = await service.migrateUsageEventPricing({
      workspace: { key: workspace.key },
      mode: "repriceable",
    });

    expect(result).toEqual({ checked: 1, migrated: 1, unchanged: 0, still_unpriced: 0 });
    expect(updates[0]?.estimated_cost_nanos).toBe(250_000_000);
    expect(updates[0]?.estimated_currency).toBe("USD");
    expect(updates[0]?.pricing_mode).toBe("manual");
    expect(updates[0]?.unpriced_reason).toBeNull();
  });

  it("verifies database access keys by hash, scope, and optional workspace restriction", async () => {
    const workspace = workspaceRecord();
    const key = accessKeyRecord({
      token_hash: "sha256:test",
      scopes_json: ["dashboard:read"],
      workspace_keys_json: [workspace.key],
    });
    const touched: string[] = [];
    const service = new LedgerService({
      store: fakeStore({
        getWorkspaceByKey: async () => workspace,
        getAccessKeyByTokenHash: async () => key,
        touchAccessKey: async (id) => {
          touched.push(id);
        },
      }),
      clock: { now: () => "2026-04-27T00:00:10.000Z" },
      idFactory: (prefix) => `${prefix}_test`,
    });

    await expect(
      service.verifyAccessKey({
        workspaceKey: workspace.key,
        tokenHash: "sha256:test",
        requiredScopes: ["dashboard:read"],
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "allowed" });
    expect(touched).toEqual(["key_test"]);

    await expect(
      service.verifyAccessKey({
        workspaceKey: workspace.key,
        tokenHash: "sha256:test",
        requiredScopes: ["usage:write"],
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "insufficient_scope" });
    await expect(
      service.verifyAccessKey({
        workspaceKey: "other-workspace",
        tokenHash: "sha256:test",
        requiredScopes: ["dashboard:read"],
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "workspace_not_allowed" });
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
    updateTaskDetails: async (input) => ({
      ...taskRecord("ws_test"),
      name: input.name ?? "Task",
      description: input.description ?? null,
      updated_at: input.now,
    }),
    getTaskById: async () => null,
    getTaskByKey: async () => null,
    listTasks: async () => [],
    startTask: async () => taskRecord("ws_test"),
    closeTask: async () => taskRecord("ws_test"),
    setActiveTask: async () => workspaceRecord(),
    createRun: async (input) => runRecord(input),
    getRunById: async () => null,
    updateRunTiming: async (input) => ({
      ...runRecord({
        id: input.runId,
        workspace_id: input.workspaceId,
        source: "test",
        started_at: input.startedAt ?? null,
        now: input.now,
      }),
      ended_at: input.endedAt ?? null,
    }),
    createAccessKey: async (input) => accessKeyRecord(input),
    listAccessKeys: async () => [],
    getAccessKeyById: async () => null,
    getAccessKeyByTokenHash: async () => null,
    revokeAccessKey: async (id, now) =>
      accessKeyRecord({ id, name: "revoked", now, revoked_at: now }),
    touchAccessKey: async () => {},
    countActiveAccessKeys: async () => 0,
    upsertPricingSourceSnapshot: async (input) => pricingSourceSnapshot(input),
    listPricingSourceSnapshots: async () => [],
    getPricingSourceSnapshotById: async () => null,
    upsertPricingRule: async (input) => pricingRule(input),
    listPricingRules: async () => [],
    listPricingRulesForUsage: async () => [],
    createUsageEvent: async (input) => usageEventRecord(input),
    getUsageEventByIdempotency: async () => null,
    listUsageEventsByAssignment: async () => [],
    listUsageEventsByRun: async () => [],
    moveUsageEventToTask: async () => usageEventRecord(defaultUsageInput()),
    listUnpricedUsageEvents: async () => [],
    listUsageEventsForPricingMigration: async () => [],
    updateUsageEventPricing: async (_workspaceId, _usageEventId, input) =>
      usageEventRecord({
        ...defaultUsageInput(),
        estimated_cost_nanos: input.estimated_cost_nanos,
        estimated_currency: input.estimated_currency,
        pricing_mode: input.pricing_mode,
        unpriced_reason: input.unpriced_reason,
        pricing_rule_ids_json: input.pricing_rule_ids_json,
        pricing_source_snapshot_ids_json: input.pricing_source_snapshot_ids_json,
        cost_calculated_at: input.cost_calculated_at,
      }),
    reportUsageByDay: async () => [],
    reportUsageByTask: async () => [],
    getDashboardSummary: async () => ({
      event_count: 0,
      estimated_cost_nanos: 0,
      observed_cost_nanos: 0,
      unpriced_count: 0,
      unassigned_count: 0,
      assigned_count: 0,
      task_count: 0,
      run_count: 0,
      currency: null,
    }),
    listDashboardTaskCosts: async () => [],
    getDashboardTaskInsight: async () => null,
    listDashboardTaskInsights: async () => [],
    listRecentUsageEvents: async () => [],
    listRecentUsageEventsForTask: async () => [],
    listDashboardPricingModeBreakdown: async () => [],
    listDashboardPricingModeBreakdownForTask: async () => [],
    listDashboardAccuracyModeBreakdown: async () => [],
    listDashboardAccuracyModeBreakdownForTask: async () => [],
    listDashboardProviderModelBreakdownForTask: async () => [],
    listDashboardDailyCosts: async () => [],
    listDashboardDailyCostsForTask: async () => [],
    listDashboardRunsForTask: async () => [],
    getLastImportedAt: async () => null,
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

function accessKeyRecord(
  input: Partial<CreateAccessKeyInput> & {
    revoked_at?: string | null;
    last_used_at?: string | null;
  } = {},
): AccessKeyRecord {
  return {
    id: input.id ?? "key_test",
    name: input.name ?? "Test key",
    token_prefix: input.token_prefix ?? "ttok_test",
    token_hash: input.token_hash ?? "hash_test",
    scopes_json: input.scopes_json ?? ["dashboard:read"],
    workspace_keys_json: input.workspace_keys_json ?? null,
    expires_at: input.expires_at ?? null,
    revoked_at: input.revoked_at ?? null,
    last_used_at: input.last_used_at ?? null,
    created_at: input.now ?? "2026-04-27T00:00:00.000Z",
    updated_at: input.now ?? "2026-04-27T00:00:00.000Z",
  };
}

function pricingRule(input: Partial<UpsertPricingRuleInput> = {}): PricingRuleRecord {
  return {
    id: input.id ?? "price_test",
    workspace_id: input.workspace_id ?? "ws_test",
    source_snapshot_id: input.source_snapshot_id ?? null,
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

function pricingSourceSnapshot(
  input: Partial<UpsertPricingSourceSnapshotInput> = {},
): PricingSourceSnapshotRecord {
  return {
    id: input.id ?? "price_snapshot_test",
    source_name: input.source_name ?? "litellm",
    source_url: input.source_url ?? null,
    source_version: input.source_version ?? null,
    source_commit: input.source_commit ?? "abc123",
    source_retrieved_at: input.source_retrieved_at ?? null,
    bundled_at: input.bundled_at ?? null,
    valid_from: input.valid_from ?? null,
    raw_sha256: input.raw_sha256 ?? "sha256:test",
    raw_storage_ref: input.raw_storage_ref ?? null,
    metadata_json: input.metadata_json ?? null,
    created_at: input.now ?? "2026-04-27T00:00:00.000Z",
  };
}

function runRecord(input: CreateRunInput): RunRecord {
  return {
    id: input.id,
    workspace_id: input.workspace_id,
    task_id: input.task_id ?? null,
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
    pricing_rule_ids_json: input.pricing_rule_ids_json ?? null,
    pricing_source_snapshot_ids_json: input.pricing_source_snapshot_ids_json ?? null,
    cost_calculated_at: input.cost_calculated_at ?? null,
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
    pricing_rule_ids_json: null,
    pricing_source_snapshot_ids_json: null,
    cost_calculated_at: null,
    assignment_status: "unassigned",
    payload_json: {},
    now: "2026-04-27T00:00:00.000Z",
  };
}
