import {
  AiUsageObservedSchema,
  type AccessKeyRecord,
  type AiUsageObserved,
  type DailyReport,
  type PricingRuleRecord,
  type PricingSourceSnapshotRecord,
  type RunRecord,
  type TaskRecord,
  type UsageEventRecord,
  type WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  DashboardBreakdownRow,
  DashboardRecentUsageRow,
  DashboardSummaryRow,
  DashboardTaskInsightRow,
  LedgerReportRow,
  LedgerStore,
  UsagePricingUpdateInput,
} from "@ttoksem/storage";
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

export interface PricingMigrationResult {
  checked: number;
  migrated: number;
  unchanged: number;
  still_unpriced: number;
}

export interface AccessKeyVerificationResult {
  allowed: boolean;
  key: AccessKeyRecord | null;
  reason: "allowed" | "not_found" | "revoked" | "expired" | "insufficient_scope" | "workspace_not_allowed";
}

export interface DashboardData {
  workspace: {
    key: string;
    name: string;
  };
  summary: {
    event_count: number;
    estimated_total: number;
    observed_total: number;
    currency: string | null;
    unpriced_count: number;
    unassigned_count: number;
    assigned_count: number;
    task_count: number;
    run_count: number;
  };
  attention: Array<{
    severity: "info" | "warn" | "bad";
    title: string;
    body: string;
    metric: string;
    task_key: string | null;
  }>;
  task_insights: Array<{
    task_key: string;
    task_name: string;
    status: string;
    event_count: number;
    token_count: number;
    estimated_total: number;
    unpriced_count: number;
    run_count: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
    latest_prompt: string | null;
    signals: string[];
    insight: string;
  }>;
  tasks: Array<{
    task_key: string;
    task_name: string;
    event_count: number;
    token_count: number;
    estimated_total: number;
    unpriced_count: number;
  }>;
  recent: Array<{
    id: string;
    occurred_at: string;
    task_key: string;
    task_name: string;
    provider_model: string;
    usage_kind: string;
    tokens: number;
    cost: number;
    currency: string | null;
    confidence: string;
    assignment_status: string;
    duration_ms: number | null;
    prompt: string | null;
  }>;
  pricing_breakdown: Array<{
    key: string;
    event_count: number;
    estimated_total: number;
  }>;
  accuracy_breakdown: Array<{
    key: string;
    event_count: number;
    estimated_total: number;
  }>;
  daily: Array<{
    date: string;
    event_count: number;
    estimated_total: number;
  }>;
}

export interface DashboardTaskDetailData {
  workspace: {
    key: string;
    name: string;
  };
  task: {
    key: string;
    name: string;
    description: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    closed_at: string | null;
  };
  insight: DashboardData["task_insights"][number];
  recent: DashboardData["recent"];
  daily: DashboardData["daily"];
  runs: Array<{
    run_id: string;
    status: string;
    source: string;
    started_at: string | null;
    ended_at: string | null;
    event_count: number;
    token_count: number;
    estimated_total: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
  }>;
  provider_breakdown: DashboardData["pricing_breakdown"];
  pricing_breakdown: DashboardData["pricing_breakdown"];
  accuracy_breakdown: DashboardData["accuracy_breakdown"];
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

  async createAccessKey(input: {
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    workspaceKeys?: string[] | null;
    expiresAt?: string | null;
  }): Promise<AccessKeyRecord> {
    const name = input.name.trim();
    if (name.length === 0) throw new Error("Access key name cannot be empty.");
    if (input.tokenPrefix.trim().length === 0) throw new Error("Access key token prefix cannot be empty.");
    if (input.tokenHash.trim().length === 0) throw new Error("Access key token hash cannot be empty.");
    if (input.expiresAt != null && !input.expiresAt.endsWith("Z")) {
      throw new Error("Access key expires_at must be UTC ISO text ending in Z.");
    }
    return this.store.createAccessKey({
      id: this.idFactory("key"),
      name,
      token_prefix: input.tokenPrefix,
      token_hash: input.tokenHash,
      scopes_json: normalizeAccessScopes(input.scopes),
      workspace_keys_json: normalizeAccessWorkspaceKeys(input.workspaceKeys ?? null),
      expires_at: input.expiresAt ?? null,
      now: this.clock.now(),
    });
  }

  async listAccessKeys(): Promise<AccessKeyRecord[]> {
    return this.store.listAccessKeys();
  }

  async revokeAccessKey(input: { id: string }): Promise<AccessKeyRecord> {
    return this.store.revokeAccessKey(input.id, this.clock.now());
  }

