import {
  AiUsageObservedSchema,
  type AiUsageObserved,
  type DailyReport,
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
    const usage = parsed.payload.usage;
    return this.store.createUsageEvent({
      id: this.idFactory("usage"),
      workspace_id: workspace.id,
      task_id: task?.id ?? null,
      run_id: null,
      message_id: parsed.message_id,
      source,
      idempotency_key: parsed.idempotency_key ?? null,
      occurred_at: parsed.occurred_at,
      provider: usage.provider,
      model: usage.model,
      usage_kind: usage.usage_kind,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      observed_cost_nanos: decimalToNanos(usage.observed_cost),
      estimated_cost_nanos: decimalToNanos(usage.estimated_cost),
      observed_currency: usage.observed_currency ?? null,
      estimated_currency: usage.estimated_currency ?? null,
      accuracy_mode: usage.accuracy_mode,
      pricing_mode: usage.pricing_mode ?? inferPricingMode(usage.observed_cost, usage.estimated_cost),
      unpriced_reason: usage.unpriced_reason ?? null,
      assignment_status: task ? "assigned" : "unassigned",
      payload_json: parsed,
      now: this.clock.now(),
    });
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

function defaultIdFactory(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.replaceAll("-", "").slice(0, 24)}`;
}
