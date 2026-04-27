import {
  AiUsageObservedSchema,
  type AiUsageObserved,
  type DailyReport,
  type PricingRuleRecord,
  type PricingSourceSnapshotRecord,
  type RunRecord,
  type TaskRecord,
  type UsageEventRecord,
  type WorkspaceRecord,
} from "@ttoksem/schema";
import type { LedgerReportRow, LedgerStore } from "@ttoksem/storage";
import { decimalToNanos, nanosToDecimal } from "./money.js";

export interface Clock {
  now(): string;
}

export interface LedgerServiceOptions {
  store: LedgerStore;
  clock?: Clock;
  idFactory?: (prefix: string) => string;
}

export interface WorkspaceResolver {
  key?: string;
  id?: string;
  rootPath?: string;
}

export interface PricingRuleUpsertInput {
  workspace: WorkspaceResolver;
  sourceSnapshotId?: string | null;
  provider: string;
  model: string;
  usageKind: string;
  unitType: string;
  priceNanosPerUnit: number;
  currency: string;
  effectiveFrom?: string;
  source?: string;
}

export interface PricingSourceSnapshotUpsertInput {
  id?: string;
  sourceName: "litellm" | "manual" | "import" | "openrouter";
  sourceUrl?: string | null;
  sourceVersion?: string | null;
  sourceCommit?: string | null;
  sourceRetrievedAt?: string | null;
  bundledAt?: string | null;
  validFrom?: string | null;
  rawSha256: string;
  rawStorageRef?: string | null;
  metadataJson?: Record<string, unknown> | null;
}

export interface RepriceResult {
  checked: number;
  repriced: number;
  still_unpriced: number;
}

export class LedgerService {
  private readonly store: LedgerStore;
  private readonly clock: Clock;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: LedgerServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async init(): Promise<void> {
    await this.store.migrate();
  }

  async createWorkspace(input: {
    key: string;
    name?: string;
    rootPath?: string | null;
  }): Promise<WorkspaceRecord> {
    const existing = await this.store.getWorkspaceByKey(input.key);
    if (existing) return existing;
    return this.store.createWorkspace({
      id: this.idFactory("ws"),
      key: input.key,
      name: input.name ?? input.key,
      root_path: input.rootPath ?? null,
      source: "cli",
      now: this.clock.now(),
    });
  }

  async resolveWorkspace(resolver: WorkspaceResolver): Promise<WorkspaceRecord> {
    if (resolver.id) {
      const workspace = await this.store.getWorkspaceById(resolver.id);
      if (workspace) return workspace;
    }
    if (resolver.key) {
      const workspace = await this.store.getWorkspaceByKey(resolver.key);
      if (workspace) return workspace;
    }
    if (resolver.rootPath) {
      const workspace = await this.store.getWorkspaceByRootPath(resolver.rootPath);
      if (workspace) return workspace;
    }
    throw new Error("Workspace not found. Run `ttoksem workspace init` first.");
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.store.listWorkspaces();
  }

  async currentWorkspace(rootPath: string): Promise<WorkspaceRecord> {
    return this.resolveWorkspace({ rootPath });
  }