  async countActiveAccessKeys(): Promise<number> {
    return this.store.countActiveAccessKeys(this.clock.now());
  }

  async verifyAccessKey(input: {
    workspaceKey: string;
    tokenHash: string;
    requiredScopes: string[];
  }): Promise<AccessKeyVerificationResult> {
    const key = await this.store.getAccessKeyByTokenHash(input.tokenHash);
    const now = this.clock.now();
    if (!key) return { allowed: false, key: null, reason: "not_found" };
    if (key.revoked_at) return { allowed: false, key, reason: "revoked" };
    if (key.expires_at && key.expires_at <= now) return { allowed: false, key, reason: "expired" };
    if (!hasRequiredAccessScopes(key.scopes_json, normalizeAccessScopes(input.requiredScopes))) {
      return { allowed: false, key, reason: "insufficient_scope" };
    }
    if (!hasWorkspaceAccess(key.workspace_keys_json ?? null, input.workspaceKey)) {
      return { allowed: false, key, reason: "workspace_not_allowed" };
    }
    await this.store.touchAccessKey(key.id, now);
    return { allowed: true, key, reason: "allowed" };
  }

  async currentWorkspace(rootPath: string): Promise<WorkspaceRecord> {
    return this.resolveWorkspace({ rootPath });
  }

  async startTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
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
        description: input.description ?? null,
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

