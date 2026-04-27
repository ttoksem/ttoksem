import type {
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
  session_id: string;
  source: string;
  started_at?: string | null;
  external_ref_json?: Record<string, unknown> | null;
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
  getRunBySessionId(workspaceId: string, sessionId: string): Promise<RunRecord | null>;

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
  reportUsageByDay(workspaceId: string, date: string): Promise<LedgerReportRow[]>;
  reportUsageByTask(workspaceId: string, taskId: string): Promise<LedgerReportRow[]>;
}
