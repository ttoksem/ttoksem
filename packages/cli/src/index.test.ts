import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("index.ts", import.meta.url));

describe("ttoksem CLI workflows", () => {
  it("records a Codex turn, lists inbox usage, and moves usage to a task", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      expect(runCli(["workspace", "init", "--key", "cli-test", "--root", tempDir], env)).toContain(
        "workspace cli-test",
      );
      expect(
        runCli(
          [
            "task",
            "start",
            "implement-cli-workflow-tests",
            "--workspace",
            "cli-test",
            "--name",
            "Implement CLI workflow tests",
          ],
          env,
        ),
      ).toContain("task implement-cli-workflow-tests active");

      const assignedOutput = runCli(
        [
          "usage",
          "codex-turn",
          "--workspace",
          "cli-test",
          "--task",
          "implement-cli-workflow-tests",
          "--prompt-text",
          "abcd",
          "--response-text",
          "abcdefgh",
          "--started-at",
          "2026-04-27T00:00:01.000Z",
          "--ended-at",
          "2026-04-27T00:00:03.250Z",
          "--idempotency-key",
          "assigned-001",
        ],
        env,
      );
      expect(assignedOutput).toMatch(/usage usage_[a-z0-9]+ openai\/codex-chat assigned/);

      const store = new SqliteLedgerStore(dbPath);
      try {
        await store.migrate();
        const workspace = await store.getWorkspaceByKey("cli-test");
        expect(workspace).not.toBeNull();
        const assigned = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-chat",
          "assigned-001",
        );
        expect(assigned).toMatchObject({
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
          duration_ms: 2250,
          accuracy_mode: "estimated",
          assignment_status: "assigned",
        });
        expect(tokenEstimationInputMode(assigned?.payload_json)).toBe("estimated");
      } finally {
        await store.close();
      }

      const unassignedOutput = runCli(
        [
          "usage",
          "codex-turn",
          "--workspace",
          "cli-test",
          "--prompt-text",
          "unassigned prompt",
          "--input-chars",
          "20",
          "--output-chars",
          "40",
          "--idempotency-key",
          "unassigned-001",
        ],
        env,
      );
      const usageId = unassignedOutput.match(/usage_(?<id>[a-z0-9]+)/)?.[0];
      expect(usageId).toBeDefined();
      expect(unassignedOutput).toContain("unassigned");

      const inboxOutput = runCli(["inbox", "list", "--workspace", "cli-test"], env);
      expect(inboxOutput).toContain(usageId);
      expect(inboxOutput).toContain("tokens=15");
      expect(inboxOutput).toContain("prompt=unassigned prompt");

      expect(
        runCli(
          ["usage", "move", usageId ?? "", "--workspace", "cli-test", "--task", "implement-cli-workflow-tests"],
          env,
        ),
      ).toContain(`usage ${usageId} moved task_id=task_`);
      expect(runCli(["inbox", "list", "--workspace", "cli-test"], env).trim()).toBe(
        "No unassigned usage events.",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("tsx", [cliPath, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tokenEstimationInputMode(payload: Record<string, unknown> | undefined): string | null {
  const payloadObject = asRecord(payload?.payload);
  const sourceContext = asRecord(payloadObject?.source_context);
  const tokenEstimation = asRecord(sourceContext?.token_estimation);
  const input = asRecord(tokenEstimation?.input);
  return typeof input?.mode === "string" ? input.mode : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
