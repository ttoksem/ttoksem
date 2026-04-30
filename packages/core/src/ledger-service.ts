import { readFileSync } from "node:fs";
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
import { summarizeClaudeAssistantContent } from "@ttoksem/providers";
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
    run_id: string;
    provider_model: string;
    usage_kind: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
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
    span_duration_ms: number | null;
    event_duration_ms: number | null;
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

export interface InboxTaskSuggestion {
  task_key: string;
  task_name: string;
  confidence: number;
  level: "high" | "medium" | "low";
  reason: string;
}

export interface InboxGroup {
  group_id: string;
  assignment_status: "unassigned" | "suggested";
  event_count: number;
  run_count: number;
  token_count: number;
  estimated_total: number;
  currency: string | null;
  first_occurred_at: string;
  last_occurred_at: string;
  source_context: {
    date_bucket: string;
    tool: string | null;
    cwd: string | null;
    git_branch: string | null;
    command: string | null;
    conversation_id: string | null;
    request_id: string | null;
    external_ref: string | null;
  };
  reason_codes: string[];
  sample_event_ids: string[];
  prompt_samples: string[];
  suggested_task: InboxTaskSuggestion | null;
}

export interface InboxAssignmentResult {
  group: InboxGroup;
  task: {
    key: string;
    name: string;
  };
  assigned_count: number;
  skipped_count: number;
  assigned_event_ids: string[];
  skipped_event_ids: string[];
}

/** Single tool invocation summary surfaced to the dashboard run trace. */
export interface RunActionToolCall {
  name: string;
  /** Single-line, ~160 chars, for the compact card row. */
  summary: string;
  /** Multi-line full input rendering for the expanded card view. */
  detail: string;
}

/**
 * One assistant turn within a run, summarized for display. Each item maps to
 * one usage event; `tool_calls` and `text_excerpt` are derived either from the
 * stored payload (new imports) or by re-reading the originating session JSONL
 * (older imports that pre-date payload enrichment).
 */
export interface RunAction {
  event_id: string;
  occurred_at: string;
  message_id: string | null;
  text_excerpt: string | null;
  thinking_excerpt: string | null;
  tool_calls: RunActionToolCall[];
  has_thinking: boolean;
  /** Where this summary came from — useful for diagnostics. */
  source: "payload" | "jsonl" | "missing";
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

