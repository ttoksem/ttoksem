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
 * Remote-safe business operations. HttpLedgerClient (Plan 4) implements
 * exactly this interface. Anything in here is callable over HTTP.
 *
 * `verifyAccessKey` lives here because the HTTP server uses it internally
 * during request authorization — it is remote-safe in concept even though
 * no public route exposes it.
 *
 * Active task is no longer a workspace-level concept; tasks must be
 * addressed by key, with shell-scoped TTOKSEM_TASK env var driving caller
 * defaults (shipped in Plan 3).
 */
export interface Ledger {
  // Workspaces
  createWorkspace(input: {
    key: string;
    name?: string;
    rootPath?: string | null;
  }): Promise<WorkspaceRecord>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;

  // Auth (server-internal — used by HTTP middleware, no public route)
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
  closeTask(input: { workspace: WorkspaceResolver; key: string }): Promise<TaskRecord>;
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

  // Pricing reads
  listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]>;
  getPricingSourceSnapshot(id: string): Promise<PricingSourceSnapshotRecord | null>;
  listPricingRules(input: { workspace: WorkspaceResolver }): Promise<PricingRuleRecord[]>;

  // Usage
  recordUsage(message: AiUsageObserved): Promise<UsageEventRecord>;
  listUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]>;

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

/**
 * Privileged operations layered on top of `Ledger`: access-key management,
 * pricing-policy writes, and pricing-data maintenance.
 *
 * Intentionally NOT exposed over HTTP. The `Ledger` interface above is what
 * `HttpLedgerClient` (Plan 4) implements; admin operations are reachable
 * only via the local CLI, which runs in-process with `LedgerService`.
 *
 * If a future plan ever exposes admin operations over HTTP, the right move
 * is a new `api:admin` scope plus dedicated routes — not pushing methods
 * down into `Ledger`.
 */
export interface AdminLedger extends Ledger {
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

  // Pricing writes
  upsertPricingRule(input: PricingRuleUpsertInput): Promise<PricingRuleRecord>;
  upsertPricingSourceSnapshot(
    input: PricingSourceSnapshotUpsertInput,
  ): Promise<PricingSourceSnapshotRecord>;

  // Pricing-data maintenance
  repriceUnpricedUsage(input: {
    workspace: WorkspaceResolver;
    limit?: number;
  }): Promise<RepriceResult>;
  migrateUsageEventPricing(input: {
    workspace: WorkspaceResolver;
    limit?: number;
    mode?: "unpriced" | "repriceable";
  }): Promise<PricingMigrationResult>;
}

/**
 * Filesystem- or local-store-bound operations. These have no honest HTTP
 * semantics — `init` initializes a local SQLite DB, `currentWorkspace`
 * maps a client cwd to a workspace, `resolveWorkspace` is an internal
 * helper used to translate user-facing identifiers into a record.
 *
 * Only `LedgerService` (running in the local CLI process) implements this.
 * `HttpLedgerClient` does not.
 */
export interface LocalLedger extends AdminLedger {
  init(): Promise<void>;
  currentWorkspace(rootPath: string): Promise<WorkspaceRecord>;
  resolveWorkspace(resolver: WorkspaceResolver): Promise<WorkspaceRecord>;
}