  async updateTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.key);
    if (!task) throw new Error(`Task not found: ${input.key}`);
    const name = input.name?.trim();
    if (name != null && name.length === 0) throw new Error("Task name cannot be empty.");
    const update = {
      taskId: task.id,
      now: this.clock.now(),
      ...(name ? { name } : {}),
      ...(Object.hasOwn(input, "description") ? { description: input.description ?? null } : {}),
    };
    return this.store.updateTaskDetails(update);
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

  async getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null> {
    return this.store.getPricingSourceSnapshotById(id);
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

  async migrateUsageEventPricing(input: {
    workspace: WorkspaceResolver;
    limit?: number;
    mode?: "unpriced" | "repriceable";
  }): Promise<PricingMigrationResult> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const events = await this.store.listUsageEventsForPricingMigration(
      workspace.id,
      input.limit ?? 100,
      input.mode ?? "repriceable",
    );
    let migrated = 0;
    let unchanged = 0;
    let stillUnpriced = 0;
    for (const event of events) {
      const message = AiUsageObservedSchema.parse(event.payload_json);
      const pricing = await this.priceUsage(workspace.id, message);
      if (pricing.pricingMode === "provider_reported") {
        unchanged += 1;
        continue;
      }
      const pricingMode =
        pricing.pricingMode === "rule_calculated" || pricing.pricingMode === "manual"
          ? pricing.pricingMode
          : "unpriced";
      const update: UsagePricingUpdateInput = {
        estimated_cost_nanos: pricing.estimatedCostNanos,
        estimated_currency: pricing.estimatedCurrency,
        pricing_mode: pricingMode,
        unpriced_reason: pricing.unpricedReason,
        pricing_rule_ids_json: pricing.pricingRuleIds,
        pricing_source_snapshot_ids_json: pricing.pricingSourceSnapshotIds,
        cost_calculated_at: pricing.costCalculatedAt,
      };
      if (pricingMode === "unpriced") {
        stillUnpriced += 1;
      }
      if (usagePricingMatches(event, update)) {
        unchanged += 1;
        continue;
      }
      await this.store.updateUsageEventPricing(workspace.id, event.id, update);
      migrated += 1;
    }
    return { checked: events.length, migrated, unchanged, still_unpriced: stillUnpriced };
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

  async dashboard(input: {
    workspace: WorkspaceResolver;
    taskLimit?: number;
    recentLimit?: number;
    dayLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardData> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const [summary, tasks, taskInsightRows, recent, pricingBreakdown, accuracyBreakdown, daily] =
      await Promise.all([
        this.store.getDashboardSummary(workspace.id),
        this.store.listDashboardTaskCosts(workspace.id, input.taskLimit ?? 20),
        this.store.listDashboardTaskInsights(workspace.id, input.taskLimit ?? 20),
        this.store.listRecentUsageEvents(workspace.id, input.recentLimit ?? 30),
        this.store.listDashboardPricingModeBreakdown(workspace.id),
        this.store.listDashboardAccuracyModeBreakdown(workspace.id),
        this.store.listDashboardDailyCosts(
          workspace.id,
          input.dayLimit ?? 14,
          input.timeZoneOffsetMinutes,
        ),
      ]);
    const taskInsights = buildTaskInsights(taskInsightRows);

    return {
      workspace: {
        key: workspace.key,
        name: workspace.name,
      },
      summary: {
        event_count: summary.event_count ?? 0,
        estimated_total: nanosToDecimal(summary.estimated_cost_nanos),
        observed_total: nanosToDecimal(summary.observed_cost_nanos),
        currency: summary.currency,
        unpriced_count: summary.unpriced_count ?? 0,
        unassigned_count: summary.unassigned_count ?? 0,
        assigned_count: summary.assigned_count ?? 0,
        task_count: summary.task_count ?? 0,
        run_count: summary.run_count ?? 0,
      },
      attention: buildAttention(summary, taskInsights),
      task_insights: taskInsights,
      tasks: tasks.map((task) => ({
        task_key: task.task_key ?? "unassigned",
        task_name: task.task_name ?? "Unassigned",
        event_count: task.event_count,
        token_count: task.token_count,
        estimated_total: nanosToDecimal(task.estimated_cost_nanos),
        unpriced_count: task.unpriced_count,
      })),
      recent: recent.map(toDashboardRecent),
      pricing_breakdown: pricingBreakdown.map((row) => ({
        key: row.key,
        event_count: row.event_count,
        estimated_total: nanosToDecimal(row.estimated_cost_nanos),
      })),
      accuracy_breakdown: accuracyBreakdown.map((row) => ({
        key: row.key,
        event_count: row.event_count,
        estimated_total: nanosToDecimal(row.estimated_cost_nanos),
      })),
      daily: daily.map((row) => ({
        date: row.date,
        event_count: row.event_count,
        estimated_total: nanosToDecimal(row.estimated_cost_nanos),
      })),
    };
  }

  async dashboardTask(input: {
    workspace: WorkspaceResolver;
    taskKey: string;
    recentLimit?: number;
    dayLimit?: number;
    runLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardTaskDetailData> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.taskKey);
    if (!task) throw new Error("Task not found.");

    const [
      workspaceInsights,
      taskInsightRow,
      recent,
      daily,
      runs,
      providerBreakdown,
      pricingBreakdown,
      accuracyBreakdown,
    ] = await Promise.all([
      this.store.listDashboardTaskInsights(workspace.id, 200),
      this.store.getDashboardTaskInsight(workspace.id, task.id),
      this.store.listRecentUsageEventsForTask(workspace.id, task.id, input.recentLimit ?? 100),
      this.store.listDashboardDailyCostsForTask(
        workspace.id,
        task.id,
        input.dayLimit ?? 30,
        input.timeZoneOffsetMinutes,
      ),
      this.store.listDashboardRunsForTask(workspace.id, task.id, input.runLimit ?? 100),
      this.store.listDashboardProviderModelBreakdownForTask(workspace.id, task.id),
      this.store.listDashboardPricingModeBreakdownForTask(workspace.id, task.id),
      this.store.listDashboardAccuracyModeBreakdownForTask(workspace.id, task.id),
    ]);
    const maxCostNanos = Math.max(...workspaceInsights.map((row) => row.estimated_cost_nanos), 0);
    const insight = taskInsightRow
      ? buildTaskInsights([taskInsightRow], { maxCostNanos })[0]
      : emptyTaskInsight(task);

    return {
      workspace: {
        key: workspace.key,
        name: workspace.name,
      },
      task: {
        key: task.key,
        name: task.name,
        description: task.description ?? null,
        status: task.status,
        created_at: task.created_at,
        started_at: task.started_at ?? null,
        closed_at: task.closed_at ?? null,
      },
      insight,
      recent: recent.map(toDashboardRecent),
      daily: daily.map((row) => ({
        date: row.date,
        event_count: row.event_count,
        estimated_total: nanosToDecimal(row.estimated_cost_nanos),
      })),
      runs: runs.map((run) => ({
        run_id: run.run_id ?? "no-run",
        status: run.run_status ?? "no-run",
        source: run.run_source ?? "unknown",
        started_at: run.started_at,
        ended_at: run.ended_at,
        event_count: run.event_count,
        token_count: run.token_count,
        estimated_total: nanosToDecimal(run.estimated_cost_nanos),
        first_activity_at: run.first_activity_at,
        last_activity_at: run.last_activity_at,
      })),
      provider_breakdown: providerBreakdown.map(toDashboardBreakdown),
      pricing_breakdown: pricingBreakdown.map(toDashboardBreakdown),
      accuracy_breakdown: accuracyBreakdown.map(toDashboardBreakdown),
    };
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
        source: message.source.system,
        started_at: message.payload.usage.started_at ?? message.occurred_at,
        external_ref_json: runRef.external_ref ?? null,
        now: this.clock.now(),
      });
    }
    return null;
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

