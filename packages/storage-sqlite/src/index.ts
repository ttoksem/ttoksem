import Database from "better-sqlite3";
import {
  AccessKeyRecordSchema,
  PricingRuleRecordSchema,
  PricingSourceSnapshotRecordSchema,
  RunRecordSchema,
  TaskRecordSchema,
  UsageEventRecordSchema,
  WorkspaceRecordSchema,
  type AccessKeyRecord,
  type PricingRuleRecord,
  type PricingSourceSnapshotRecord,
  type RunRecord,
  type TaskRecord,
  type UsageEventRecord,
  type WorkspaceRecord,
} from "@ttoksem/schema";
import type {
  CreateRunInput,
  CreateAccessKeyInput,
  CreateTaskInput,
  CreateUsageEventInput,
  CreateWorkspaceInput,
  DashboardBreakdownRow,
  DashboardDailyCostRow,
  DashboardRecentUsageRow,
  DashboardSummaryRow,
  DashboardTaskCostRow,
  DashboardTaskInsightRow,
  DashboardTaskRunRow,
  LedgerReportRow,
  LedgerStore,
  PricingRuleLookupInput,
  UpsertPricingSourceSnapshotInput,
  UpsertPricingRuleInput,
  UsageAssignmentStatus,
  UsagePricingMigrationMode,
  UsagePricingUpdateInput,
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

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT REFERENCES tasks(id),
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        external_ref_json TEXT,
        metadata_json TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS runs_workspace_status_idx ON runs(workspace_id, status);
      CREATE INDEX IF NOT EXISTS runs_workspace_task_idx ON runs(workspace_id, task_id);

      CREATE TABLE IF NOT EXISTS access_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        workspace_keys_json TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(token_hash)
      );

      CREATE INDEX IF NOT EXISTS access_keys_created_idx ON access_keys(created_at);
      CREATE INDEX IF NOT EXISTS access_keys_active_idx
        ON access_keys(revoked_at, expires_at);

      CREATE TABLE IF NOT EXISTS pricing_source_snapshots (
        id TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        source_url TEXT,
        source_version TEXT,
        source_commit TEXT,
        source_retrieved_at TEXT,
        bundled_at TEXT,
        valid_from TEXT,
        raw_sha256 TEXT NOT NULL,
        raw_storage_ref TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source_name, source_commit, raw_sha256)
      );

      CREATE TABLE IF NOT EXISTS pricing_rules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        source_snapshot_id TEXT REFERENCES pricing_source_snapshots(id),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        usage_kind TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        price_nanos_per_unit INTEGER NOT NULL,
        currency TEXT NOT NULL,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        source TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS pricing_rules_active_unit_idx
        ON pricing_rules(workspace_id, provider, model, usage_kind, unit_type)
        WHERE effective_to IS NULL;

      CREATE INDEX IF NOT EXISTS pricing_rules_lookup_idx
        ON pricing_rules(workspace_id, provider, model, usage_kind, effective_from);

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT REFERENCES tasks(id),
        run_id TEXT REFERENCES runs(id),
        message_id TEXT NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT,
        occurred_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        duration_ms INTEGER,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        usage_kind TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        observed_cost_nanos INTEGER,
        estimated_cost_nanos INTEGER,
        observed_currency TEXT,
        estimated_currency TEXT,
        accuracy_mode TEXT NOT NULL,
        pricing_mode TEXT,
        unpriced_reason TEXT,
        pricing_rule_ids_json TEXT,
        pricing_source_snapshot_ids_json TEXT,
        cost_calculated_at TEXT,
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
    addColumnIfMissing(this.db, "usage_events", "observed_currency", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "estimated_currency", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "started_at", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "ended_at", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "duration_ms", "INTEGER");
    addColumnIfMissing(this.db, "usage_events", "pricing_rule_ids_json", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "pricing_source_snapshot_ids_json", "TEXT");
    addColumnIfMissing(this.db, "usage_events", "cost_calculated_at", "TEXT");
    addColumnIfMissing(this.db, "pricing_rules", "source_snapshot_id", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS pricing_rules_source_snapshot_idx
        ON pricing_rules(source_snapshot_id);
    `);
    if (hasColumn(this.db, "usage_events", "currency")) {
      this.db
        .prepare(
          `UPDATE usage_events
           SET observed_currency = COALESCE(observed_currency, currency),
               estimated_currency = COALESCE(estimated_currency, currency)
           WHERE currency IS NOT NULL`,
        )
        .run();
    }
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0002_split_usage_event_currency", new Date().toISOString());
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0003_create_runs", new Date().toISOString());
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0004_pricing_rules", new Date().toISOString());
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0005_pricing_source_snapshots", new Date().toISOString());
    this.dropRunSessionIdIfPresent();
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0006_remove_run_session_id", new Date().toISOString());
    this.migrateAccessKeysToDbScopeIfNeeded();
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0007_db_access_keys", new Date().toISOString());
  }

  private dropRunSessionIdIfPresent(): void {
    if (!hasColumn(this.db, "runs", "session_id")) return;
    this.db.pragma("foreign_keys = OFF");
    try {
      this.db.exec(`
        DROP INDEX IF EXISTS runs_workspace_status_idx;
        DROP INDEX IF EXISTS runs_workspace_task_idx;

        CREATE TABLE runs_new (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          task_id TEXT REFERENCES tasks(id),
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          external_ref_json TEXT,
          metadata_json TEXT,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO runs_new (
          id, workspace_id, task_id, status, source,
          external_ref_json, metadata_json, started_at, ended_at, created_at, updated_at
        )
        SELECT
          id, workspace_id, task_id, status, source,
          external_ref_json, metadata_json, started_at, ended_at, created_at, updated_at
        FROM runs;

        DROP TABLE runs;
        ALTER TABLE runs_new RENAME TO runs;

        CREATE INDEX IF NOT EXISTS runs_workspace_status_idx ON runs(workspace_id, status);
        CREATE INDEX IF NOT EXISTS runs_workspace_task_idx ON runs(workspace_id, task_id);
      `);
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
  }

  private migrateAccessKeysToDbScopeIfNeeded(): void {
    const columns = columnNames(this.db, "access_keys");
    if (!columns.includes("workspace_id") && columns.includes("workspace_keys_json")) return;
    const rows = this.db.prepare("SELECT * FROM access_keys").all() as DbRow[];
    const workspaces = new Map(
      (this.db.prepare("SELECT id, key FROM workspaces").all() as Array<{ id: string; key: string }>).map(
        (workspace) => [workspace.id, workspace.key],
      ),
    );
    this.db.pragma("foreign_keys = OFF");
    try {
      this.db.exec(`
        DROP INDEX IF EXISTS access_keys_workspace_idx;
        DROP INDEX IF EXISTS access_keys_workspace_active_idx;
        DROP INDEX IF EXISTS access_keys_created_idx;
        DROP INDEX IF EXISTS access_keys_active_idx;
        ALTER TABLE access_keys RENAME TO access_keys_old;
        CREATE TABLE access_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          scopes_json TEXT NOT NULL,
          workspace_keys_json TEXT,
          expires_at TEXT,
          revoked_at TEXT,
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(token_hash)
        );
        CREATE INDEX IF NOT EXISTS access_keys_created_idx ON access_keys(created_at);
        CREATE INDEX IF NOT EXISTS access_keys_active_idx
          ON access_keys(revoked_at, expires_at);
      `);
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO access_keys (
          id, name, token_prefix, token_hash, scopes_json, workspace_keys_json,
          expires_at, revoked_at, last_used_at, created_at, updated_at
        ) VALUES (
          @id, @name, @token_prefix, @token_hash, @scopes_json, @workspace_keys_json,
          @expires_at, @revoked_at, @last_used_at, @created_at, @updated_at
        )`,
      );
      for (const row of rows) {
        const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : null;
        const workspaceKey = workspaceId ? workspaces.get(workspaceId) : null;
        insert.run({
          id: row.id,
          name: row.name,
          token_prefix: row.token_prefix,
          token_hash: row.token_hash,
          scopes_json: row.scopes_json,
          workspace_keys_json:
            row.workspace_keys_json ??
            (workspaceKey ? JSON.stringify([workspaceKey]) : null),
          expires_at: row.expires_at ?? null,
          revoked_at: row.revoked_at ?? null,
          last_used_at: row.last_used_at ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }
      this.db.exec("DROP TABLE access_keys_old;");
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
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
          @id, @workspace_id, @key, @name, @description, NULL, 'open', 'explicit', @source,
          NULL, NULL, NULL, @now, NULL, NULL, @now
        )`,
      )
      .run({
        ...input,
        description: input.description ?? null,
      });
    const task = await this.getTaskById(input.id);
    if (!task) throw new Error("Failed to create task.");
    return task;
  }

  async updateTaskDetails(input: {
    taskId: string;
    name?: string;
    description?: string | null;
    now: string;
  }): Promise<TaskRecord> {
    const result = this.db
      .prepare(
        `UPDATE tasks
         SET name = COALESCE(@name, name),
             description = CASE
               WHEN @descriptionProvided = 1 THEN @description
               ELSE description
             END,
             updated_at = @now
         WHERE id = @taskId`,
      )
      .run({
        taskId: input.taskId,
        name: input.name ?? null,
        description: input.description ?? null,
        descriptionProvided: Object.hasOwn(input, "description") ? 1 : 0,
        now: input.now,
      });
    if (result.changes === 0) throw new Error("Task not found.");
    const task = await this.getTaskById(input.taskId);
    if (!task) throw new Error("Task not found.");
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

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    this.db
      .prepare(
        `INSERT INTO runs (
          id, workspace_id, task_id, status, source,
          external_ref_json, metadata_json, started_at, ended_at, created_at, updated_at
        ) VALUES (
          @id, @workspace_id, @task_id, 'active', @source,
          @external_ref_json, @metadata_json, @started_at, NULL, @now, @now
        )`,
      )
      .run({
        ...input,
        task_id: input.task_id ?? null,
        external_ref_json: JSON.stringify(input.external_ref_json ?? null),
        metadata_json: JSON.stringify(input.metadata_json ?? null),
        started_at: input.started_at ?? input.now,
      });
    const run = await this.getRunById(input.id);
    if (!run) throw new Error("Failed to create run.");
    return run;
  }

  async getRunById(id: string): Promise<RunRecord | null> {
    return parseRun(this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id));
  }

  async updateRunTiming(input: {
    workspaceId: string;
    runId: string;
    startedAt?: string | null;
    endedAt?: string | null;
    now: string;
  }): Promise<RunRecord> {
    const result = this.db
      .prepare(
        `UPDATE runs
         SET started_at = CASE
               WHEN @startedAt IS NULL THEN started_at
               WHEN started_at IS NULL OR @startedAt < started_at THEN @startedAt
               ELSE started_at
             END,
             ended_at = CASE
               WHEN @endedAt IS NULL THEN ended_at
               WHEN ended_at IS NULL OR @endedAt > ended_at THEN @endedAt
               ELSE ended_at
             END,
             updated_at = @now
         WHERE workspace_id = @workspaceId AND id = @runId`,
      )
      .run({
        workspaceId: input.workspaceId,
        runId: input.runId,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        now: input.now,
      });
    if (result.changes === 0) throw new Error(`Run not found: ${input.runId}`);
    const run = await this.getRunById(input.runId);
    if (!run) throw new Error(`Run not found: ${input.runId}`);
    return run;
  }

  async createAccessKey(input: CreateAccessKeyInput): Promise<AccessKeyRecord> {
    this.db
      .prepare(
        `INSERT INTO access_keys (
          id, name, token_prefix, token_hash, scopes_json, workspace_keys_json,
          expires_at, revoked_at, last_used_at, created_at, updated_at
        ) VALUES (
          @id, @name, @token_prefix, @token_hash, @scopes_json, @workspace_keys_json,
          @expires_at, NULL, NULL, @now, @now
        )`,
      )
      .run({
        ...input,
        scopes_json: JSON.stringify(input.scopes_json),
        workspace_keys_json: JSON.stringify(input.workspace_keys_json ?? null),
        expires_at: input.expires_at ?? null,
      });
    const key = await this.getAccessKeyById(input.id);
    if (!key) throw new Error("Failed to create access key.");
    return key;
  }

  async listAccessKeys(): Promise<AccessKeyRecord[]> {
    return this.db
      .prepare(
        `SELECT *
         FROM access_keys
         ORDER BY created_at ASC`,
      )
      .all()
      .map((row) => AccessKeyRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async getAccessKeyById(id: string): Promise<AccessKeyRecord | null> {
    return parseAccessKey(
      this.db.prepare("SELECT * FROM access_keys WHERE id = ?").get(id),
    );
  }

  async getAccessKeyByTokenHash(tokenHash: string): Promise<AccessKeyRecord | null> {
    return parseAccessKey(
      this.db
        .prepare("SELECT * FROM access_keys WHERE token_hash = ?")
        .get(tokenHash),
    );
  }

  async revokeAccessKey(id: string, now: string): Promise<AccessKeyRecord> {
    const result = this.db
      .prepare(
        `UPDATE access_keys
         SET revoked_at = COALESCE(revoked_at, @now), updated_at = @now
         WHERE id = @id`,
      )
      .run({ id, now });
    if (result.changes === 0) throw new Error(`Access key not found: ${id}`);
    const key = await this.getAccessKeyById(id);
    if (!key) throw new Error(`Access key not found: ${id}`);
    return key;
  }

  async touchAccessKey(id: string, now: string): Promise<void> {
    this.db
      .prepare("UPDATE access_keys SET last_used_at = @now, updated_at = @now WHERE id = @id")
      .run({ id, now });
  }

  async countActiveAccessKeys(now: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM access_keys
         WHERE revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(now) as { count: number };
    return row.count;
  }

  async upsertPricingSourceSnapshot(
    input: UpsertPricingSourceSnapshotInput,
  ): Promise<PricingSourceSnapshotRecord> {
    const normalized = {
      ...input,
      source_url: input.source_url ?? null,
      source_version: input.source_version ?? null,
      source_commit: input.source_commit ?? null,
      source_retrieved_at: input.source_retrieved_at ?? null,
      bundled_at: input.bundled_at ?? null,
      valid_from: input.valid_from ?? null,
      raw_storage_ref: input.raw_storage_ref ?? null,
      metadata_json: JSON.stringify(input.metadata_json ?? null),
    };
    const existing = this.db
      .prepare(
        `SELECT *
         FROM pricing_source_snapshots
         WHERE source_name = @source_name
           AND COALESCE(source_commit, '') = COALESCE(@source_commit, '')
           AND raw_sha256 = @raw_sha256`,
      )
      .get(normalized);
    if (existing) {
      return PricingSourceSnapshotRecordSchema.parse(fromDbJson(existing as DbRow));
    }

    this.db
      .prepare(
        `INSERT INTO pricing_source_snapshots (
          id, source_name, source_url, source_version, source_commit,
          source_retrieved_at, bundled_at, valid_from, raw_sha256,
          raw_storage_ref, metadata_json, created_at
        ) VALUES (
          @id, @source_name, @source_url, @source_version, @source_commit,
          @source_retrieved_at, @bundled_at, @valid_from, @raw_sha256,
          @raw_storage_ref, @metadata_json, @now
        )`,
      )
      .run(normalized);
    const snapshot = await this.getPricingSourceSnapshotById(input.id);
    if (!snapshot) throw new Error("Failed to create pricing source snapshot.");
    return snapshot;
  }

  async listPricingSourceSnapshots(): Promise<PricingSourceSnapshotRecord[]> {
    return this.db
      .prepare("SELECT * FROM pricing_source_snapshots ORDER BY created_at DESC, source_name ASC")
      .all()
      .map((row) => PricingSourceSnapshotRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async getPricingSourceSnapshotById(id: string): Promise<PricingSourceSnapshotRecord | null> {
    const row = this.db.prepare("SELECT * FROM pricing_source_snapshots WHERE id = ?").get(id);
    if (!row) return null;
    return PricingSourceSnapshotRecordSchema.parse(fromDbJson(row as DbRow));
  }

  async upsertPricingRule(input: UpsertPricingRuleInput): Promise<PricingRuleRecord> {
    const existing = this.db
      .prepare(
        `SELECT *
         FROM pricing_rules
         WHERE workspace_id = @workspace_id
           AND provider = @provider
           AND model = @model
           AND usage_kind = @usage_kind
           AND unit_type = @unit_type
           AND effective_to IS NULL`,
      )
      .get(input);
    if (existing) {
      const existingId = (existing as { id: string }).id;
      this.db
        .prepare(
          `UPDATE pricing_rules
           SET price_nanos_per_unit = @price_nanos_per_unit,
               currency = @currency,
               effective_from = @effective_from,
               source_snapshot_id = @source_snapshot_id,
               source = @source,
               metadata_json = @metadata_json,
               updated_at = @now
           WHERE id = @existingId`,
        )
        .run({
          ...input,
          source_snapshot_id: input.source_snapshot_id ?? null,
          existingId,
          metadata_json: JSON.stringify(input.metadata_json ?? null),
        });
      const rule = await this.getPricingRuleById(existingId);
      if (!rule) throw new Error("Failed to update pricing rule.");
      return rule;
    }

    this.db
      .prepare(
        `INSERT INTO pricing_rules (
          id, workspace_id, source_snapshot_id, provider, model, usage_kind, unit_type,
          price_nanos_per_unit, currency, effective_from, effective_to, source,
          metadata_json, created_at, updated_at
        ) VALUES (
          @id, @workspace_id, @source_snapshot_id, @provider, @model, @usage_kind, @unit_type,
          @price_nanos_per_unit, @currency, @effective_from, NULL, @source,
          @metadata_json, @now, @now
        )`,
      )
      .run({
        ...input,
        source_snapshot_id: input.source_snapshot_id ?? null,
        metadata_json: JSON.stringify(input.metadata_json ?? null),
      });
    const rule = await this.getPricingRuleById(input.id);
    if (!rule) throw new Error("Failed to create pricing rule.");
    return rule;
  }

  async listPricingRules(workspaceId: string): Promise<PricingRuleRecord[]> {
    return this.db
      .prepare(
        `SELECT *
         FROM pricing_rules
         WHERE workspace_id = ?
         ORDER BY provider, model, usage_kind, unit_type`,
      )
      .all(workspaceId)
      .map((row) => PricingRuleRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async getPricingRuleById(id: string): Promise<PricingRuleRecord | null> {
    const row = this.db.prepare("SELECT * FROM pricing_rules WHERE id = ?").get(id);
    if (!row) return null;
    return PricingRuleRecordSchema.parse(fromDbJson(row as DbRow));
  }

  async listPricingRulesForUsage(input: PricingRuleLookupInput): Promise<PricingRuleRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM pricing_rules
         WHERE workspace_id = @workspaceId
           AND provider = @provider
           AND model IN (@model, '*')
           AND usage_kind = @usageKind
           AND effective_from <= @occurredAt
           AND (effective_to IS NULL OR effective_to > @occurredAt)
         ORDER BY CASE WHEN model = @model THEN 0 ELSE 1 END, effective_from DESC`,
      )
      .all(input)
      .map((row) => PricingRuleRecordSchema.parse(fromDbJson(row as DbRow)));
    const selected = new Map<string, PricingRuleRecord>();
    for (const row of rows) {
      if (!selected.has(row.unit_type)) selected.set(row.unit_type, row);
    }
    return [...selected.values()];
  }

  async createUsageEvent(input: CreateUsageEventInput): Promise<UsageEventRecord> {
    this.db
      .prepare(
        `INSERT INTO usage_events (
          id, workspace_id, task_id, run_id, message_id, source, idempotency_key, occurred_at,
          started_at, ended_at, duration_ms,
          provider, model, usage_kind, input_tokens, output_tokens, total_tokens,
          observed_cost_nanos, estimated_cost_nanos, observed_currency, estimated_currency,
          accuracy_mode, pricing_mode,
          unpriced_reason, pricing_rule_ids_json, pricing_source_snapshot_ids_json, cost_calculated_at,
          assignment_status, payload_json, created_at
        ) VALUES (
          @id, @workspace_id, @task_id, @run_id, @message_id, @source, @idempotency_key, @occurred_at,
          @started_at, @ended_at, @duration_ms,
          @provider, @model, @usage_kind, @input_tokens, @output_tokens, @total_tokens,
          @observed_cost_nanos, @estimated_cost_nanos, @observed_currency, @estimated_currency,
          @accuracy_mode, @pricing_mode,
          @unpriced_reason, @pricing_rule_ids_json, @pricing_source_snapshot_ids_json, @cost_calculated_at,
          @assignment_status, @payload_json, @now
        )`,
      )
      .run({
        ...input,
        started_at: input.started_at ?? null,
        ended_at: input.ended_at ?? null,
        duration_ms: input.duration_ms ?? null,
        pricing_rule_ids_json: JSON.stringify(input.pricing_rule_ids_json ?? null),
        pricing_source_snapshot_ids_json: JSON.stringify(input.pricing_source_snapshot_ids_json ?? null),
        cost_calculated_at: input.cost_calculated_at ?? null,
        payload_json: JSON.stringify(input.payload_json),
      });
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

  async listUsageEventsByAssignment(
    workspaceId: string,
    assignmentStatus: UsageAssignmentStatus,
    limit: number,
  ): Promise<UsageEventRecord[]> {
    return this.db
      .prepare(
        `SELECT *
         FROM usage_events
         WHERE workspace_id = ? AND assignment_status = ?
         ORDER BY occurred_at DESC
         LIMIT ?`,
      )
      .all(workspaceId, assignmentStatus, limit)
      .map((row) => UsageEventRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async moveUsageEventToTask(
    workspaceId: string,
    usageEventId: string,
    taskId: string,
  ): Promise<UsageEventRecord> {
    const result = this.db
      .prepare(
        `UPDATE usage_events
         SET task_id = @taskId, assignment_status = 'assigned'
         WHERE workspace_id = @workspaceId AND id = @usageEventId`,
      )
      .run({ workspaceId, usageEventId, taskId });
    if (result.changes === 0) throw new Error(`Usage event not found: ${usageEventId}`);
    const row = this.db
      .prepare("SELECT * FROM usage_events WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, usageEventId);
    return UsageEventRecordSchema.parse(fromDbJson(row as DbRow));
  }

  async listUnpricedUsageEvents(workspaceId: string, limit: number): Promise<UsageEventRecord[]> {
    return this.db
      .prepare(
        `SELECT *
         FROM usage_events
         WHERE workspace_id = ? AND pricing_mode = 'unpriced'
         ORDER BY occurred_at ASC
         LIMIT ?`,
      )
      .all(workspaceId, limit)
      .map((row) => UsageEventRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async listUsageEventsForPricingMigration(
    workspaceId: string,
    limit: number,
    mode: UsagePricingMigrationMode,
  ): Promise<UsageEventRecord[]> {
    const pricingModeSql =
      mode === "unpriced"
        ? "pricing_mode = 'unpriced'"
        : "(pricing_mode IS NULL OR pricing_mode IN ('unpriced', 'rule_calculated'))";
    return this.db
      .prepare(
        `SELECT *
         FROM usage_events
         WHERE workspace_id = ?
           AND observed_cost_nanos IS NULL
           AND ${pricingModeSql}
         ORDER BY occurred_at ASC
         LIMIT ?`,
      )
      .all(workspaceId, limit)
      .map((row) => UsageEventRecordSchema.parse(fromDbJson(row as DbRow)));
  }

  async updateUsageEventPricing(
    workspaceId: string,
    usageEventId: string,
    input: UsagePricingUpdateInput,
  ): Promise<UsageEventRecord> {
    const result = this.db
      .prepare(
        `UPDATE usage_events
         SET estimated_cost_nanos = @estimated_cost_nanos,
             estimated_currency = @estimated_currency,
             pricing_mode = @pricing_mode,
             unpriced_reason = @unpriced_reason,
             pricing_rule_ids_json = @pricing_rule_ids_json,
             pricing_source_snapshot_ids_json = @pricing_source_snapshot_ids_json,
             cost_calculated_at = @cost_calculated_at
         WHERE workspace_id = @workspaceId AND id = @usageEventId`,
      )
      .run({
        ...input,
        pricing_rule_ids_json: JSON.stringify(input.pricing_rule_ids_json ?? null),
        pricing_source_snapshot_ids_json: JSON.stringify(input.pricing_source_snapshot_ids_json ?? null),
        cost_calculated_at: input.cost_calculated_at ?? null,
        workspaceId,
        usageEventId,
      });
    if (result.changes === 0) throw new Error(`Usage event not found: ${usageEventId}`);
    const row = this.db
      .prepare("SELECT * FROM usage_events WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, usageEventId);
    return UsageEventRecordSchema.parse(fromDbJson(row as DbRow));
  }

  async reportUsageByDay(workspaceId: string, date: string): Promise<LedgerReportRow[]> {
    return this.db
      .prepare(
        `SELECT estimated_cost_nanos, observed_cost_nanos, observed_currency, estimated_currency, pricing_mode
         FROM usage_events
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?`,
      )
      .all(workspaceId, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as LedgerReportRow[];
  }

  async reportUsageByTask(workspaceId: string, taskId: string): Promise<LedgerReportRow[]> {
    return this.db
      .prepare(
        `SELECT estimated_cost_nanos, observed_cost_nanos, observed_currency, estimated_currency, pricing_mode
         FROM usage_events
         WHERE workspace_id = ? AND task_id = ?`,
      )
      .all(workspaceId, taskId) as LedgerReportRow[];
  }

  async getDashboardSummary(workspaceId: string): Promise<DashboardSummaryRow> {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos,
           COALESCE(SUM(COALESCE(observed_cost_nanos, 0)), 0) AS observed_cost_nanos,
           SUM(CASE WHEN pricing_mode = 'unpriced' THEN 1 ELSE 0 END) AS unpriced_count,
           SUM(CASE WHEN assignment_status = 'unassigned' THEN 1 ELSE 0 END) AS unassigned_count,
           SUM(CASE WHEN assignment_status = 'assigned' THEN 1 ELSE 0 END) AS assigned_count,
           COUNT(DISTINCT task_id) AS task_count,
           COUNT(DISTINCT run_id) AS run_count
         FROM usage_events
         WHERE workspace_id = ?`,
      )
      .get(workspaceId) as Omit<DashboardSummaryRow, "currency">;
    const currencies = this.db
      .prepare(
        `SELECT DISTINCT COALESCE(estimated_currency, observed_currency) AS currency
         FROM usage_events
         WHERE workspace_id = ?
           AND COALESCE(estimated_currency, observed_currency) IS NOT NULL`,
      )
      .all(workspaceId) as Array<{ currency: string }>;
    return {
      ...row,
      currency: currencies.length === 1 ? currencies[0]?.currency ?? null : null,
    };
  }

  async listDashboardTaskCosts(workspaceId: string, limit: number): Promise<DashboardTaskCostRow[]> {
    return this.db
      .prepare(
        `SELECT
           u.task_id AS task_id,
           t.key AS task_key,
           t.name AS task_name,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0))), 0) AS token_count,
           COALESCE(SUM(COALESCE(u.estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos,
           SUM(CASE WHEN u.pricing_mode = 'unpriced' THEN 1 ELSE 0 END) AS unpriced_count
         FROM usage_events u
         LEFT JOIN tasks t ON t.id = u.task_id
         WHERE u.workspace_id = ?
         GROUP BY u.task_id, t.key, t.name
         ORDER BY estimated_cost_nanos DESC, event_count DESC
         LIMIT ?`,
      )
      .all(workspaceId, limit) as DashboardTaskCostRow[];
  }

  async getDashboardTaskInsight(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardTaskInsightRow | null> {
    const row = this.db
      .prepare(
        `WITH task_usage AS (
           SELECT
             u.task_id AS task_id,
             t.key AS task_key,
             t.name AS task_name,
             t.status AS task_status,
             COUNT(*) AS event_count,
             COUNT(DISTINCT u.run_id) AS run_count,
             COALESCE(SUM(COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0))), 0) AS token_count,
             COALESCE(SUM(COALESCE(u.estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos,
             SUM(CASE WHEN u.pricing_mode = 'unpriced' THEN 1 ELSE 0 END) AS unpriced_count,
             MIN(u.occurred_at) AS first_activity_at,
             MAX(u.occurred_at) AS last_activity_at
           FROM usage_events u
           LEFT JOIN tasks t ON t.id = u.task_id
           WHERE u.workspace_id = ? AND u.task_id = ?
           GROUP BY u.task_id, t.key, t.name, t.status
         ),
         latest_prompt AS (
           SELECT json_extract(u.payload_json, '$.payload.prompt_snapshot.prompt_text') AS prompt_text
           FROM usage_events u
           WHERE u.workspace_id = ? AND u.task_id = ?
           ORDER BY u.occurred_at DESC, u.id DESC
           LIMIT 1
         )
         SELECT
           task_usage.task_id,
           task_usage.task_key,
           task_usage.task_name,
           task_usage.task_status,
           task_usage.event_count,
           task_usage.run_count,
           task_usage.token_count,
           task_usage.estimated_cost_nanos,
           task_usage.unpriced_count,
           task_usage.first_activity_at,
           task_usage.last_activity_at,
           latest_prompt.prompt_text AS latest_prompt
         FROM task_usage
         LEFT JOIN latest_prompt ON 1 = 1`,
      )
      .get(workspaceId, taskId, workspaceId, taskId) as DashboardTaskInsightRow | undefined;
    return row ?? null;
  }

  async listDashboardTaskInsights(
    workspaceId: string,
    limit: number,
  ): Promise<DashboardTaskInsightRow[]> {
    return this.db
      .prepare(
        `WITH task_usage AS (
           SELECT
             u.task_id AS task_id,
             t.key AS task_key,
             t.name AS task_name,
             t.status AS task_status,
             COUNT(*) AS event_count,
             COUNT(DISTINCT u.run_id) AS run_count,
             COALESCE(SUM(COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0))), 0) AS token_count,
             COALESCE(SUM(COALESCE(u.estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos,
             SUM(CASE WHEN u.pricing_mode = 'unpriced' THEN 1 ELSE 0 END) AS unpriced_count,
             MIN(u.occurred_at) AS first_activity_at,
             MAX(u.occurred_at) AS last_activity_at
           FROM usage_events u
           LEFT JOIN tasks t ON t.id = u.task_id
           WHERE u.workspace_id = ?
           GROUP BY u.task_id, t.key, t.name, t.status
         ),
         latest_prompt AS (
           SELECT task_id, prompt_text
           FROM (
             SELECT
               u.task_id AS task_id,
               json_extract(u.payload_json, '$.payload.prompt_snapshot.prompt_text') AS prompt_text,
               ROW_NUMBER() OVER (
                 PARTITION BY u.task_id
                 ORDER BY u.occurred_at DESC, u.id DESC
               ) AS rank
             FROM usage_events u
             WHERE u.workspace_id = ?
           )
           WHERE rank = 1
         )
         SELECT
           task_usage.task_id,
           task_usage.task_key,
           task_usage.task_name,
           task_usage.task_status,
           task_usage.event_count,
           task_usage.run_count,
           task_usage.token_count,
           task_usage.estimated_cost_nanos,
           task_usage.unpriced_count,
           task_usage.first_activity_at,
           task_usage.last_activity_at,
           latest_prompt.prompt_text AS latest_prompt
         FROM task_usage
         LEFT JOIN latest_prompt
           ON latest_prompt.task_id = task_usage.task_id
           OR (latest_prompt.task_id IS NULL AND task_usage.task_id IS NULL)
         ORDER BY task_usage.estimated_cost_nanos DESC, task_usage.event_count DESC, task_usage.last_activity_at DESC
         LIMIT ?`,
      )
      .all(workspaceId, workspaceId, limit) as DashboardTaskInsightRow[];
  }

  async listRecentUsageEvents(workspaceId: string, limit: number): Promise<DashboardRecentUsageRow[]> {
    return this.db
      .prepare(
        `SELECT
           u.id,
           u.occurred_at,
           t.key AS task_key,
           t.name AS task_name,
           u.run_id,
           u.provider,
           u.model,
           u.usage_kind,
           u.input_tokens,
           u.output_tokens,
           u.total_tokens,
           COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)) AS token_count,
           u.estimated_cost_nanos,
           u.observed_cost_nanos,
           u.estimated_currency,
           u.observed_currency,
           u.pricing_mode,
           u.accuracy_mode,
           u.assignment_status,
           u.duration_ms,
           json_extract(u.payload_json, '$.payload.prompt_snapshot.prompt_text') AS prompt_text
         FROM usage_events u
         LEFT JOIN tasks t ON t.id = u.task_id
         WHERE u.workspace_id = ?
         ORDER BY u.occurred_at DESC
         LIMIT ?`,
      )
      .all(workspaceId, limit) as DashboardRecentUsageRow[];
  }

  async listRecentUsageEventsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
  ): Promise<DashboardRecentUsageRow[]> {
    return this.db
      .prepare(
        `SELECT
           u.id,
           u.occurred_at,
           t.key AS task_key,
           t.name AS task_name,
           u.run_id,
           u.provider,
           u.model,
           u.usage_kind,
           u.input_tokens,
           u.output_tokens,
           u.total_tokens,
           COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0)) AS token_count,
           u.estimated_cost_nanos,
           u.observed_cost_nanos,
           u.estimated_currency,
           u.observed_currency,
           u.pricing_mode,
           u.accuracy_mode,
           u.assignment_status,
           u.duration_ms,
           json_extract(u.payload_json, '$.payload.prompt_snapshot.prompt_text') AS prompt_text
         FROM usage_events u
         LEFT JOIN tasks t ON t.id = u.task_id
         WHERE u.workspace_id = ? AND u.task_id = ?
         ORDER BY u.occurred_at DESC
         LIMIT ?`,
      )
      .all(workspaceId, taskId, limit) as DashboardRecentUsageRow[];
  }

  async listDashboardPricingModeBreakdown(workspaceId: string): Promise<DashboardBreakdownRow[]> {
    return this.db
      .prepare(
        `SELECT
           COALESCE(pricing_mode, 'unknown') AS key,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
         FROM usage_events
         WHERE workspace_id = ?
         GROUP BY COALESCE(pricing_mode, 'unknown')
         ORDER BY event_count DESC`,
      )
      .all(workspaceId) as DashboardBreakdownRow[];
  }

  async listDashboardPricingModeBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]> {
    return this.db
      .prepare(
        `SELECT
           COALESCE(pricing_mode, 'unknown') AS key,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
         FROM usage_events
         WHERE workspace_id = ? AND task_id = ?
         GROUP BY COALESCE(pricing_mode, 'unknown')
         ORDER BY event_count DESC`,
      )
      .all(workspaceId, taskId) as DashboardBreakdownRow[];
  }

  async listDashboardAccuracyModeBreakdown(workspaceId: string): Promise<DashboardBreakdownRow[]> {
    return this.db
      .prepare(
        `SELECT
           accuracy_mode AS key,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
         FROM usage_events
         WHERE workspace_id = ?
         GROUP BY accuracy_mode
         ORDER BY event_count DESC`,
      )
      .all(workspaceId) as DashboardBreakdownRow[];
  }

  async listDashboardAccuracyModeBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]> {
    return this.db
      .prepare(
        `SELECT
           accuracy_mode AS key,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
         FROM usage_events
         WHERE workspace_id = ? AND task_id = ?
         GROUP BY accuracy_mode
         ORDER BY event_count DESC`,
      )
      .all(workspaceId, taskId) as DashboardBreakdownRow[];
  }

  async listDashboardProviderModelBreakdownForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<DashboardBreakdownRow[]> {
    return this.db
      .prepare(
        `SELECT
           provider || '/' || model AS key,
           COUNT(*) AS event_count,
           COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
         FROM usage_events
         WHERE workspace_id = ? AND task_id = ?
         GROUP BY provider, model
         ORDER BY estimated_cost_nanos DESC, event_count DESC`,
      )
      .all(workspaceId, taskId) as DashboardBreakdownRow[];
  }

  async listDashboardDailyCosts(
    workspaceId: string,
    limit: number,
    timeZoneOffsetMinutes?: number,
  ): Promise<DashboardDailyCostRow[]> {
    const dayExpression = dashboardDayExpression(timeZoneOffsetMinutes);
    return this.db
      .prepare(
        `SELECT *
         FROM (
           SELECT
             ${dayExpression} AS date,
             COUNT(*) AS event_count,
             COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
           FROM usage_events
           WHERE workspace_id = ?
           GROUP BY ${dayExpression}
           ORDER BY date DESC
           LIMIT ?
         )
         ORDER BY date ASC`,
      )
      .all(workspaceId, limit) as DashboardDailyCostRow[];
  }

  async listDashboardDailyCostsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
    timeZoneOffsetMinutes?: number,
  ): Promise<DashboardDailyCostRow[]> {
    const dayExpression = dashboardDayExpression(timeZoneOffsetMinutes);
    return this.db
      .prepare(
        `SELECT *
         FROM (
           SELECT
             ${dayExpression} AS date,
             COUNT(*) AS event_count,
             COALESCE(SUM(COALESCE(estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos
           FROM usage_events
           WHERE workspace_id = ? AND task_id = ?
           GROUP BY ${dayExpression}
           ORDER BY date DESC
           LIMIT ?
         )
         ORDER BY date ASC`,
      )
      .all(workspaceId, taskId, limit) as DashboardDailyCostRow[];
  }

  async listDashboardRunsForTask(
    workspaceId: string,
    taskId: string,
    limit: number,
  ): Promise<DashboardTaskRunRow[]> {
    return this.db
      .prepare(
        `WITH grouped_runs AS (
           SELECT
             u.run_id AS run_id,
             r.status AS run_status,
             r.source AS run_source,
             COALESCE(r.started_at, MIN(COALESCE(u.started_at, u.occurred_at))) AS started_at,
             COALESCE(r.ended_at, MAX(COALESCE(u.ended_at, u.started_at, u.occurred_at))) AS ended_at,
             COUNT(*) AS event_count,
             COALESCE(SUM(COALESCE(u.total_tokens, COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0))), 0) AS token_count,
             COALESCE(SUM(COALESCE(u.estimated_cost_nanos, 0)), 0) AS estimated_cost_nanos,
             SUM(
               CASE
                 WHEN u.duration_ms IS NOT NULL THEN u.duration_ms
                 WHEN u.started_at IS NOT NULL AND u.ended_at IS NOT NULL THEN
                   CAST(ROUND((julianday(u.ended_at) - julianday(u.started_at)) * 86400000.0) AS INTEGER)
                 ELSE NULL
               END
             ) AS event_duration_ms,
             MIN(u.occurred_at) AS first_activity_at,
             MAX(u.occurred_at) AS last_activity_at
           FROM usage_events u
           LEFT JOIN runs r ON r.id = u.run_id
           WHERE u.workspace_id = ? AND u.task_id = ?
           GROUP BY u.run_id, r.status, r.source, r.started_at, r.ended_at
         )
         SELECT
           run_id,
           run_status,
           run_source,
           started_at,
           ended_at,
           CASE
             WHEN started_at IS NOT NULL AND ended_at IS NOT NULL THEN
               MAX(0, CAST(ROUND((julianday(ended_at) - julianday(started_at)) * 86400000.0) AS INTEGER))
             ELSE NULL
           END AS span_duration_ms,
           event_duration_ms,
           event_count,
           token_count,
           estimated_cost_nanos,
           first_activity_at,
           last_activity_at
         FROM grouped_runs
         ORDER BY COALESCE(ended_at, last_activity_at) DESC, event_count DESC
         LIMIT ?`,
      )
      .all(workspaceId, taskId, limit) as DashboardTaskRunRow[];
  }

  getLastImportedAt(workspaceId: string, source: string): Promise<string | null> {
    const row = this.db
      .prepare(
        `SELECT MAX(occurred_at) AS last_at FROM usage_events WHERE workspace_id = ? AND source = ?`,
      )
      .get(workspaceId, source) as { last_at: string | null } | undefined;
    return Promise.resolve(row?.last_at ?? null);
  }
}

type DbRow = Record<string, unknown>;

function dashboardDayExpression(timeZoneOffsetMinutes: number | undefined): string {
  if (timeZoneOffsetMinutes == null || timeZoneOffsetMinutes === 0) return "substr(occurred_at, 1, 10)";
  if (!Number.isInteger(timeZoneOffsetMinutes) || Math.abs(timeZoneOffsetMinutes) > 14 * 60) {
    throw new Error(`Invalid timezone offset minutes: ${timeZoneOffsetMinutes}`);
  }
  const sign = timeZoneOffsetMinutes >= 0 ? "+" : "-";
  return `date(occurred_at, '${sign}${Math.abs(timeZoneOffsetMinutes)} minutes')`;
}

function parseWorkspace(row: unknown): WorkspaceRecord | null {
  if (!row) return null;
  return WorkspaceRecordSchema.parse(fromDbJson(row as DbRow));
}

function parseTask(row: unknown): TaskRecord | null {
  if (!row) return null;
  return TaskRecordSchema.parse(fromDbJson(row as DbRow));
}

function parseRun(row: unknown): RunRecord | null {
  if (!row) return null;
  return RunRecordSchema.parse(fromDbJson(row as DbRow));
}

function parseAccessKey(row: unknown): AccessKeyRecord | null {
  if (!row) return null;
  return AccessKeyRecordSchema.parse(fromDbJson(row as DbRow));
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

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void {
  if (hasColumn(db, tableName, columnName)) return;
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`).run();
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  return columnNames(db, tableName).includes(columnName);
}

function columnNames(db: Database.Database, tableName: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => (row as { name: string }).name);
}