  async startTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
  }): Promise<TaskRecord> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const now = this.clock.now();
    const existing = await this.store.getTaskByKey(workspace.id, input.key);
    const task =
      existing ??
      (await this.store.createTask({
        id: this.idFactory("task"),
        workspace_id: workspace.id,
        key: input.key,
        name: input.name ?? input.key,
        source: "cli",
        now,
      }));
    const activeTask = await this.store.startTask(task.id, now);
    await this.store.setActiveTask(workspace.id, activeTask.id, now);
    return activeTask;
  }

  async closeTask(input: { workspace: WorkspaceResolver; key?: string }): Promise<TaskRecord> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = input.key
      ? await this.store.getTaskByKey(workspace.id, input.key)
      : workspace.active_task_id
        ? await this.store.getTaskById(workspace.active_task_id)
        : null;
    if (!task) throw new Error("Task not found.");
    const closed = await this.store.closeTask(task.id, this.clock.now());
    if (workspace.active_task_id === task.id) {
      await this.store.setActiveTask(workspace.id, null, this.clock.now());
    }
    return closed;
  }

  async listTasks(input: { workspace: WorkspaceResolver }): Promise<TaskRecord[]> {
    const workspace = await this.resolveWorkspace(input.workspace);
    return this.store.listTasks(workspace.id);
  }

  async upsertPricingRule(input: PricingRuleUpsertInput): Promise<PricingRuleRecord> {
    const workspace = await this.resolveWorkspace(input.workspace);
    return this.store.upsertPricingRule({
      id: this.idFactory("price"),
      workspace_id: workspace.id,
      source_snapshot_id: input.sourceSnapshotId ?? null,
      provider: input.provider,
      model: input.model,
      usage_kind: input.usageKind,
      unit_type: input.unitType,
      price_nanos_per_unit: input.priceNanosPerUnit,
      currency: input.currency,
      effective_from: input.effectiveFrom ?? this.clock.now(),
      source: input.source ?? "cli",
      now: this.clock.now(),
    });
  }

  async upsertPricingSourceSnapshot(
    input: PricingSourceSnapshotUpsertInput,
  ): Promise<PricingSourceSnapshotRecord> {
    return this.store.upsertPricingSourceSnapshot({
      id: input.id ?? this.idFactory("price_snapshot"),
      source_name: input.sourceName,
      source_url: input.sourceUrl ?? null,
      source_version: input.sourceVersion ?? null,
      source_commit: input.sourceCommit ?? null,
      source_retrieved_at: input.sourceRetrievedAt ?? null,
      bundled_at: input.bundledAt ?? null,
      valid_from: input.validFrom ?? null,
      raw_sha256: input.rawSha256,
      raw_storage_ref: input.rawStorageRef ?? null,
      metadata_json: input.metadataJson ?? null,
      now: this.clock.now(),
    });
  }

  async listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]> {
    return this.store.listPricingSourceSnapshots();
  }

  async listPricingRules(input: { workspace: WorkspaceResolver }): Promise<PricingRuleRecord[]> {
    const workspace = await this.resolveWorkspace(input.workspace);
    return this.store.listPricingRules(workspace.id);
  }

  async recordUsage(message: AiUsageObserved): Promise<UsageEventRecord> {
    const parsed = AiUsageObservedSchema.parse(message);
    const workspace = await this.resolveWorkspace({
      id: parsed.workspace.id,
      key: parsed.workspace.key,
      rootPath: parsed.workspace.root_path,
    });
    const source = parsed.source.system;
    if (parsed.idempotency_key) {
      const existing = await this.store.getUsageEventByIdempotency(
        workspace.id,
        source,
        parsed.idempotency_key,
      );
      if (existing) return existing;
    }

    const task = await this.resolveUsageTask(workspace, parsed);
    const run = await this.resolveUsageRun(workspace, task, parsed);
    const usage = parsed.payload.usage;
    const pricing = await this.priceUsage(workspace.id, parsed);
    return this.store.createUsageEvent({
      id: this.idFactory("usage"),
      workspace_id: workspace.id,
      task_id: task?.id ?? null,
      run_id: run?.id ?? null,
      message_id: parsed.message_id,
      source,
      idempotency_key: parsed.idempotency_key ?? null,
      occurred_at: parsed.occurred_at,
      started_at: usage.started_at ?? null,
      ended_at: usage.ended_at ?? null,
      duration_ms: usage.duration_ms ?? inferDurationMs(usage.started_at, usage.ended_at),
      provider: usage.provider,
      model: usage.model,
      usage_kind: usage.usage_kind,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      observed_cost_nanos: decimalToNanos(usage.observed_cost),
      estimated_cost_nanos: pricing.estimatedCostNanos,
      observed_currency: usage.observed_currency ?? null,
      estimated_currency: pricing.estimatedCurrency,
      accuracy_mode: usage.accuracy_mode,
      pricing_mode: pricing.pricingMode,
      unpriced_reason: pricing.unpricedReason,
      pricing_rule_ids_json: pricing.pricingRuleIds,
      pricing_source_snapshot_ids_json: pricing.pricingSourceSnapshotIds,
      cost_calculated_at: pricing.costCalculatedAt,
      assignment_status: task ? "assigned" : "unassigned",
      payload_json: parsed,
      now: this.clock.now(),
    });
  }

  async repriceUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<RepriceResult> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const events = await this.store.listUnpricedUsageEvents(workspace.id, input.limit ?? 100);
    let repriced = 0;
    let stillUnpriced = 0;
    for (const event of events) {
      const message = AiUsageObservedSchema.parse(event.payload_json);
      const pricing = await this.priceUsage(workspace.id, message);
      if (pricing.pricingMode === "rule_calculated") {
        await this.store.updateUsageEventPricing(workspace.id, event.id, {
          estimated_cost_nanos: pricing.estimatedCostNanos,
          estimated_currency: pricing.estimatedCurrency,
          pricing_mode: "rule_calculated",
          unpriced_reason: null,
          pricing_rule_ids_json: pricing.pricingRuleIds,
          pricing_source_snapshot_ids_json: pricing.pricingSourceSnapshotIds,
          cost_calculated_at: pricing.costCalculatedAt,
        });
        repriced += 1;
      } else {
        stillUnpriced += 1;
      }
    }
    return { checked: events.length, repriced, still_unpriced: stillUnpriced };
  }

  async listInbox(input: { workspace: WorkspaceResolver; limit?: number }): Promise<UsageEventRecord[]> {
    const workspace = await this.resolveWorkspace(input.workspace);
    return this.store.listUsageEventsByAssignment(workspace.id, "unassigned", input.limit ?? 20);
  }

  async moveUsage(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.taskKey);
    if (!task) throw new Error(`Task not found: ${input.taskKey}`);
    return this.store.moveUsageEventToTask(workspace.id, input.usageEventId, task.id);
  }

  async reportToday(input: { workspace: WorkspaceResolver; date?: string }): Promise<DailyReport> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const date = input.date ?? this.clock.now().slice(0, 10);
    const rows = await this.store.reportUsageByDay(workspace.id, date);
    return toDailyReport(workspace, date, rows);
  }

  async reportTask(input: { workspace: WorkspaceResolver; taskKey: string }): Promise<DailyReport> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.taskKey);
    if (!task) throw new Error("Task not found.");
    const rows = await this.store.reportUsageByTask(workspace.id, task.id);
    return toDailyReport(workspace, `task:${task.key}`, rows);
  }

  private async resolveUsageTask(
    workspace: WorkspaceRecord,
    message: AiUsageObserved,
  ): Promise<TaskRecord | null> {
    if (message.payload.task === null) return null;
    const taskRef = message.payload.task;
    if (taskRef?.id) return this.store.getTaskById(taskRef.id);
    if (taskRef?.key) return this.store.getTaskByKey(workspace.id, taskRef.key);
    if (workspace.active_task_id) return this.store.getTaskById(workspace.active_task_id);
    return null;
  }

  private async resolveUsageRun(
    workspace: WorkspaceRecord,
    task: TaskRecord | null,
    message: AiUsageObserved,
  ): Promise<RunRecord | null> {
    if (message.payload.run === null || message.payload.run === undefined) return null;
    const runRef = message.payload.run;
    if (runRef.id) {
      const existing = await this.store.getRunById(runRef.id);
      if (existing) return existing;
      if (!runRef.id.startsWith("run_")) throw new Error(`Invalid run id: ${runRef.id}`);
      return this.store.createRun({
        id: runRef.id,
        workspace_id: workspace.id,
        task_id: task?.id ?? null,
        session_id: runRef.session_id ?? runRef.id,
        source: message.source.system,
        started_at: message.payload.usage.started_at ?? message.occurred_at,
        external_ref_json: runRef.external_ref ?? null,
        now: this.clock.now(),
      });
    }
    if (!runRef.session_id) return null;
    const existing = await this.store.getRunBySessionId(workspace.id, runRef.session_id);
    if (existing) return existing;
    return this.store.createRun({
      id: this.idFactory("run"),
      workspace_id: workspace.id,
      task_id: task?.id ?? null,
      session_id: runRef.session_id,
      source: message.source.system,
      started_at: message.payload.usage.started_at ?? message.occurred_at,
      external_ref_json: runRef.external_ref ?? null,
      now: this.clock.now(),
    });
  }

  private async priceUsage(
    workspaceId: string,
    message: AiUsageObserved,
  ): Promise<{
    estimatedCostNanos: number | null;
    estimatedCurrency: string | null;
    pricingMode: "provider_reported" | "rule_calculated" | "manual" | "unpriced";
    unpricedReason: string | null;
    pricingRuleIds: string[] | null;
    pricingSourceSnapshotIds: string[] | null;
    costCalculatedAt: string | null;
  }> {
    const usage = message.payload.usage;
    if (usage.observed_cost != null) {
      return {
        estimatedCostNanos: decimalToNanos(usage.estimated_cost),
        estimatedCurrency: usage.estimated_currency ?? null,
        pricingMode: "provider_reported",
        unpricedReason: null,
        pricingRuleIds: null,
        pricingSourceSnapshotIds: null,
        costCalculatedAt: null,
      };
    }
    if (usage.estimated_cost != null) {
      return {
        estimatedCostNanos: decimalToNanos(usage.estimated_cost),
        estimatedCurrency: usage.estimated_currency ?? null,
        pricingMode: usage.pricing_mode ?? "manual",
        unpricedReason: null,
        pricingRuleIds: null,
        pricingSourceSnapshotIds: null,
        costCalculatedAt: null,
      };
    }

    const rules = await this.store.listPricingRulesForUsage({
      workspaceId,
      provider: usage.provider,
      model: usage.model,
      usageKind: usage.usage_kind,
      occurredAt: message.occurred_at,
    });
    if (rules.length === 0) {
      return {
        estimatedCostNanos: null,
        estimatedCurrency: null,
        pricingMode: "unpriced",
        unpricedReason: usage.unpriced_reason ?? "missing_pricing_rule",
        pricingRuleIds: null,
        pricingSourceSnapshotIds: null,
        costCalculatedAt: null,
      };
    }

    let total = 0;
    const currencies = new Set<string>();
    const pricingRuleIds: string[] = [];
    const pricingSourceSnapshotIds = new Set<string>();
    let appliedRules = 0;
    for (const rule of rules) {
      const quantity = quantityForRule(rule.unit_type, usage);
      if (quantity == null) continue;
      total += Math.round(quantity * rule.price_nanos_per_unit);
      currencies.add(rule.currency);
      pricingRuleIds.push(rule.id);
      if (rule.source_snapshot_id) pricingSourceSnapshotIds.add(rule.source_snapshot_id);
      appliedRules += 1;
    }

    if (appliedRules === 0) {
      return {
        estimatedCostNanos: null,
        estimatedCurrency: null,
        pricingMode: "unpriced",
        unpricedReason: "missing_usage_units",
        pricingRuleIds: null,
        pricingSourceSnapshotIds: null,
        costCalculatedAt: null,
      };
    }
    if (currencies.size !== 1) {
      return {
        estimatedCostNanos: null,
        estimatedCurrency: null,
        pricingMode: "unpriced",
        unpricedReason: "mixed_currency",
        pricingRuleIds: null,
        pricingSourceSnapshotIds: null,
        costCalculatedAt: null,
      };
    }

    return {
      estimatedCostNanos: total,
      estimatedCurrency: [...currencies][0],
      pricingMode: "rule_calculated",
      unpricedReason: null,
      pricingRuleIds,
      pricingSourceSnapshotIds: [...pricingSourceSnapshotIds],
      costCalculatedAt: this.clock.now(),
    };
  }
}