function toDashboardRecent(event: DashboardRecentUsageRow): DashboardData["recent"][number] {
  return {
    id: event.id,
    occurred_at: event.occurred_at,
    task_key: event.task_key ?? "unassigned",
    task_name: event.task_name ?? "Unassigned",
    provider_model: `${event.provider}/${event.model}`,
    usage_kind: event.usage_kind,
    tokens: event.token_count,
    cost: nanosToDecimal(event.estimated_cost_nanos ?? event.observed_cost_nanos),
    currency: event.estimated_currency ?? event.observed_currency,
    confidence: event.pricing_mode ?? event.accuracy_mode,
    assignment_status: event.assignment_status,
    duration_ms: event.duration_ms ?? null,
    prompt: event.prompt_text,
  };
}

function toDashboardBreakdown(row: DashboardBreakdownRow): DashboardData["pricing_breakdown"][number] {
  return {
    key: row.key,
    event_count: row.event_count,
    estimated_total: nanosToDecimal(row.estimated_cost_nanos),
  };
}

function emptyTaskInsight(task: TaskRecord): DashboardData["task_insights"][number] {
  return {
    task_key: task.key,
    task_name: task.name,
    status: task.status,
    event_count: 0,
    token_count: 0,
    estimated_total: 0,
    unpriced_count: 0,
    run_count: 0,
    first_activity_at: null,
    last_activity_at: null,
    latest_prompt: null,
    signals: [task.status],
    insight: "No usage has been recorded for this task yet.",
  };
}

function buildTaskInsights(
  rows: DashboardTaskInsightRow[],
  options: { maxCostNanos?: number } = {},
): DashboardData["task_insights"] {
  const maxCostNanos =
    options.maxCostNanos ?? Math.max(...rows.map((row) => row.estimated_cost_nanos), 0);
  return rows.map((row) => {
    const isUnassigned = row.task_id == null || row.task_key == null;
    return {
      task_key: row.task_key ?? "unassigned",
      task_name: row.task_name ?? "Unassigned",
      status: row.task_status ?? (isUnassigned ? "unassigned" : "unknown"),
      event_count: row.event_count,
      token_count: row.token_count,
      estimated_total: nanosToDecimal(row.estimated_cost_nanos),
      unpriced_count: row.unpriced_count,
      run_count: row.run_count,
      first_activity_at: row.first_activity_at,
      last_activity_at: row.last_activity_at,
      latest_prompt: row.latest_prompt,
      signals: taskSignals(row, maxCostNanos, isUnassigned),
      insight: taskInsight(row, maxCostNanos, isUnassigned),
    };
  });
}

function taskSignals(
  row: DashboardTaskInsightRow,
  maxCostNanos: number,
  isUnassigned: boolean,
): string[] {
  const signals: string[] = [];
  if (isUnassigned) signals.push("inbox");
  if (row.unpriced_count > 0) signals.push("pricing gap");
  if (row.event_count >= 6) signals.push("many turns");
  if (row.run_count <= 1 && row.event_count >= 4) signals.push("single run");
  if (row.estimated_cost_nanos === maxCostNanos && maxCostNanos > 0) signals.push("top cost");
  if (row.task_status === "active" || row.task_status === "open") signals.push(row.task_status);
  if (signals.length === 0) signals.push("normal");
  return signals;
}

function taskInsight(
  row: DashboardTaskInsightRow,
  maxCostNanos: number,
  isUnassigned: boolean,
): string {
  if (isUnassigned) return "Usage is still in the assignment inbox, so task-level spend is incomplete.";
  if (row.unpriced_count > 0) return "Some usage cannot be priced yet, so this task's cost is partial.";
  if (row.event_count >= 6 && row.run_count <= 1) {
    return "Many turns are concentrated in one run; check whether the task is drifting.";
  }
  if (row.estimated_cost_nanos === maxCostNanos && maxCostNanos > 0) {
    return "Largest cost driver in this workspace.";
  }
  if (row.run_count === 0) return "Usage is attached to the task but not grouped into runs.";
  return "No immediate task signal.";
}

