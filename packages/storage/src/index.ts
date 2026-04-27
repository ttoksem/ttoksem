import type {
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
  source: string;
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
  pricing_mode: "rule_calculated" | "unpriced";
  unpriced_reason: string | null;
  pricing_rule_ids_json?: string[] | null;
  pricing_source_snapshot_ids_json?: string[] | null;
  cost_calculated_at?: string | null;
}

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
  getTaskById(id: string): Promise<TaskRecord | null>;
  getTaskByKey(workspaceId: string, key: string): Promise<TaskRecord | null>;
  listTasks(workspaceId: string): Promise<TaskRecord[]>;
  startTask(taskId: string, now: string): Promise<TaskRecord>;
  closeTask(taskId: string, now: string): Promise<TaskRecord>;
  setActiveTask(workspaceId: string, taskId: string | null, now: string): Promise<WorkspaceRecord>;

  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRunById(id: string): Promise<RunRecord | null>;

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
  updateUsageEventPricing(
    workspaceId: string,
    usageEventId: string,
    input: UsagePricingUpdateInput,
  ): Promise<UsageEventRecord>;
  reportUsageByDay(workspaceId: string, date: string): Promise<LedgerReportRow[]>;
  reportUsageByTask(workspaceId: string, taskId: string): Promise<LedgerReportRow[]>;
}
