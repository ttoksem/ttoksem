import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("index.ts", import.meta.url));

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("tsx", [cliPath, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("ttoksem hook run", () => {
  it("imports project-scoped Claude session usage into the local ledger", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-hook-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };

    try {
      // 1. Create workspace
      expect(
        runCli(["workspace", "init", "--key", "ttoksem-dev", "--root", tempDir], env),
      ).toContain("workspace ttoksem-dev");

      // 2. Create a fake Claude Code project dir with a session JSONL file
      const sessionId = "hook-test-session-uuid-0001";
      const fakeProjectDir = join(tempDir, "projects", "-Users-hook-test-project");
      mkdirSync(fakeProjectDir, { recursive: true });
      const sessionFile = join(fakeProjectDir, `${sessionId}.jsonl`);

      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            promptId: "p1",
            timestamp: "2026-05-20T00:10:00.000Z",
            uuid: "hook-user-1",
            message: { role: "user", content: "hook run test prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "hook-req-1",
            timestamp: "2026-05-20T00:10:05.000Z",
            uuid: "hook-asst-1",
            message: {
              id: "msg_hook1",
              model: "claude-sonnet-4-6",
              usage: {
                input_tokens: 15,
                output_tokens: 42,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
        ].join("\n"),
      );

      // 3. Run `hook run`
      const output = runCli(
        [
          "hook",
          "run",
          "--workspace",
          "ttoksem-dev",
          "--projects-dir",
          fakeProjectDir,
        ],
        env,
      );
      expect(output).toContain("imported=1");

      // 4. Verify: at least one claude-session usage event imported
      const store = new SqliteLedgerStore(dbPath);
      try {
        await store.migrate();
        const workspace = await store.getWorkspaceByKey("ttoksem-dev");
        expect(workspace).not.toBeNull();
        const events = await store.listRecentUsageEvents(workspace?.id ?? "", 50);
        expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(
          true,
        );
      } finally {
        await store.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);
});