function buildAttention(
  summary: DashboardSummaryRow,
  taskInsights: DashboardData["task_insights"],
): DashboardData["attention"] {
  const items: DashboardData["attention"] = [];
  if (summary.unassigned_count > 0) {
    items.push({
      severity: "warn",
      title: "Assignment inbox",
      body: "Unassigned usage is blocking task-level insight.",
      metric: `${summary.unassigned_count} event${summary.unassigned_count === 1 ? "" : "s"}`,
      task_key: null,
    });
  }
  if (summary.unpriced_count > 0) {
    items.push({
      severity: "bad",
      title: "Pricing gap",
      body: "Cost totals are incomplete until these events are priced.",
      metric: `${summary.unpriced_count} event${summary.unpriced_count === 1 ? "" : "s"}`,
      task_key: null,
    });
  }

  const highTurnTask = taskInsights.find((task) => task.event_count >= 6);
  if (highTurnTask) {
    items.push({
      severity: "warn",
      title: "Task drift check",
      body: `${taskDisplayName(highTurnTask)} has a high turn count.`,
      metric: `${highTurnTask.event_count} turns`,
      task_key: highTurnTask.task_key,
    });
  }

  const topCostTask = taskInsights.find((task) => task.estimated_total > 0);
  if (topCostTask) {
    items.push({
      severity: "info",
      title: "Top cost driver",
      body: `${taskDisplayName(topCostTask)} is the largest visible spend source.`,
      metric: `$${topCostTask.estimated_total.toFixed(6)}`,
      task_key: topCostTask.task_key,
    });
  }

  if (items.length === 0) {
    items.push({
      severity: "info",
      title: "No immediate gaps",
      body: "Assignment and pricing signals are clear for the current data.",
      metric: `${summary.event_count} events`,
      task_key: null,
    });
  }
  return items.slice(0, 4);
}

function taskDisplayName(task: { task_key: string; task_name: string }): string {
  return task.task_name && task.task_name !== "Unassigned" ? task.task_name : task.task_key;
}

function quantityForRule(unitType: string, usage: AiUsageObserved["payload"]["usage"]): number | null {
  if (unitType === "input_token") return usage.input_tokens ?? null;
  if (unitType === "output_token") return usage.output_tokens ?? null;
  if (unitType === "cached_input_token") return usage.cached_input_tokens ?? null;
  if (unitType === "cache_write_input_token") return usage.cache_write_input_tokens ?? null;
  if (unitType === "reasoning_output_token") return usage.reasoning_output_tokens ?? null;
  if (unitType === "audio_input_token") return usage.audio_input_tokens ?? null;
  if (unitType === "audio_output_token") return usage.audio_output_tokens ?? null;
  if (unitType === "total_token") return usage.total_tokens ?? null;
  if (unitType === "request") return usage.request_count ?? null;
  if (unitType === "second") return usage.seconds ?? null;
  if (unitType === "image") return usage.image_count ?? null;
  if (usage.unit_type === unitType) return usage.unit_count ?? null;
  return null;
}

function usagePricingMatches(
  event: UsageEventRecord,
  pricing: {
    estimated_cost_nanos: number | null;
    estimated_currency: string | null;
    pricing_mode: "rule_calculated" | "manual" | "unpriced";
    unpriced_reason: string | null;
    pricing_rule_ids_json?: string[] | null;
    pricing_source_snapshot_ids_json?: string[] | null;
  },
): boolean {
  return (
    event.estimated_cost_nanos === pricing.estimated_cost_nanos &&
    event.estimated_currency === pricing.estimated_currency &&
    event.pricing_mode === pricing.pricing_mode &&
    event.unpriced_reason === pricing.unpriced_reason &&
    JSON.stringify(event.pricing_rule_ids_json ?? null) ===
      JSON.stringify(pricing.pricing_rule_ids_json ?? null) &&
    JSON.stringify(event.pricing_source_snapshot_ids_json ?? null) ===
      JSON.stringify(pricing.pricing_source_snapshot_ids_json ?? null)
  );
}

function normalizeAccessScopes(scopes: string[]): string[] {
  const normalized = [
    ...new Set(
      scopes
        .flatMap((scope) => scope.split(","))
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
  if (normalized.length === 0) throw new Error("Access key must include at least one scope.");
  for (const scope of normalized) {
    if (scope !== "*" && !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(scope)) {
      throw new Error(`Invalid access key scope: ${scope}`);
    }
  }
  return normalized;
}

function hasRequiredAccessScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  if (grantedScopes.includes("*")) return true;
  return requiredScopes.every((scope) => grantedScopes.includes(scope));
}

function normalizeAccessWorkspaceKeys(workspaceKeys: string[] | null): string[] | null {
  if (!workspaceKeys) return null;
  const normalized = [
    ...new Set(
      workspaceKeys
        .flatMap((key) => key.split(","))
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  return normalized.length > 0 ? normalized : null;
}

function hasWorkspaceAccess(workspaceKeys: string[] | null, requestedWorkspaceKey: string): boolean {
  return !workspaceKeys || workspaceKeys.length === 0 || workspaceKeys.includes(requestedWorkspaceKey);
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
