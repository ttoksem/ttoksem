import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      const accessKeyOutput = runCli(
        [
          "auth",
          "key",
          "create",
          "--workspace-scope",
          "cli-test",
          "--name",
          "CLI dashboard",
          "--scope",
          "dashboard:read",
          "--scope",
          "api:read",
        ],
        env,
      );
      const accessKeyId = accessKeyOutput.match(/access key (?<id>key_[a-z0-9]+)/)?.groups?.id;
      const accessToken = accessKeyOutput.match(/token (?<token>ttok_[A-Za-z0-9_-]+)/)?.groups?.token;
      expect(accessKeyId).toBeDefined();
      expect(accessToken).toBeDefined();
      const accessKeyList = runCli(["auth", "key", "list"], env);
      expect(accessKeyList).toContain(accessKeyId ?? "");
      expect(accessKeyList).toContain(`prefix=${accessToken?.slice(0, 16)}`);
      expect(accessKeyList).toContain("scopes=dashboard:read,api:read");
      expect(accessKeyList).toContain("workspaces=cli-test");
      expect(accessKeyList).not.toContain(accessToken ?? "");
      expect(runCli(["auth", "key", "revoke", accessKeyId ?? ""], env)).toContain(
        "revoked_at=202",
      );
      expect(runCli(["auth", "key", "list"], env)).toContain("status=revoked");

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
      expect(runCli(["task", "list", "--workspace", "cli-test"], env)).toContain(
        "Implement CLI workflow tests",
      );
      expect(
        runCli(
          [
            "task",
            "update",
            "implement-cli-workflow-tests",
            "--workspace",
            "cli-test",
            "--name",
            "CLI Workflow Tests",
            "--description",
            "Exercise task naming from the CLI",
          ],
          env,
        ),
      ).toContain("CLI Workflow Tests");
      expect(runCli(["task", "list", "--workspace", "cli-test"], env)).toContain("CLI Workflow Tests");

      const assignedOutput = runCli(
        [
          "usage",
          "chat-turn",
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
          pricing_mode: "unpriced",
        });
        expect(assigned?.run_id).toBeNull();
        expect(tokenEstimationInputMode(assigned?.payload_json)).toBe("estimated");
      } finally {
        await store.close();
      }

      const litellmPriceFile = join(tempDir, "litellm-prices.json");
      writeFileSync(
        litellmPriceFile,
        JSON.stringify({
          "gpt-test": {
            litellm_provider: "openai",
            mode: "chat",
            input_cost_per_token: 0.0000001,
            output_cost_per_token: 0.0000005,
          },
        }),
      );
      const snapshotOutput = runCli(
        [
          "pricing",
          "snapshot",
          "upsert",
          "--id",
          "price_snapshot_cli_test",
          "--source-name",
          "litellm",
          "--raw-sha256",
          "sha256:cli-test",
          "--source-commit",
          "abc123",
          "--valid-from",
          "2026-01-01T00:00:00.000Z",
          "--raw-storage-ref",
          litellmPriceFile,
        ],
        env,
      );
      const snapshotId = "price_snapshot_cli_test";
      expect(snapshotOutput).toContain(snapshotId);
      expect(snapshotId).toBeDefined();
      expect(runCli(["pricing", "snapshot", "list"], env)).toContain(snapshotId);
      expect(
        runCli(
          [
            "pricing",
            "import-litellm",
            "--workspace",
            "cli-test",
            "--source-snapshot-id",
            snapshotId,
          ],
          env,
        ),
      ).toContain(`pricing import-litellm imported=2 skipped=0 snapshot=${snapshotId}`);
      const importedRules = runCli(["pricing", "list", "--workspace", "cli-test"], env);
      expect(importedRules).toContain("openai\tgpt-test\tchat_completion\tinput_token\tnanos=100");
      expect(importedRules).toContain("openai\tgpt-test\tchat_completion\toutput_token\tnanos=500");

      expect(
        runCli(
          [
            "pricing",
            "upsert",
            "--workspace",
            "cli-test",
            "--provider",
            "openai",
            "--model",
            "codex-chat",
            "--usage-kind",
            "conversation_turn",
            "--unit-type",
            "input_token",
            "--price",
            "0.10",
            "--per",
            "1000000",
            "--effective-from",
            "2026-01-01T00:00:00.000Z",
            "--source-snapshot-id",
            snapshotId ?? "",
          ],
          env,
        ),
      ).toContain("pricing openai/codex-chat conversation_turn input_token 100 nanos USD");
      expect(
        runCli(
          [
            "pricing",
            "upsert",
            "--workspace",
            "cli-test",
            "--provider",
            "openai",
            "--model",
            "codex-chat",
            "--usage-kind",
            "conversation_turn",
            "--unit-type",
            "output_token",
            "--price",
            "0.50",
            "--per",
            "1000000",
            "--effective-from",
            "2026-01-01T00:00:00.000Z",
            "--source-snapshot-id",
            snapshotId ?? "",
          ],
          env,
        ),
      ).toContain("pricing openai/codex-chat conversation_turn output_token 500 nanos USD");
      expect(runCli(["pricing", "list", "--workspace", "cli-test"], env)).toContain("input_token");
      expect(runCli(["pricing", "reprice", "--workspace", "cli-test"], env)).toContain(
        "reprice checked=1 repriced=1 still_unpriced=0",
      );
      expect(runCli(["pricing", "migrate-events", "--workspace", "cli-test"], env)).toContain(
        "pricing migrate-events checked=1 migrated=0 unchanged=1 still_unpriced=0",
      );
      const dashboardOutput = runCli(["dashboard", "overview", "--workspace", "cli-test"], env);
      expect(dashboardOutput).toContain("Workspace dashboard: cli-test");
      expect(dashboardOutput).toContain("Summary");
      expect(dashboardOutput).toContain("Cost quality");
      expect(dashboardOutput).toContain("Top tasks");
      expect(dashboardOutput).toContain("Report tiles");
      expect(dashboardOutput).toContain("Task cost summary");

      const codexSessionFile = join(tempDir, "codex-session.jsonl");
      writeFileSync(
        codexSessionFile,
        [
          JSON.stringify({
            timestamp: "2026-04-27T00:10:00.000Z",
            type: "session_meta",
            payload: {
              id: "019dd187-51b3-7e02-b2dc-311a2b503dd2",
              cwd: tempDir,
              originator: "Codex Desktop",
              cli_version: "0.125.0-alpha.3",
              source: "vscode",
              model_provider: "openai",
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T00:10:01.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "import this Codex prompt",
              images: [],
              local_images: [],
              text_elements: [],
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T00:10:05.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 1000,
                  cached_input_tokens: 800,
                  output_tokens: 40,
                  reasoning_output_tokens: 10,
                  total_tokens: 1040,
                },
                last_token_usage: {
                  input_tokens: 1000,
                  cached_input_tokens: 800,
                  output_tokens: 40,
                  reasoning_output_tokens: 10,
                  total_tokens: 1040,
                },
              },
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T00:10:45.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 130,
                  cached_input_tokens: 90,
                  output_tokens: 20,
                  reasoning_output_tokens: 5,
                  total_tokens: 150,
                },
              },
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T00:11:00.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "second Codex prompt",
              images: [],
              local_images: [],
              text_elements: [],
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T00:11:05.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 120,
                  cached_input_tokens: 80,
                  output_tokens: 15,
                  reasoning_output_tokens: 4,
                  total_tokens: 135,
                },
              },
            },
          }),
        ].join("\n"),
      );
      expect(
        runCli(
          [
            "usage",
            "import-codex-sessions",
            "--workspace",
            "cli-test",
            "--task",
            "implement-cli-workflow-tests",
            "--file",
            codexSessionFile,
            "--model",
            "gpt-5.5",
          ],
          env,
        ),
      ).toContain("codex import scanned_files=1 token_events=3 imported=3 skipped=0 errors=0");
      const codexStore = new SqliteLedgerStore(dbPath);
      try {
        await codexStore.migrate();
        const workspace = await codexStore.getWorkspaceByKey("cli-test");
        const imported = await codexStore.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-session",
          "codex-session:019dd187-51b3-7e02-b2dc-311a2b503dd2:2026-04-27T00:10:05.000Z",
        );
        expect(imported).toMatchObject({
          provider: "openai",
          model: "gpt-5.5",
          usage_kind: "conversation_turn",
          input_tokens: 1000,
          output_tokens: 40,
          total_tokens: 1040,
          accuracy_mode: "exact",
          assignment_status: "assigned",
        });
        expect(imported?.run_id).toMatch(/^run_codex_/);
        expect(codexRawUsage(imported?.payload_json)).toMatchObject({
          cached_input_tokens: 800,
          reasoning_output_tokens: 10,
        });
        expect(promptSnapshot(imported?.payload_json)).toMatchObject({
          mode: "full",
          prompt_text: "import this Codex prompt",
        });
        const samePromptImported = await codexStore.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-session",
          "codex-session:019dd187-51b3-7e02-b2dc-311a2b503dd2:2026-04-27T00:10:45.000Z",
        );
        const secondPromptImported = await codexStore.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-session",
          "codex-session:019dd187-51b3-7e02-b2dc-311a2b503dd2:2026-04-27T00:11:05.000Z",
        );
        expect(imported?.run_id).toMatch(/^run_codex_.*_prompt_0001_/);
        expect(samePromptImported?.run_id).toBe(imported?.run_id);
        expect(secondPromptImported?.run_id).toMatch(/^run_codex_.*_prompt_0002_/);
        expect(secondPromptImported?.run_id).not.toBe(imported?.run_id);
        expect(promptSnapshot(secondPromptImported?.payload_json)).toMatchObject({
          mode: "full",
          prompt_text: "second Codex prompt",
        });
      } finally {
        await codexStore.close();
      }

      const repricedStore = new SqliteLedgerStore(dbPath);
      try {
        await repricedStore.migrate();
        const workspace = await repricedStore.getWorkspaceByKey("cli-test");
        const assigned = await repricedStore.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-chat",
          "assigned-001",
        );
        expect(assigned?.pricing_rule_ids_json).toHaveLength(2);
        expect(assigned?.pricing_source_snapshot_ids_json).toEqual([snapshotId]);
        expect(assigned?.cost_calculated_at).toMatch(/Z$/);
      } finally {
        await repricedStore.close();
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
  }, 15_000);
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

function codexRawUsage(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const payloadObject = asRecord(payload?.payload);
  const usage = asRecord(payloadObject?.usage);
  return asRecord(usage?.raw_usage);
}

function promptSnapshot(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const payloadObject = asRecord(payload?.payload);
  return asRecord(payloadObject?.prompt_snapshot);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
