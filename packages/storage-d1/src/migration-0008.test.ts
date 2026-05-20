import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1LedgerStore, type D1Database, type D1PreparedStatement, type D1Result, type D1RunResult } from "./index.js";

describe("D1 migration 0008_drop_active_task_id", () => {
  it("drops active_task_id column while preserving other workspace columns and existing rows", async () => {
    const db = new FakeD1Database();
    // Pre-seed a database that looks like one created by an older version
    // of migrate(): the workspaces table still has active_task_id, and
    // schema_migrations has the markers that were inserted prior to 0008.
    db.execSync(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE workspaces (
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

      CREATE UNIQUE INDEX workspaces_active_root_path_idx
        ON workspaces(root_path)
        WHERE root_path IS NOT NULL AND status = 'active';

      CREATE TABLE tasks (
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
    `);
    db.runSync("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", [
      "0001_initial",
      "2026-01-01T00:00:00.000Z",
    ]);
    db.runSync("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", [
      "0002_split_usage_event_currency",
      "2026-01-01T00:00:00.000Z",
    ]);
    db.runSync(
      `INSERT INTO workspaces (
         id, key, name, description, status, root_path, active_task_id, source,
         external_ref_json, metadata_json, created_at, archived_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'active', ?, ?, 'cli', NULL, NULL, ?, NULL, ?)`,
      [
        "ws_test",
        "test-key",
        "Test",
        "/tmp/x-d1",
        "task_xyz",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ],
    );

    const store = new D1LedgerStore(db);
    await store.migrate();

    // Verify post-migration schema and data using the same DB.
    const cols = db.allSync<{ name: string }>("PRAGMA table_info(workspaces)");
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain("active_task_id");
    const expected = [
      "id",
      "key",
      "name",
      "description",
      "status",
      "root_path",
      "source",
      "external_ref_json",
      "metadata_json",
      "created_at",
      "archived_at",
      "updated_at",
    ];
    expect(colNames.slice().sort()).toEqual(expected.slice().sort());

    const row = db.firstSync<{ id: string; key: string; status: string; root_path: string }>(
      "SELECT id, key, status, root_path FROM workspaces WHERE id = ?",
      ["ws_test"],
    );
    expect(row?.id).toBe("ws_test");
    expect(row?.key).toBe("test-key");
    expect(row?.status).toBe("active");
    expect(row?.root_path).toBe("/tmp/x-d1");

    const mig = db.firstSync<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = ?",
      ["0008_drop_active_task_id"],
    );
    expect(mig?.version).toBe("0008_drop_active_task_id");

    // The unique active root_path index on workspaces should still exist.
    const indexes = db.allSync<{ name: string }>("PRAGMA index_list(workspaces)");
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("workspaces_active_root_path_idx");

    // Run migrate() a second time on the same DB; it must be idempotent.
    await store.migrate();
    const colsAfter = db.allSync<{ name: string }>("PRAGMA table_info(workspaces)");
    expect(colsAfter.map((c) => c.name)).not.toContain("active_task_id");
  });
});

class FakeD1Database implements D1Database {
  private readonly db = new DatabaseSync(":memory:");

  prepare(query: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.db.prepare(query), []);
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.db.exec(query);
    return { count: 0, duration: 0 };
  }

  // Test-only synchronous helpers for seeding and verification.
  execSync(query: string): void {
    this.db.exec(query);
  }

  runSync(sql: string, params: unknown[]): void {
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  allSync<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  firstSync<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    return (this.db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null;
  }
}

class FakeD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly statement: StatementSync,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.statement, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement.get(...(this.values as SQLInputValue[])) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: this.statement.all(...(this.values as SQLInputValue[])) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const result = this.statement.run(...(this.values as SQLInputValue[]));
    const changes = Number(result.changes);
    return {
      success: true,
      meta: {
        changes,
        changed_db: changes > 0,
      },
    };
  }
}
