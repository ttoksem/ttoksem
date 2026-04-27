import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteLedgerStore } from "./index.js";

describe("SqliteLedgerStore", () => {
  it("creates a workspace and preserves root path lookup", async () => {
    const dbPath = join(tmpdir(), `ttoksem-test-${Date.now()}.db`);
    const store = new SqliteLedgerStore(dbPath);
    try {
      await store.migrate();
      const workspace = await store.createWorkspace({
        id: "ws_test",
        key: "test",
        name: "Test",
        root_path: "/tmp/test",
        source: "test",
        now: "2026-04-27T00:00:00.000Z",
      });

      expect(workspace.key).toBe("test");
      await expect(store.getWorkspaceByRootPath("/tmp/test")).resolves.toMatchObject({
        id: "ws_test",
      });
    } finally {
      await store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });
});

