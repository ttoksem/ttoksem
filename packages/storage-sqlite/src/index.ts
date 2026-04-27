import Database from "better-sqlite3";
import {
  TaskRecordSchema,
  UsageEventRecordSchema,
  WorkspaceRecordSchema,
  type TaskRecord,
  type UsageEventRecord,
  type WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  CreateTaskInput,
  CreateUsageEventInput,
  CreateWorkspaceInput,
  LedgerReportRow,
  LedgerStore,
} from "@ttoksem/storage";

export class SqliteLedgerStore implements LedgerStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async migrate(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        root_path TEXT,
        active_task_id TEXT,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS workspaces_active_root_path_idx
        ON workspaces(root_path)
        WHERE root_path IS NOT NULL AND status = 'active';

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT,
        status TEXT NOT NULL,
        definition_mode TEXT NOT NULL,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        labels_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        closed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, key)
      );

      CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx ON tasks(workspace_id, status);
      CREATE INDEX IF NOT EXISTS tasks_workspace_created_idx ON tasks(workspace_id, created_at);

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT REFERENCES tasks(id),
        run_id TEXT,
        message_id TEXT NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT,
        occurred_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        usage_kind TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        observed_cost_nanos INTEGER,
        estimated_cost_nanos INTEGER,
        currency TEXT,
        accuracy_mode TEXT NOT NULL,
        pricing_mode TEXT,
        unpriced_reason TEXT,
        assignment_status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS usage_events_idempotency_idx
        ON usage_events(workspace_id, source, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS usage_events_workspace_occurred_idx
        ON usage_events(workspace_id, occurred_at);
      CREATE INDEX IF NOT EXISTS usage_events_workspace_task_occurred_idx
        ON usage_events(workspace_id, task_id, occurred_at);
      CREATE INDEX IF NOT EXISTS usage_events_workspace_provider_model_idx
        ON usage_events(workspace_id, provider, model, occurred_at);
      CREATE INDEX IF NOT EXISTS usage_events_workspace_assignment_idx
        ON usage_events(workspace_id, assignment_status, occurred_at);
    `);

    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0001_initial", new Date().toISOString());
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    this.db
      .prepare(
        `INSERT INTO workspaces (
          id, key, name, description, status, root_path, active_task_id, source,
          external_ref_json, metadata_json, created_at, archived_at, updated_at
        ) VALUES (
          @id, @key, @name, NULL, 'active', @root_path, NULL, @source,
          NULL, NULL, @now, NULL, @now
        )`,
      )
      .run(input);
    const workspace = await this.getWorkspaceById(input.id);
    if (!workspace) throw new Error("Failed to create workspace.");
    return workspace;
  }

  async getWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    return parseWorkspace(this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id));
  }

  async getWorkspaceByKey(key: string): Promise<WorkspaceRecord | null> {
    return parseWorkspace(this.db.prepare("SELECT * FROM workspaces WHERE key = ?").get(key));
  }

  async getWorkspaceByRootPath(rootPath: string): Promise<WorkspaceRecord | null> {
    return parseWorkspace(this.db.prepare("SELECT * FROM workspaces WHERE root_path = ?").get(rootPath));
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.db
      .prepare("SELECT * FROM workspaces ORDER BY created_at ASC")
      .all()
      .map((row) => WorkspaceRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, workspace_id, key, name, description, type, status, definition_mode, source,
          external_ref_json, labels_json, metadata_json, created_at, started_at, closed_at, updated_at
        ) VALUES (
          @id, @workspace_id, @key, @name, NULL, NULL, 'open', 'explicit', @source,
          NULL, NULL, NULL, @now, NULL, NULL, @now
        )`,
      )
      .run(input);
    const task = await this.getTaskById(input.id);
    if (!task) throw new Error("Failed to create task.");
    return task;
  }

  async getTaskById(id: string): Promise<TaskRecord | null> {
    return parseTask(this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
  }

  async getTaskByKey(workspaceId: string, key: string): Promise<TaskRecord | null> {
    return parseTask(
      this.db.prepare("SELECT * FROM tasks WHERE workspace_id = ? AND key = ?").get(workspaceId, key),
    );
  }

  async listTasks(workspaceId: string): Promise<TaskRecord[]> {
    return this.db
      .prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at ASC")
      .all(workspaceId)
      .map((row) => TaskRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async startTask(taskId: string, now: string): Promise<TaskRecord> {
    this.db
      .prepare(
        `UPDATE tasks
         SET status = 'active', started_at = COALESCE(started_at, @now), closed_at = NULL, updated_at = @now
         WHERE id = @taskId`,
      )
      .run({ taskId, now });
    const task = await this.getTaskById(taskId);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  async closeTask(taskId: string, now: string): Promise<TaskRecord> {
    this.db
      .prepare(
        "UPDATE tasks SET status = 'closed', closed_at = @now, updated_at = @now WHERE id = @taskId",
      )
      .run({ taskId, now });
    const task = await this.getTaskById(taskId);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  async setActiveTask(
    workspaceId: string,
    taskId: string | null,
    now: string,
  ): Promise<WorkspaceRecord> {
    this.db
      .prepare("UPDATE workspaces SET active_task_id = @taskId, updated_at = @now WHERE id = @workspaceId")
      .run({ workspaceId, taskId, now });
    const workspace = await this.getWorkspaceById(workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    return workspace;
  }

  async createUsageEvent(input: CreateUsageEventInput): Promise<UsageEventRecord> {
    this.db
      .prepare(
        `INSERT INTO usage_events (
          id, workspace_id, task_id, run_id, message_id, source, idempotency_key, occurred_at,
          provider, model, usage_kind, input_tokens, output_tokens, total_tokens,
          observed_cost_nanos, estimated_cost_nanos, currency, accuracy_mode, pricing_mode,
          unpriced_reason, assignment_status, payload_json, created_at
        ) VALUES (
          @id, @workspace_id, @task_id, @run_id, @message_id, @source, @idempotency_key, @occurred_at,
          @provider, @model, @usage_kind, @input_tokens, @output_tokens, @total_tokens,
          @observed_cost_nanos, @estimated_cost_nanos, @currency, @accuracy_mode, @pricing_mode,
          @unpriced_reason, @assignment_status, @payload_json, @now
        )`,
      )
      .run({ ...input, payload_json: JSON.stringify(input.payload_json) });
    const event = this.db.prepare("SELECT * FROM usage_events WHERE id = ?").get(input.id);
    return UsageEventRecordSchema.parse(fromDbJson(event as DbRow));
  }

  async getUsageEventByIdempotency(
    workspaceId: string,
    source: string,
    idempotencyKey: string,
  ): Promise<UsageEventRecord | null> {
    const row = this.db
      .prepare(
        "SELECT * FROM usage_events WHERE workspace_id = ? AND source = ? AND idempotency_key = ?",
      )
      .get(workspaceId, source, idempotencyKey);
    if (!row) return null;
    return UsageEventRecordSchema.parse(fromDbJson(row as DbRow));
  }

  async reportUsageByDay(workspaceId: string, date: string): Promise<LedgerReportRow[]> {
    return this.db
      .prepare(
        `SELECT estimated_cost_nanos, observed_cost_nanos, currency, pricing_mode
         FROM usage_events
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?`,
      )
      .all(workspaceId, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as LedgerReportRow[];
  }

  async reportUsageByTask(workspaceId: string, taskId: string): Promise<LedgerReportRow[]> {
    return this.db
      .prepare(
        `SELECT estimated_cost_nanos, observed_cost_nanos, currency, pricing_mode
         FROM usage_events
         WHERE workspace_id = ? AND task_id = ?`,
      )
      .all(workspaceId, taskId) as LedgerReportRow[];
  }
}

type DbRow = Record<string, unknown>;

function parseWorkspace(row: unknown): WorkspaceRecord | null {
  if (!row) return null;
  return WorkspaceRecordSchema.parse(fromDbJson(row as DbRow));
}

function parseTask(row: unknown): TaskRecord | null {
  if (!row) return null;
  return TaskRecordSchema.parse(fromDbJson(row as DbRow));
}

function fromDbJson(row: DbRow): DbRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key.endsWith("_json") && typeof value === "string") {
        return [key, JSON.parse(value) as unknown];
      }
      return [key, value];
    }),
  );
}