function quantityForRule(unitType: string, usage: AiUsageObserved["payload"]["usage"]): number | null {
  if (unitType === "input_token") return usage.input_tokens ?? null;
  if (unitType === "output_token") return usage.output_tokens ?? null;
  if (unitType === "total_token") return usage.total_tokens ?? null;
  if (unitType === "request") return usage.request_count ?? null;
  if (unitType === "second") return usage.seconds ?? null;
  if (unitType === "image") return usage.image_count ?? null;
  if (usage.unit_type === unitType) return usage.unit_count ?? null;
  return null;
}

function toDailyReport(workspace: WorkspaceRecord, date: string, rows: LedgerReportRow[]): DailyReport {
  const estimatedTotal = rows.reduce((sum, row) => sum + nanosToDecimal(row.estimated_cost_nanos), 0);
  const observedTotal = rows.reduce((sum, row) => sum + nanosToDecimal(row.observed_cost_nanos), 0);
  const currencies = new Set(
    rows
      .flatMap((row) => [row.observed_currency, row.estimated_currency])
      .filter((value): value is string => Boolean(value)),
  );
  return {
    workspace,
    date,
    estimated_total: estimatedTotal,
    observed_total: observedTotal,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    event_count: rows.length,
    unpriced_count: rows.filter((row) => row.pricing_mode === "unpriced").length,
  };
}

function inferPricingMode(
  observedCost: number | null | undefined,
  estimatedCost: number | null | undefined,
): "provider_reported" | "rule_calculated" | "unpriced" {
  if (observedCost != null) return "provider_reported";
  if (estimatedCost != null) return "rule_calculated";
  return "unpriced";
}

function inferDurationMs(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  if (!startedAt || !endedAt) return null;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function defaultIdFactory(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.replaceAll("-", "").slice(0, 24)}`;
}