  async getTaskStats(input: {
    workspace: WorkspaceResolver;
    key: string;
  }): Promise<{
    key: string;
    status: string;
    run_count: number;
    event_count: number;
    estimated_cost_nanos: number;
    unpriced_count: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
  }> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.key);
    if (!task) throw new Error(`Task not found: ${input.key}`);
    const row = await this.store.getDashboardTaskInsight(workspace.id, task.id);
    return {
      key: task.key,
      status: task.status,
      run_count: row?.run_count ?? 0,
      event_count: row?.event_count ?? 0,
      estimated_cost_nanos: row?.estimated_cost_nanos ?? 0,
      unpriced_count: row?.unpriced_count ?? 0,
      first_activity_at: row?.first_activity_at ?? null,
      last_activity_at: row?.last_activity_at ?? null,
    };
  }

  async getLastImportedAt(input: {
    workspace: WorkspaceResolver;
    source: string;
  }): Promise<string | null> {
    const workspace = await this.resolveWorkspace(input.workspace);
    return this.store.getLastImportedAt(workspace.id, input.source);
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
    const durationMs = usage.duration_ms ?? inferDurationMs(usage.started_at, usage.ended_at);
    const event = await this.store.createUsageEvent({
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
      duration_ms: durationMs,
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
    if (run) {
      await this.store.updateRunTiming({
        workspaceId: workspace.id,
        runId: run.id,
        startedAt: runStartAt(parsed),
        endedAt: runEndAt(parsed, durationMs),
        now: this.clock.now(),
      });
    }
    return event;
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

  async listInboxGroups(input: { workspace: WorkspaceResolver; limit?: number }): Promise<InboxGroup[]> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const events = await this.listInboxEvents(workspace.id, Math.max((input.limit ?? 20) * 20, 100));
    const tasks = await this.store.listTasks(workspace.id);
    return buildInboxGroups(workspace.id, events, tasks).slice(0, input.limit ?? 20);
  }

  /**
   * Reconstruct what the assistant did during a run.
   *
   * Two data paths:
   *   1. Newer events: the importer stored `assistant_summary` directly inside
   *      `source_context` — read it straight back out (zero I/O).
   *   2. Older events: only `session.file` and `message_id` are stored. We
   *      re-read the originating JSONL on demand and summarize.
   *
   * The JSONL fallback caches each file by path within a single call so a run
   * with N events from one file only reads/parses it once.
   */
  /**
   * Resolve which task a run belongs to. Used by the dashboard so a deep-link
   * to /runs/:runId can fetch the owning task before rendering RunDetail.
   * Returns null when the run id is unknown to the workspace or when no event
   * for that run carries a task_id.
   */
  async runMeta(input: { workspace: WorkspaceResolver; runId: string }): Promise<{ run_id: string; task_key: string; task_name: string } | null> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const events = await this.store.listUsageEventsByRun(workspace.id, input.runId);
    const withTask = events.find((e) => e.task_id);
    if (!withTask?.task_id) return null;
    const task = await this.store.getTaskById(withTask.task_id);
    if (!task) return null;
    return { run_id: input.runId, task_key: task.key, task_name: task.name };
  }

  async runActions(input: { workspace: WorkspaceResolver; runId: string }): Promise<RunAction[]> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const events = await this.store.listUsageEventsByRun(workspace.id, input.runId);
    if (events.length === 0) return [];
    const fileSummaryCache = new Map<string, Map<string, RunActionSummary>>();
    const result: RunAction[] = [];
    for (const event of events) {
      const sourceContext = readSourceContext(event.payload_json);
      const messageId = stringOrNull(sourceContext?.message_id);
      // Fast path: importer already stored the summary on this event.
      const inlineSummary = readInlineAssistantSummary(sourceContext);
      if (inlineSummary) {
        result.push(buildRunAction(event, messageId, inlineSummary, "payload"));
        continue;
      }
      // Fallback: re-read the JSONL the event came from.
      const sessionFile = stringOrNull(readSessionFile(sourceContext));
      if (!sessionFile || !messageId) {
        result.push(buildRunAction(event, messageId, emptySummary(), "missing"));
        continue;
      }
      let messageMap = fileSummaryCache.get(sessionFile);
      if (!messageMap) {
        messageMap = readClaudeSessionSummaries(sessionFile);
        fileSummaryCache.set(sessionFile, messageMap);
      }
      const summary = messageMap.get(messageId);
      result.push(buildRunAction(event, messageId, summary ?? emptySummary(), summary ? "jsonl" : "missing"));
    }
    return result;
  }

  async showInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    limit?: number;
  }): Promise<{ group: InboxGroup; events: UsageEventRecord[] }> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const { group, events } = await this.resolveInboxGroup(workspace.id, input.groupId);
    return {
      group,
      events: events.slice(0, input.limit ?? 50),
    };
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

  async assignInboxEvent(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    return this.moveUsage(input);
  }

  async assignInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    taskKey: string;
    all?: boolean;
  }): Promise<InboxAssignmentResult> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const task = await this.store.getTaskByKey(workspace.id, input.taskKey);
    if (!task) throw new Error(`Task not found: ${input.taskKey}`);

    const { group, events } = await this.resolveInboxGroup(workspace.id, input.groupId);
    if (!input.all && events.length > 1) {
      throw new Error(
        `Inbox group ${input.groupId} has ${events.length} events. Re-run with --all for bulk assignment, or use inbox assign-event <usage_id>.`,
      );
    }

    const assignedEventIds: string[] = [];
    const skippedEventIds: string[] = [];
    for (const event of events) {
      if (event.assignment_status !== "unassigned" && event.assignment_status !== "suggested") {
        skippedEventIds.push(event.id);
        continue;
      }
      const moved = await this.store.moveUsageEventToTask(workspace.id, event.id, task.id);
      assignedEventIds.push(moved.id);
    }

    return {
      group,
      task: { key: task.key, name: task.name },
      assigned_count: assignedEventIds.length,
      skipped_count: skippedEventIds.length,
      assigned_event_ids: assignedEventIds,
      skipped_event_ids: skippedEventIds,
    };
  }

  async acceptInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    all?: boolean;
  }): Promise<InboxAssignmentResult> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const { group } = await this.resolveInboxGroup(workspace.id, input.groupId);
    if (!group.suggested_task) throw new Error(`Inbox group ${input.groupId} has no suggested task.`);
    return this.assignInboxGroup({
      workspace: { id: workspace.id },
      groupId: input.groupId,
      taskKey: group.suggested_task.task_key,
      all: input.all,
    });
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
        span_duration_ms: run.span_duration_ms ?? null,
        event_duration_ms: run.event_duration_ms ?? null,
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

  private async listInboxEvents(workspaceId: string, limit: number): Promise<UsageEventRecord[]> {
    const [unassigned, suggested] = await Promise.all([
      this.store.listUsageEventsByAssignment(workspaceId, "unassigned", limit),
      this.store.listUsageEventsByAssignment(workspaceId, "suggested", limit),
    ]);
    const eventsById = new Map<string, UsageEventRecord>();
    for (const event of [...unassigned, ...suggested]) eventsById.set(event.id, event);
    return [...eventsById.values()]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, limit);
  }

  private async resolveInboxGroup(
    workspaceId: string,
    groupId: string,
  ): Promise<{ group: InboxGroup; events: UsageEventRecord[] }> {
    const events = await this.listInboxEvents(workspaceId, 5000);
    const tasks = await this.store.listTasks(workspaceId);
    const groups = buildInboxGroups(workspaceId, events, tasks);
    const group = groups.find((item) => item.group_id === groupId);
    if (!group) throw new Error(`Inbox group not found: ${groupId}`);
    const groupEvents = events.filter(
      (event) => inboxGroupId(workspaceId, event, group.suggested_task) === groupId,
    );
    return { group, events: groupEvents };
  }
}

