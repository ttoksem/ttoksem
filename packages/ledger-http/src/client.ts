import type { Ledger, RunAction, InboxGroup, InboxAssignmentResult } from "@ttoksem/core";
import type { WorkspaceResolver } from "@ttoksem/core";
import type { TaskRecord, WorkspaceRecord, AiUsageObserved, UsageEventRecord } from "@ttoksem/schema";
import { HttpLedgerError } from "./errors.js";

export interface HttpLedgerClientOptions {
  baseUrl: string;
  token?: string;
  defaultWorkspaceKey?: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpLedgerClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly defaultWorkspaceKey: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpLedgerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.defaultWorkspaceKey = options.defaultWorkspaceKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  protected async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new HttpLedgerError(`Network error: ${cause instanceof Error ? cause.message : String(cause)}`, 0);
    }

    if (response.status === 204) return undefined;

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new HttpLedgerError(`Server returned non-JSON response: ${text.slice(0, 100)}`, response.status);
        }
      }
    }

    if (!response.ok) {
      const body = (parsed && typeof parsed === "object") ? (parsed as { error?: string; detail?: string }) : undefined;
      throw new HttpLedgerError(`HTTP ${response.status}`, response.status, body);
    }

    return parsed;
  }

  protected resolveWorkspaceKey(resolver: WorkspaceResolver | undefined): string {
    if (resolver && "key" in resolver && typeof resolver.key === "string") return resolver.key;
    if (this.defaultWorkspaceKey) return this.defaultWorkspaceKey;
    if (resolver && "rootPath" in resolver) {
      throw new HttpLedgerError(
        "rootPath workspace resolver is not supported in remote mode; resolve to a workspace key first",
        0,
      );
    }
    throw new HttpLedgerError("No workspace key provided and no defaultWorkspaceKey configured", 0);
  }

  // Workspaces
  async createWorkspace(input: {
    key: string;
    name?: string;
    rootPath?: string | null;
  }): Promise<WorkspaceRecord> {
    const result = await this.request("POST", "/api/workspaces", {
      key: input.key,
      name: input.name,
      root_path: input.rootPath ?? undefined,
    });
    return (result as { workspace: WorkspaceRecord }).workspace;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const result = await this.request("GET", "/api/workspaces");
    return (result as { workspaces: WorkspaceRecord[] }).workspaces;
  }

  // Tasks
  async startTask(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request("POST", `/api/tasks?workspace=${encodeURIComponent(wk)}`, {
      key: input.key,
      name: input.name,
      description: input.description,
    });
    return (result as { task: TaskRecord }).task;
  }

  async archiveTask(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    key: string;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(input.key)}/archive?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { task: TaskRecord }).task;
  }

  /** @deprecated Use archiveTask. Kept as alias until two minor releases pass. */
  async closeTask(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    key: string;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(input.key)}/close?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { task: TaskRecord }).task;
  }

  async listTasks(input: { workspace: import("@ttoksem/core").WorkspaceResolver }): Promise<TaskRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request("GET", `/api/tasks?workspace=${encodeURIComponent(wk)}`);
    return (result as { tasks: TaskRecord[] }).tasks;
  }

  async updateTask(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    key: string;
    name?: string;
    description?: string | null;
  }): Promise<TaskRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "PATCH",
      `/api/tasks/${encodeURIComponent(input.key)}?workspace=${encodeURIComponent(wk)}`,
      { name: input.name, description: input.description },
    );
    return (result as { task: TaskRecord }).task;
  }

  async getTaskStats(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
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
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/tasks/${encodeURIComponent(input.key)}/stats?workspace=${encodeURIComponent(wk)}`,
    );
    return result as Awaited<ReturnType<HttpLedgerClient["getTaskStats"]>>;
  }

  // Runs
  async runActions(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    runId: string;
  }): Promise<RunAction[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/runs/${encodeURIComponent(input.runId)}/actions?workspace=${encodeURIComponent(wk)}`,
    );
    return (result as { actions: RunAction[] }).actions;
  }

  async runMeta(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    runId: string;
  }): Promise<{ run_id: string; task_key: string; task_name: string } | null> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "GET",
      `/api/runs/${encodeURIComponent(input.runId)}/meta?workspace=${encodeURIComponent(wk)}`,
    );
    return result as { run_id: string; task_key: string; task_name: string } | null;
  }

  // Usage
  async recordUsage(message: AiUsageObserved): Promise<UsageEventRecord> {
    const result = await this.request("POST", "/api/usage/events", message);
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async listUnpricedUsage(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/usage/unpriced?${params.toString()}`);
    return (result as { events: UsageEventRecord[] }).events;
  }

  async moveUsage(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/usage/events/${encodeURIComponent(input.usageEventId)}/move?workspace=${encodeURIComponent(wk)}`,
      { task_key: input.taskKey },
    );
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async getLastImportedAt(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    source: string;
  }): Promise<string | null> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk, source: input.source });
    const result = await this.request("GET", `/api/usage/last-import?${params.toString()}`);
    return (result as { occurred_at: string | null }).occurred_at;
  }

  // Inbox
  async listInbox(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    limit?: number;
  }): Promise<UsageEventRecord[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/inbox?${params.toString()}`);
    return (result as { events: UsageEventRecord[] }).events;
  }

  async listInboxGroups(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    limit?: number;
  }): Promise<InboxGroup[]> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request("GET", `/api/inbox/groups?${params.toString()}`);
    return (result as { groups: InboxGroup[] }).groups;
  }

  async showInboxGroup(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    groupId: string;
    limit?: number;
  }): Promise<{ group: InboxGroup; events: UsageEventRecord[] }> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const params = new URLSearchParams({ workspace: wk });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const result = await this.request(
      "GET",
      `/api/inbox/groups/${encodeURIComponent(input.groupId)}?${params.toString()}`,
    );
    return result as { group: InboxGroup; events: UsageEventRecord[] };
  }

  async assignInboxEvent(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    usageEventId: string;
    taskKey: string;
  }): Promise<UsageEventRecord> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/events/${encodeURIComponent(input.usageEventId)}/assign?workspace=${encodeURIComponent(wk)}`,
      { task_key: input.taskKey },
    );
    return (result as { usage_event: UsageEventRecord }).usage_event;
  }

  async assignInboxGroup(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    groupId: string;
    taskKey: string;
    all?: boolean;
    createIfMissing?: boolean;
  }): Promise<InboxAssignmentResult> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/${encodeURIComponent(input.groupId)}/assign?workspace=${encodeURIComponent(wk)}`,
      {
        task_key: input.taskKey,
        all: input.all,
        create_if_missing: input.createIfMissing,
      },
    );
    return result as InboxAssignmentResult;
  }

  async acceptInboxGroup(input: {
    workspace: import("@ttoksem/core").WorkspaceResolver;
    groupId: string;
    all?: boolean;
  }): Promise<InboxAssignmentResult> {
    const wk = this.resolveWorkspaceKey(input.workspace);
    const result = await this.request(
      "POST",
      `/api/inbox/${encodeURIComponent(input.groupId)}/accept?workspace=${encodeURIComponent(wk)}`,
      { all: input.all },
    );
    return result as InboxAssignmentResult;
  }
}

// Type shim — HttpLedgerClient does not yet implement Ledger (methods land in
// Tasks 2-5). The shim variable assignment will fail at compile time once any
// method is referenced through this typing path, alerting us if Task 5 forgets
// to swap to `class HttpLedgerClient implements Ledger`.
// We deliberately do NOT add `implements Ledger` to the class declaration yet;
// that lands in Task 5 once all 28 methods exist.
