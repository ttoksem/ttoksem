import type {
  AccessKeyRecord,
  AiUsageObserved,
  DailyReport,
  PricingRuleRecord,
  PricingSourceSnapshotRecord,
  TaskRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  AccessKeyVerificationResult,
  DashboardData,
  DashboardTaskDetailData,
  InboxAssignmentResult,
  InboxGroup,
  PricingMigrationResult,
  PricingRuleUpsertInput,
  PricingSourceSnapshotUpsertInput,
  RepriceResult,
  RunAction,
  WorkspaceResolver,
} from "./ledger-service.js";

/**
 * Business-operation interface that the local LedgerService and (in Plan 3)
 * the HttpLedgerClient both implement. Higher-level than LedgerStore.
 *
 * Mirrors the existing public surface of LedgerService so the two
 * implementations are interchangeable. Methods explicitly excluded:
 *   - setActiveTask / getActiveTask: not currently on LedgerService; the
 *     workspace-level "active task" pointer is being removed in favor of
 *     a shell-scoped TTOKSEM_TASK env var (Plan 1, Task 5).
 */
export interface Ledger {
  // Lifecycle
  init(): Promise<void>;

  // Workspaces
  createWorkspace(input: {
    key: string;
    name?: string;
    rootPath?: string | null;
  }): Promise<WorkspaceRecord>;
  resolveWorkspace(resolver: WorkspaceResolver): Promise<WorkspaceRecord>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  currentWorkspace(rootPath: string): Promise<WorkspaceRecord>;

  // Access keys
  createAccessKey(input: {
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    workspaceKeys?: string[] | null;
    expiresAt?: string | null;
  }): Promise<AccessKeyRecord>;
  listAccessKeys(): Promise<AccessKeyRecord[]>;
  revokeAccessKey(input: { id: string }): Promise<AccessKeyRecord>;
  countActiveAccessKeys(): Promise<number>;
  verifyAccessKey(input: {
    workspaceKey: string;
    tokenHash: string;
    requiredScopes: string[];
  }): Promise<AccessKeyVerificationResult>;

  // Tasks
  startTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord>;
  /** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
  closeTask(input: { workspace: WorkspaceResolver; key?: string }): Promise<TaskRecord>;
  archiveTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
  listTasks(input: { workspace: WorkspaceResolver }): Promise<TaskRecord[]>;
  updateTask(input: {
    workspace: WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord>;
  getTaskStats(input: {
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
  }>;

  // Imports / runs
  getLastImportedAt(input: {
    workspace: WorkspaceResolver;
    source: string;
  }): Promise<string | null>;
  runMeta(input: {
    workspace: WorkspaceResolver;
    runId: string;
  }): Promise<{ run_id: string; task_key: string; task_name: string } | null>;
  runActions(input: { workspace: WorkspaceResolver; runId: string }): Promise<RunAction[]>;

  // Pricing
  upsertPricingRule(input: PricingRuleUpsertInput): Promise<PricingRuleRecord>;
  upsertPricingSourceSnapshot(
    input: PricingSourceSnapshotUpsertInput,
  ): Promise<PricingSourceSnapshotRecord>;
  listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]>;
  getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null>;
  listPricingRules(input: { workspace: WorkspaceResolver }): Promise<PricingRuleRecord[]>;

  // Usage
  recordUsage(message: AiUsageObserved): Promise<UsageEventRecord>;
  listUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]>;
  repriceUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<RepriceResult>;
  migrateUsageEventPricing(input: {
    workspace: WorkspaceResolver;
    limit?: number;
    mode?: "unpriced" | "repriceable";
  }): Promise<PricingMigrationResult>;

  // Inbox
  listInbox(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]>;
  listInboxGroups(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<InboxGroup[]>;
  showInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    limit?: number;
  }): Promise<{ group: InboxGroup; events: UsageEventRecord[] }>;
  moveUsage(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord>;
  assignInboxEvent(input: {
    workspace: WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord>;
  assignInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    taskKey: string;
    all?: boolean;
    createIfMissing?: boolean;
  }): Promise<InboxAssignmentResult>;
  acceptInboxGroup(input: {
    workspace: WorkspaceResolver;
    groupId: string;
    all?: boolean;
  }): Promise<InboxAssignmentResult>;

  // Reports / dashboard
  reportToday(input: { workspace: WorkspaceResolver; date?: string }): Promise<DailyReport>;
  reportTask(input: { workspace: WorkspaceResolver; taskKey: string }): Promise<DailyReport>;
  dashboard(input: {
    workspace: WorkspaceResolver;
    taskLimit?: number;
    recentLimit?: number;
    dayLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardData>;
  dashboardTask(input: {
    workspace: WorkspaceResolver;
    taskKey: string;
    recentLimit?: number;
    dayLimit?: number;
    runLimit?: number;
    timeZoneOffsetMinutes?: number;
  }): Promise<DashboardTaskDetailData>;
}