function buildInboxGroups(
  workspaceId: string,
  events: UsageEventRecord[],
  tasks: TaskRecord[],
): InboxGroup[] {
  const groupEvents = new Map<string, UsageEventRecord[]>();
  const groupSuggestions = new Map<string, InboxTaskSuggestion | null>();

  // Precompute per-task match metadata once. Without this, every event would
  // recompute lowercase/normalize/split across all 50+ tasks — that turned
  // a 1k-event scan into a 4-second wall.
  const taskMatchData = precomputeTaskMatchData(tasks);

  for (const event of events) {
    if (event.assignment_status !== "unassigned" && event.assignment_status !== "suggested") continue;
    const suggestion = suggestTaskForEvent(event, taskMatchData);
    const groupId = inboxGroupId(workspaceId, event, suggestion);
    const existing = groupEvents.get(groupId) ?? [];
    existing.push(event);
    groupEvents.set(groupId, existing);
    groupSuggestions.set(groupId, suggestion);
  }

  return [...groupEvents.entries()]
    .map(([groupId, rows]) => inboxGroupFromEvents(groupId, rows, groupSuggestions.get(groupId) ?? null))
    .sort((a, b) => {
      const costDelta = b.estimated_total - a.estimated_total;
      if (Math.abs(costDelta) > 0.000000001) return costDelta;
      if (b.event_count !== a.event_count) return b.event_count - a.event_count;
      return b.last_occurred_at.localeCompare(a.last_occurred_at);
    });
}

