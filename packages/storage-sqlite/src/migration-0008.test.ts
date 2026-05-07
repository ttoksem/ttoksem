import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteLedgerStore } from "./index.js";

describe("migration 0008_drop_active_task_id", () => {
  it("drops active_task_id column while preserving other workspace columns and existing rows", async () => {
    const dbPath = join(
      tmpdir(),
      `ttoksem-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    // Pre-seed a database that looks like one created by an older version
    // of migrate(): the workspaces table still has active_task_id, and
    // schema_migrations has the markers that were inserted prior to 0008.
    const setup = new Database(dbPath);
    setup.pragma("journal_mode = WAL");
    setup.pragma("foreign_keys = ON");
    setup.exec(`
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
    setup
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0001_initial", "2026-01-01T00:00:00.000Z");
    setup
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run("0002_split_usage_event_currency", "2026-01-01T00:00:00.000Z");
    setup
      .prepare(
        `INSERT INTO workspaces (
          id, key, name, description, status, root_path, active_task_id, source,
          external_ref_json, metadata_json, created_at, archived_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'active', ?, ?, 'cli', NULL, NULL, ?, NULL, ?)`,
      )
      .run(
        "ws_test",
        "test-key",
        "Test",
        "/tmp/x",
        "task_xyz",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    setup.close();

    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
    } finally {
      await store.close();
    }

    // Verify post-migration schema and data using a fresh connection.
    const verify = new Database(dbPath);
    try {
      const cols = verify
        .prepare("PRAGMA table_info(workspaces)")
        .all() as Array<{ name: string }>;
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

      const row = verify
        .prepare("SELECT id, key, status, root_path FROM workspaces WHERE id = ?")
        .get("ws_test") as { id: string; key: string; status: string; root_path: string };
      expect(row.id).toBe("ws_test");
      expect(row.key).toBe("test-key");
      expect(row.status).toBe("active");
      expect(row.root_path).toBe("/tmp/x");

      const mig = verify
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get("0008_drop_active_task_id");
      expect(mig).toBeDefined();

      // The unique active root_path index on workspaces should still exist.
      const indexes = verify
        .prepare("PRAGMA index_list(workspaces)")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("workspaces_active_root_path_idx");
    } finally {
      verify.close();
    }

    // Run migrate() a second time on the same DB; it must be idempotent.
    const store2 = new SqliteLedgerStore(dbPath);
    try {
      await store2.migrate();
    } finally {
      await store2.close();
    }

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  });
});
