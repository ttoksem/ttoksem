import type {
  AccessKeyRecord,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
  RunRecord,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";

export interface CreateWorkspaceInput {
  id: string;
  key: string;
  name: string;
  root_path?: string | null;
  source: string;
  now: string;
}

export interface CreateTaskInput {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description?: string | null;
  source: string;
  now: string;
}

export interface UpdateTaskDetailsInput {
  taskId: string;
  name?: string;
  description?: string | null;
  now: string;
}

export interface CreateRunInput {
  id: string;
  workspace_id: string;
  task_id?: string | null;
  source: string;
  started_at?: string | null;
  external_ref_json?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  now: string;
}

export interface UpdateRunTimingInput {
  workspaceId: string;
  runId: string;
  startedAt?: string | null;
  endedAt?: string | null;
  now: string;
}

export interface CreateAccessKeyInput {
  id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes_json: string[];
  workspace_keys_json?: string[] | null;
  expires_at?: string | null;
  now: string;
}

export interface UpsertPricingRuleInput {
  id: string;
  workspace_id: string;
  source_snapshot_id?: string | null;
  provider: string;
  model: string;
  usage_kind: string;
  unit_type: string;
  price_nanos_per_unit: number;
  currency: string;
  effective_from: string;
  source: string;
  metadata_json?: Record<string, unknown> | null;
  now: string;
}

export interface UpsertPricingSourceSnapshotInput {
  id: string;
  source_name: "litellm" | "manual" | "import" | "openrouter";
  source_url?: string | null;
  source_version?: string | null;
  source_commit?: string | null;
  source_retrieved_at?: string | null;
  bundled_at?: string | null;
  valid_from?: string | null;
  raw_sha256: string;
  raw_storage_ref?: string | null;
  metadata_json?: Record<string, unknown> | null;
  now: string;
}

export interface CreateUsageEventInput {
  id: string;
  workspace_id: string;
  task_id?: string | null;
  run_id?: string | null;
  message_id: string;
  source: string;
  idempotency_key?: string | null;
  occurred_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  provider: string;
  model: string;
  usage_kind: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  observed_cost_nanos?: number | null;
  estimated_cost_nanos?: number | null;
  observed_currency?: string | null;
  estimated_currency?: string | null;
  accuracy_mode: "exact" | "estimated" | "manual";
  pricing_mode?: "provider_reported" | "rule_calculated" | "manual" | "unpriced" | null;
  unpriced_reason?: string | null;
  pricing_rule_ids_json?: string[] | null;
  pricing_source_snapshot_ids_json?: string[] | null;
  cost_calculated_at?: string | null;
  assignment_status: "unassigned" | "suggested" | "assigned" | "dismissed";
  payload_json: Record<string, unknown>;
  now: string;
}

export interface LedgerReportRow {
  estimated_cost_nanos: number | null;
  observed_cost_nanos: number | null;
  observed_currency: string | null;
  estimated_currency: string | null;
  pricing_mode: string | null;
}

export interface DashboardSummaryRow {
  event_count: number;
  estimated_cost_nanos: number;
  observed_cost_nanos: number;
  unpriced_count: number;
  unassigned_count: number;
  assigned_count: number;
  task_count: number;
  run_count: number;
  currency: string | null;
}

export interface DashboardTaskCostRow {
  task_id: string | null;
  task_key: string | null;
  task_name: string | null;
  event_count: number;
  token_count: number;
  estimated_cost_nanos: number;
  unpriced_count: number;
}

export interface DashboardTaskInsightRow {
  task_id: string | null;
  task_key: string | null;
  task_name: string | null;
  task_status: string | null;
  event_count: number;
  run_count: number;
  token_count: number;
  estimated_cost_nanos: number;
  unpriced_count: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
  latest_prompt: string | null;
}

export interface DashboardBreakdownRow {
  key: string;
  event_count: number;
  estimated_cost_nanos: number;
}

export interface DashboardRecentUsageRow {
  id: string;
  occurred_at: string;
  task_key: string | null;
  task_name: string | null;
  run_id: string | null;
  provider: string;
  model: string;
  usage_kind: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  token_count: number;
  estimated_cost_nanos: number | null;
  observed_cost_nanos: number | null;
  estimated_currency: string | null;
  observed_currency: string | null;
  pricing_mode: string | null;
  accuracy_mode: string;
  assignment_status: string;
  duration_ms: number | null;
  prompt_text: string | null;
}

export interface DashboardDailyCostRow {
  date: string;
  event_count: number;
  estimated_cost_nanos: number;
}

export interface DashboardTaskRunRow {
  run_id: string | null;
  run_status: string | null;
  run_source: string | null;
  started_at: string | null;
  ended_at: string | null;
  span_duration_ms: number | null;
  event_duration_ms: number | null;
  event_count: number;
  token_count: number;
  estimated_cost_nanos: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
}

export interface PricingRuleLookupInput {
  workspaceId: string;
  provider: string;
  model: string;
  usageKind: string;
  occurredAt: string;
}

export interface UsagePricingUpdateInput {
  estimated_cost_nanos: number | null;
  estimated_currency: string | null;
  pricing_mode: "rule_calculated" | "manual" | "unpriced";
  unpriced_reason: string | null;
  pricing_rule_ids_json?: string[] | null;
  pricing_source_snapshot_ids_json?: string[] | null;
  cost_calculated_at?: string | null;
}

export type UsagePricingMigrationMode = "unpriced" | "repriceable";

export type UsageAssignmentStatus = "unassigned" | "suggested" | "assigned" | "dismissed";

export interface LedgerStore {
  migrate(): Promise<void>;
  close(): Promise<void>;

  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  getWorkspaceById(id: string): Promise<WorkspaceRecord | null>;
  getWorkspaceByKey(key: string): Promise<WorkspaceRecord | null>;
  getWorkspaceByRootPath(rootPath: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;

  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTaskDetails(input: UpdateTaskDetailsInput): Promise<TaskRecord>;
  getTaskById(id: string): Promise<TaskRecord | null>;
  getTaskByKey(workspaceId: string, key: string): Promise<TaskRecord | null>;
  listTasks(workspaceId: string): Promise<TaskRecord[]>;
  startTask(taskId: string, now: string): Promise<TaskRecord>;
  closeTask(taskId: string, now: string): Promise<TaskRecord>;
  setActiveTask(workspaceId: string, taskId: string | null, now: string): Promise<WorkspaceRecord>;

  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRunById(id: string): Promise<RunRecord | null>;
  updateRunTiming(input: UpdateRunTimingInput): Promise<RunRecord>;

  createAccessKey(input: CreateAccessKeyInput): Promise<AccessKeyRecord>;
  listAccessKeys(): Promise<AccessKeyRecord[]>;
  getAccessKeyById(id: string): Promise<AccessKeyRecord | null>;
  getAccessKeyByTokenHash(tokenHash: string): Promise<AccessKeyRecord | null>;
  revokeAccessKey(id: string, now: string): Promise<AccessKeyRecord>;
  touchAccessKey(id: string, now: string): Promise<void>;
  countActiveAccessKeys(now: string): Promise<number>;

  upsertPricingSourceSnapshot(
    input: UpsertPricingSourceSnapshotInput,
  ): Promise<PricingSourceSnapshotRecord>;
  listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]>;
  getPricingSourceSnapshotById(id: string): Promise<PricingSourceSnapshotRecord | null>;

  upsertPricingRule(input: UpsertPricingRuleInput): Promise<PricingRuleRecord>;
  listPricingRules(workspaceId: string): Promise<PricingRuleRecord[]>;
  listPricingRulesForUsage(input: PricingRuleLookupInput): Promise<PricingRuleRecord[]>;

  createUsageEvent(input: CreateUsageEventInput): Promise<UsageEventRecord>;
  getUsageEventByIdempotency(
    workspaceId: string,
    source: string,
    idempotencyKey: string,
  ): Promise<UsageEventRecord | null>;
  listUsageEventsByAssignment(
    workspaceId: string,
    assignmentStatus: UsageAssignmentStatus,
    limit: number,
  ): Promise<UsageEventRecord[]>;
  moveUsageEventToTask(
    workspaceId: string,
    usageEventId: string,
    taskId: string,
  ): Promise<UsageEventRecord>;
  listUnpricedUsageEvents(workspaceId: string, limit: number): Promise<UsageEventRecord[]>;
  listUsageEventsForPricingMigration(
    workspaceId: string,
    limit: number,
    mode: UsagePricingMigrationMode,
  ): Promise<UsageEventRecord[]>;
  updateUsageEventPricing(
    workspaceId: string,
    usageEventId: string,
    input: UsagePricingUpdateInput,
  ): Promise<UsageEventRecord>;
  reportUsageByDay(workspaceId: string, date: string): Promise<LedgerReportRow[]>;
  reportUsageByTask(workspaceId: string, taskId: string): Promise<LedgerReportRow[]>;
  getDashboardSummary(workspaceId: string): Promise<DashboardSummaryRow>;
  listDashboardTaskCosts(workspaceId: string, limit: number): Promise<DashboardTaskCostRow[]>;
  getDashboardTaskInsight(workspaceId: string, taskId: string): Promise<DashboardTaskInsightRow | null>;
  listDashboardTaskInsights(workspaceId: string, limit: number): Promise<DashboardTaskInsightRow[]>;
  listRecentUsageEvents(workspaceId: string, limit: number): Promise<DashboardRecentUsageRow[]>;
  listRecentUsageEventsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
  ): Promise<DashboardRecentUsageRow[]>;
  listDashboardPricingModeBreakdown(workspaceId: string): Promise<DashboardBreakdownRow[]>;
  listDashboardPricingModeBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]>;
  listDashboardAccuracyModeBreakdown(workspaceId: string): Promise<DashboardBreakdownRow[]>;
  listDashboardAccuracyModeBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]>;
  listDashboardProviderModelBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]>;
  listDashboardDailyCosts(
    workspaceId: string,
    limit: number,
    timeZoneOffsetMinutes?: number,
  ): Promise<DashboardDailyCostRow[]>;
  listDashboardDailyCostsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
    timeZoneOffsetMinutes?: number,
  ): Promise<DashboardDailyCostRow[]>;
  listDashboardRunsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
  ): Promise<DashboardTaskRunRow[]>;
  getLastImportedAt(workspaceId: string, source: string): Promise<string | null>;
}