function inboxGroupFromEvents(
  groupId: string,
  events: UsageEventRecord[],
  suggestedTask: InboxTaskSuggestion | null,
): InboxGroup {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) throw new Error("Inbox group cannot be empty.");
  const currencies = new Set(
    sorted
      .flatMap((event) => [event.estimated_currency, event.observed_currency])
      .filter((value): value is string => Boolean(value)),
  );
  const runIds = new Set(sorted.map((event) => event.run_id).filter(Boolean));
  const sourceContext = inboxSourceContext(first);
  const promptSamples = uniqueNonEmpty(sorted.map((event) => extractPromptText(event.payload_json))).slice(0, 3);
  return {
    group_id: groupId,
    assignment_status: first.assignment_status === "suggested" ? "suggested" : "unassigned",
    event_count: sorted.length,
    run_count: runIds.size,
    token_count: sorted.reduce((sum, event) => sum + eventTokenCount(event), 0),
    estimated_total: nanosToDecimal(
      sorted.reduce(
        (sum, event) => sum + (event.estimated_cost_nanos ?? event.observed_cost_nanos ?? 0),
        0,
      ),
    ),
    currency: currencies.size === 1 ? [...currencies][0] : null,
    first_occurred_at: first.occurred_at,
    last_occurred_at: last.occurred_at,
    source_context: sourceContext,
    reason_codes: inboxReasonCodes(sourceContext),
    sample_event_ids: sorted.slice(0, 5).map((event) => event.id),
    prompt_samples: promptSamples,
    suggested_task: suggestedTask,
  };
}

function inboxGroupId(
  workspaceId: string,
  event: UsageEventRecord,
  suggestedTask: InboxTaskSuggestion | null,
): string {
  const sourceContext = inboxSourceContext(event);
  return `inbox_${hashString(
    [
      workspaceId,
      event.assignment_status,
      suggestedTask?.task_key ?? "",
      sourceContext.date_bucket,
      sourceContext.tool ?? "",
      sourceContext.cwd ?? "",
      sourceContext.git_branch ?? "",
      sourceContext.command ?? "",
      sourceContext.conversation_id ?? "",
      sourceContext.request_id ?? "",
      sourceContext.external_ref ?? "",
      event.source,
      event.provider,
      event.model,
      event.usage_kind,
    ].join("|"),
  )}`;
}

function inboxSourceContext(event: UsageEventRecord): InboxGroup["source_context"] {
  const payload = isRecord(event.payload_json.payload) ? event.payload_json.payload : null;
  const context = isRecord(payload?.source_context) ? payload.source_context : null;
  const session = isRecord(context?.session) ? context.session : null;
  const promptGroup = isRecord(context?.prompt_group) ? context.prompt_group : null;
  const git = isRecord(context?.git) ? context.git : null;
  return {
    date_bucket: event.occurred_at.slice(0, 10),
    tool: stringField(context?.tool) ?? event.source,
    cwd: stringField(context?.cwd) ?? stringField(session?.cwd),
    git_branch: stringField(context?.git_branch) ?? stringField(git?.branch),
    command: stringField(context?.command),
    conversation_id:
      stringField(context?.conversation_id) ??
      stringField(context?.conversationId) ??
      stringField(session?.id),
    request_id:
      stringField(context?.request_id) ??
      stringField(context?.requestId) ??
      stringField(promptGroup?.prompt_hash) ??
      numberField(promptGroup?.index)?.toString() ??
      null,
    external_ref: externalRefKey(context?.external_ref),
  };
}

function inboxReasonCodes(context: InboxGroup["source_context"]): string[] {
  const reasons: string[] = [];
  if (context.tool) reasons.push("same_tool");
  if (context.cwd) reasons.push("same_cwd");
  if (context.git_branch) reasons.push("same_git_branch");
  if (context.command) reasons.push("same_command");
  if (context.conversation_id) reasons.push("same_conversation");
  if (context.request_id) reasons.push("same_request");
  if (context.external_ref) reasons.push("same_external_ref");
  reasons.push("same_day");
  return reasons;
}

interface TaskMatchData {
  task: TaskRecord;
  normalizedKey: string;   // normalizeMatchText(task.key) — done once per task
  normalizedName: string;  // normalizeMatchText(task.name)
  tokens: string[];        // task.key split into substantive tokens for fuzzy match
}

function precomputeTaskMatchData(tasks: TaskRecord[]): TaskMatchData[] {
  return tasks.map((task) => {
    const tokens = task.key
      .split(/[^a-z0-9]+/i)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 4 && !TASK_MATCH_STOP_WORDS.has(token));
    return {
      task,
      normalizedKey: normalizeMatchText(task.key),
      normalizedName: normalizeMatchText(task.name),
      tokens,
    };
  });
}

function suggestTaskForEvent(event: UsageEventRecord, taskMatchData: TaskMatchData[]): InboxTaskSuggestion | null {
  const text = inboxSuggestionText([event]);
  if (!text) return null;
  const normalizedText = normalizeMatchText(text);
  if (!normalizedText) return null;
  const explicitKey = explicitSuggestedTaskKey([event]);
  let best: InboxTaskSuggestion | null = null;
  for (const td of taskMatchData) {
    const suggestion = explicitKey === td.task.key
      ? taskSuggestion(td.task, 0.95, "source_context suggested task")
      : taskTextMatchPrecomputed(td, normalizedText);
    if (!suggestion) continue;
    if (!best || suggestion.confidence > best.confidence) best = suggestion;
  }
  return best;
}

function taskTextMatchPrecomputed(td: TaskMatchData, normalizedText: string): InboxTaskSuggestion | null {
  if (td.normalizedKey && normalizedText.includes(td.normalizedKey)) {
    return taskSuggestion(td.task, 0.86, "task key appears in context");
  }
  if (td.normalizedName && normalizedText.includes(td.normalizedName)) {
    return taskSuggestion(td.task, 0.84, "task name appears in context");
  }
  if (td.tokens.length === 0) return null;
  const hits = td.tokens.filter((token) => normalizedText.includes(token));
  if (hits.length >= 2 && hits.length / td.tokens.length >= 0.5) {
    return taskSuggestion(td.task, 0.72, `context matched task words: ${hits.slice(0, 3).join(",")}`);
  }
  if (hits.length === 1 && hits[0] && hits[0].length >= 8) {
    return taskSuggestion(td.task, 0.62, `context matched task word: ${hits[0]}`);
  }
  return null;
}

function explicitSuggestedTaskKey(events: UsageEventRecord[]): string | null {
  for (const event of events) {
    const payload = isRecord(event.payload_json.payload) ? event.payload_json.payload : null;
    const context = isRecord(payload?.source_context) ? payload.source_context : null;
    const key =
      stringField(context?.suggested_task_key) ??
      stringField(context?.suggestedTaskKey) ??
      stringField(context?.task_key);
    if (key) return key;
  }
  return null;
}

function inboxSuggestionText(events: UsageEventRecord[]): string {
  return events
    .flatMap((event) => {
      const context = inboxSourceContext(event);
      return [
        extractPromptText(event.payload_json),
        context.cwd,
        context.git_branch,
        context.command,
        context.conversation_id,
        context.request_id,
        context.external_ref,
      ];
    })
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function taskSuggestion(task: TaskRecord, confidence: number, reason: string): InboxTaskSuggestion {
  return {
    task_key: task.key,
    task_name: task.name,
    confidence,
    level: confidence >= 0.85 ? "high" : confidence >= 0.6 ? "medium" : "low",
    reason,
  };
}

function extractPromptText(payloadJson: Record<string, unknown>): string | null {
  const payload = isRecord(payloadJson.payload) ? payloadJson.payload : null;
  const promptSnapshot = isRecord(payload?.prompt_snapshot) ? payload.prompt_snapshot : null;
  const promptText = stringField(promptSnapshot?.prompt_text);
  if (promptText) return promptText;
  const context = isRecord(payload?.source_context) ? payload.source_context : null;
  return stringField(context?.user_message);
}

function eventTokenCount(event: UsageEventRecord): number {
  return event.total_tokens ?? (event.input_tokens ?? 0) + (event.output_tokens ?? 0);
}

function externalRefKey(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (!isRecord(value)) return null;
  const system = stringField(value.system);
  const id = stringField(value.id);
  if (system && id) return `${system}:${id}`;
  return id ?? system;
}

function uniqueNonEmpty(values: Array<string | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TASK_MATCH_STOP_WORDS = new Set([
  "add",
  "build",
  "check",
  "cleanup",
  "codex",
  "dashboard",
  "define",
  "document",
  "event",
  "events",
  "fix",
  "implement",
  "improve",
  "local",
  "logging",
  "report",
  "session",
  "task",
  "test",
  "tests",
  "update",
  "usage",
]);

function toDashboardRecent(event: DashboardRecentUsageRow): DashboardData["recent"][number] {
  return {
    id: event.id,
    occurred_at: event.occurred_at,
    task_key: event.task_key ?? "unassigned",
    task_name: event.task_name ?? "Unassigned",
    run_id: event.run_id ?? "no-run",
    provider_model: `${event.provider}/${event.model}`,
    usage_kind: event.usage_kind,
    input_tokens: event.input_tokens ?? 0,
    output_tokens: event.output_tokens ?? 0,
    total_tokens: event.total_tokens ?? event.token_count,
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

function runStartAt(message: AiUsageObserved): string {
  return message.payload.usage.started_at ?? message.occurred_at;
}

function runEndAt(message: AiUsageObserved, durationMs: number | null): string {
  const usage = message.payload.usage;
  if (usage.ended_at) return usage.ended_at;
  if (usage.started_at && durationMs != null) {
    return addMsToIso(usage.started_at, durationMs) ?? message.occurred_at;
  }
  return message.occurred_at;
}

function addMsToIso(value: string, durationMs: number): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time + durationMs).toISOString();
}

function defaultIdFactory(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.replaceAll("-", "").slice(0, 24)}`;
}

// ── Run actions (assistant summary reconstruction) ─────────────────────────

interface RunActionSummary {
  text_excerpt: string | null;
  thinking_excerpt: string | null;
  tool_calls: RunActionToolCall[];
  has_thinking: boolean;
}

function emptySummary(): RunActionSummary {
  return { text_excerpt: null, thinking_excerpt: null, tool_calls: [], has_thinking: false };
}

function buildRunAction(
  event: UsageEventRecord,
  messageId: string | null,
  summary: RunActionSummary,
  source: RunAction["source"],
): RunAction {
  return {
    event_id: event.id,
    occurred_at: event.occurred_at,
    message_id: messageId,
    text_excerpt: summary.text_excerpt,
    thinking_excerpt: summary.thinking_excerpt,
    tool_calls: summary.tool_calls,
    has_thinking: summary.has_thinking,
    source,
  };
}

function readSourceContext(payload: Record<string, unknown>): Record<string, unknown> | null {
  const inner = isRecord(payload.payload) ? payload.payload : null;
  return inner && isRecord(inner.source_context) ? inner.source_context : null;
}

function readInlineAssistantSummary(
  sourceContext: Record<string, unknown> | null,
): RunActionSummary | null {
  if (!sourceContext) return null;
  const raw = sourceContext.assistant_summary;
  if (!isRecord(raw)) return null;
  const tools = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
  const tool_calls: RunActionToolCall[] = [];
  for (const tc of tools) {
    if (!isRecord(tc)) continue;
    const name = stringField(tc.name) ?? "tool";
    const summary = stringField(tc.summary) ?? "";
    const detail = stringField(tc.detail) ?? "";
    tool_calls.push({ name, summary, detail });
  }
  return {
    text_excerpt: stringField(raw.text_excerpt),
    thinking_excerpt: stringField(raw.thinking_excerpt),
    tool_calls,
    has_thinking: Boolean(raw.has_thinking),
  };
}

function readSessionFile(sourceContext: Record<string, unknown> | null): string | null {
  if (!sourceContext) return null;
  const session = isRecord(sourceContext.session) ? sourceContext.session : null;
  return stringField(session?.file);
}

/**
 * Read a Claude session JSONL once and build a `message_id → summary` map so
 * subsequent lookups for the same file are O(1). Errors (missing file, malformed
 * line) are tolerated — the caller falls back to an empty summary.
 */
function readClaudeSessionSummaries(filePath: string): Map<string, RunActionSummary> {
  const out = new Map<string, RunActionSummary>();
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(item)) continue;
    if (item.type !== "assistant") continue;
    const message = isRecord(item.message) ? item.message : null;
    const messageId = stringField(message?.id);
    if (!messageId) continue;
    const summary = summarizeClaudeAssistantContent(message?.content);
    out.set(messageId, {
      text_excerpt: summary.text_excerpt,
      thinking_excerpt: summary.thinking_excerpt,
      tool_calls: summary.tool_calls.map((tc) => ({ name: tc.name, summary: tc.summary, detail: tc.detail })),
      has_thinking: summary.has_thinking,
    });
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
