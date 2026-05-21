import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

      const openAiResponseFile = join(tempDir, "openai-response.json");
      writeFileSync(
        openAiResponseFile,
        JSON.stringify({
          id: "chatcmpl_cli_test",
          object: "chat.completion",
          model: "gpt-test",
          usage: {
            prompt_tokens: 200,
            completion_tokens: 20,
            total_tokens: 220,
            prompt_tokens_details: {
              cached_tokens: 25,
            },
            completion_tokens_details: {
              reasoning_tokens: 3,
            },
          },
        }),
      );
      expect(
        runCli(
          [
            "usage",
            "openai-response",
            "--workspace",
            "cli-test",
            "--task",
            "implement-cli-workflow-tests",
            "--file",
            openAiResponseFile,
            "--operation",
            "chat.completions.create",
          ],
          env,
        ),
      ).toMatch(/usage usage_[a-z0-9]+ openai\/gpt-test assigned/);
      const providerStore = new SqliteLedgerStore(dbPath);
      try {
        await providerStore.migrate();
        const workspace = await providerStore.getWorkspaceByKey("cli-test");
        const providerEvent = await providerStore.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "openai-sdk",
          "openai-sdk:chat.completions.create:chatcmpl_cli_test",
        );
        expect(providerEvent).toMatchObject({
          provider: "openai",
          model: "gpt-test",
          usage_kind: "chat_completion",
          input_tokens: 200,
          output_tokens: 20,
          total_tokens: 220,
          accuracy_mode: "exact",
          assignment_status: "assigned",
          pricing_mode: "rule_calculated",
          estimated_cost_nanos: 30000,
        });
        expect(codexRawUsage(providerEvent?.payload_json)).toMatchObject({
          prompt_tokens: 200,
          completion_tokens: 20,
          total_tokens: 220,
        });
      } finally {
        await providerStore.close();
      }

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
          "implement-cli-workflow-tests unassigned prompt",
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

      const secondUnassignedOutput = runCli(
        [
          "usage",
          "codex-turn",
          "--workspace",
          "cli-test",
          "--prompt-text",
          "implement-cli-workflow-tests follow up",
          "--input-chars",
          "20",
          "--output-chars",
          "40",
          "--idempotency-key",
          "unassigned-002",
        ],
        env,
      );
      const secondUsageId = secondUnassignedOutput.match(/usage_(?<id>[a-z0-9]+)/)?.[0];
      expect(secondUsageId).toBeDefined();

      const rawInboxOutput = runCli(["inbox", "list", "--workspace", "cli-test", "--events"], env);
      expect(rawInboxOutput).toContain(usageId);
      expect(rawInboxOutput).toContain("tokens=15");
      expect(rawInboxOutput).toContain("prompt=implement-cli-workflow-tests unassigned prompt");

      const groupedInboxOutput = runCli(["inbox", "list", "--workspace", "cli-test"], env);
      const groupId = groupedInboxOutput.match(/inbox_[a-f0-9]+/)?.[0];
      expect(groupId).toBeDefined();
      expect(groupedInboxOutput).toContain("implement-cli-workflow-tests high");
      expect(groupedInboxOutput).toContain("unassigned");

      const groupDetailOutput = runCli(["inbox", "show", groupId ?? "", "--workspace", "cli-test"], env);
      expect(groupDetailOutput).toContain(usageId);
      expect(groupDetailOutput).toContain(secondUsageId);
      expect(groupDetailOutput).toContain("implement-cli-workflow-tests unassigned prompt");

      expect(runCli(["inbox", "accept", groupId ?? "", "--workspace", "cli-test", "--all"], env)).toContain(
        `inbox ${groupId} assigned task=implement-cli-workflow-tests assigned=2 skipped=0`,
      );
      expect(runCli(["inbox", "list", "--workspace", "cli-test"], env).trim()).toBe(
        "No inbox groups.",
      );

      const manualUnassignedOutput = runCli(
        [
          "usage",
          "codex-turn",
          "--workspace",
          "cli-test",
          "--prompt-text",
          "manual single event",
          "--input-chars",
          "20",
          "--output-chars",
          "40",
          "--idempotency-key",
          "unassigned-003",
        ],
        env,
      );
      const manualUsageId = manualUnassignedOutput.match(/usage_(?<id>[a-z0-9]+)/)?.[0];
      expect(manualUsageId).toBeDefined();
      expect(
        runCli(
          [
            "inbox",
            "assign-event",
            manualUsageId ?? "",
            "--workspace",
            "cli-test",
            "--task",
            "implement-cli-workflow-tests",
          ],
          env,
        ),
      ).toContain(`usage ${manualUsageId} moved task_id=task_`);
      expect(runCli(["inbox", "list", "--workspace", "cli-test", "--events"], env).trim()).toBe(
        "No unassigned usage events.",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("redacts or hashes prompt snapshots without keeping original secrets", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-redaction-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      expect(runCli(["workspace", "init", "--key", "redaction-test", "--root", tempDir], env)).toContain(
        "workspace redaction-test",
      );
      runCli(
        [
          "usage",
          "chat-turn",
          "--workspace",
          "redaction-test",
          "--prompt-mode",
          "redacted",
          "--prompt-text",
          "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 send mail to owner@example.com",
          "--response-text",
          "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
          "--input-chars",
          "80",
          "--output-chars",
          "60",
          "--idempotency-key",
          "redacted-turn-001",
        ],
        env,
      );
      runCli(
        [
          "usage",
          "chat-turn",
          "--workspace",
          "redaction-test",
          "--prompt-mode",
          "hash",
          "--prompt-text",
          "keep only a hash of this prompt",
          "--input-chars",
          "40",
          "--idempotency-key",
          "hashed-turn-001",
        ],
        env,
      );

      const codexSessionFile = join(tempDir, "codex-session-redacted.jsonl");
      writeFileSync(
        codexSessionFile,
        [
          JSON.stringify({
            timestamp: "2026-04-27T01:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "019dd187-51b3-7e02-b2dc-311a2b503dd3",
              cwd: tempDir,
              originator: "Codex Desktop",
              source: "vscode",
              model_provider: "openai",
              model: "gpt-5.5",
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T01:00:01.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "use token ttok_abcdefghijklmnopqrstuvwxyz123456 and ping dev@example.com",
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-27T01:00:03.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 20,
                  output_tokens: 5,
                  total_tokens: 25,
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
            "redaction-test",
            "--file",
            codexSessionFile,
            "--prompt-mode",
            "redacted",
          ],
          env,
        ),
      ).toContain("codex import scanned_files=1 token_events=1 imported=1 skipped=0 errors=0");

      const store = new SqliteLedgerStore(dbPath);
      try {
        await store.migrate();
        const workspace = await store.getWorkspaceByKey("redaction-test");
        const redacted = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-chat",
          "redacted-turn-001",
        );
        const redactedSnapshot = promptSnapshot(redacted?.payload_json);
        expect(redactedSnapshot).toMatchObject({
          mode: "redacted",
          prompt_text: "OPENAI_API_KEY=[REDACTED:credential] send mail to [REDACTED:email]",
          response_text: "Authorization: Bearer [REDACTED:token]",
        });
        expect(redactedSnapshot?.prompt_text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
        expect(redactedSnapshot?.prompt_text).not.toContain("owner@example.com");
        expect(asRecord(redactedSnapshot?.redaction)).toMatchObject({
          method: "built_in_patterns",
          redacted: true,
        });

        const hashed = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-chat",
          "hashed-turn-001",
        );
        const hashedSnapshot = promptSnapshot(hashed?.payload_json);
        expect(hashedSnapshot?.mode).toBe("hash");
        expect(hashedSnapshot?.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(hashedSnapshot?.prompt_text).toBeUndefined();

        const imported = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "codex-session",
          "codex-session:019dd187-51b3-7e02-b2dc-311a2b503dd3:2026-04-27T01:00:03.000Z",
        );
        const importedSnapshot = promptSnapshot(imported?.payload_json);
        expect(importedSnapshot).toMatchObject({
          mode: "redacted",
          prompt_text: "use token [REDACTED:ttoksem-token] and ping [REDACTED:email]",
        });
        expect(importedSnapshot?.prompt_text).not.toContain("ttok_abcdefghijklmnopqrstuvwxyz123456");
        expect(sourceContext(imported?.payload_json)?.user_message).toBe(
          "use token [REDACTED:ttoksem-token] and ping [REDACTED:email]",
        );
      } finally {
        await store.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("records a Claude turn and imports Claude Code session JSONL events with subagents", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-claude-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      expect(runCli(["workspace", "init", "--key", "claude-test", "--root", tempDir], env)).toContain(
        "workspace claude-test",
      );
      expect(
        runCli(
          [
            "task",
            "start",
            "implement-claude-import",
            "--workspace",
            "claude-test",
            "--name",
            "Implement Claude import",
          ],
          env,
        ),
      ).toContain("task implement-claude-import active");

      const claudeTurnOutput = runCli(
        [
          "usage",
          "claude-turn",
          "--workspace",
          "claude-test",
          "--task",
          "implement-claude-import",
          "--prompt-text",
          "claude turn manual log",
          "--input-chars",
          "20",
          "--output-chars",
          "40",
          "--idempotency-key",
          "claude-turn-001",
        ],
        env,
      );
      expect(claudeTurnOutput).toContain("anthropic/claude-chat");
      expect(claudeTurnOutput).toContain("assigned");

      const sessionId = "5bc0e0da-9308-4593-aabd-d8884aa7bea6";
      const projectsDir = join(tempDir, "claude-projects");
      const projectDir = join(projectsDir, "-Users-johwanghee-Documents-hwanghee-ttoksem");
      const subagentsDir = join(projectDir, sessionId, "subagents");
      const sessionFile = join(projectDir, `${sessionId}.jsonl`);
      const subagentFile = join(subagentsDir, "agent-abc123.jsonl");
      const fs = await import("node:fs");
      fs.mkdirSync(subagentsDir, { recursive: true });
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            entrypoint: "cli",
            promptId: "p1",
            timestamp: "2026-04-29T00:10:00.000Z",
            uuid: "u-user-1",
            message: { role: "user", content: "first claude prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-1",
            timestamp: "2026-04-29T00:10:05.000Z",
            uuid: "u-asst-1",
            message: {
              id: "msg_a1",
              model: "claude-sonnet-4-6",
              usage: {
                input_tokens: 10,
                output_tokens: 50,
                cache_read_input_tokens: 1200,
                cache_creation_input_tokens: 800,
              },
            },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-2",
            timestamp: "2026-04-29T00:10:20.000Z",
            uuid: "u-asst-2",
            message: {
              id: "msg_a2",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 5, output_tokens: 30, cache_read_input_tokens: 1300 },
            },
          }),
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            promptId: "p2",
            timestamp: "2026-04-29T00:11:00.000Z",
            uuid: "u-user-2",
            message: {
              role: "user",
              content: [{ type: "text", text: "second claude prompt" }],
            },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-3",
            timestamp: "2026-04-29T00:11:05.000Z",
            uuid: "u-asst-3",
            message: {
              id: "msg_a3",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 7, output_tokens: 25 },
            },
          }),
        ].join("\n"),
      );
      writeFileSync(
        subagentFile,
        [
          JSON.stringify({
            type: "user",
            sessionId: "agent-abc123",
            cwd: tempDir,
            version: "2.0.30",
            timestamp: "2026-04-29T00:12:00.000Z",
            uuid: "sa-user-1",
            message: { role: "user", content: "subagent prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId: "agent-abc123",
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-sa-1",
            timestamp: "2026-04-29T00:12:05.000Z",
            uuid: "sa-asst-1",
            message: {
              id: "msg_sa1",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 4, output_tokens: 12 },
            },
          }),
        ].join("\n"),
      );

      expect(
        runCli(
          [
            "usage",
            "import-claude-sessions",
            "--workspace",
            "claude-test",
            "--task",
            "implement-claude-import",
            "--projects-dir",
            projectsDir,
            "--claude-home",
            tempDir,
          ],
          env,
        ),
      ).toContain("claude import scanned_files=2 assistant_events=4 imported=4 skipped=0 errors=0");

      const store = new SqliteLedgerStore(dbPath);
      try {
        await store.migrate();
        const workspace = await store.getWorkspaceByKey("claude-test");
        const firstAssistant = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "claude-session",
          `claude-session:${sessionId}:u-asst-1`,
        );
        expect(firstAssistant).toMatchObject({
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          usage_kind: "conversation_turn",
          input_tokens: 10,
          output_tokens: 50,
          accuracy_mode: "exact",
          assignment_status: "assigned",
        });
        expect(firstAssistant?.run_id).toMatch(/^run_claude_.*_prompt_0001_/);
        const firstRaw = codexRawUsage(firstAssistant?.payload_json);
        expect(firstRaw).toMatchObject({
          input_tokens: 10,
          output_tokens: 50,
          cache_read_input_tokens: 1200,
          cache_creation_input_tokens: 800,
        });
        expect(promptSnapshot(firstAssistant?.payload_json)).toMatchObject({
          mode: "full",
          prompt_text: "first claude prompt",
        });

        const sameRunAssistant = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "claude-session",
          `claude-session:${sessionId}:u-asst-2`,
        );
        const secondPromptAssistant = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "claude-session",
          `claude-session:${sessionId}:u-asst-3`,
        );
        expect(sameRunAssistant?.run_id).toBe(firstAssistant?.run_id);
        expect(secondPromptAssistant?.run_id).toMatch(/^run_claude_.*_prompt_0002_/);
        expect(secondPromptAssistant?.run_id).not.toBe(firstAssistant?.run_id);
        expect(promptSnapshot(secondPromptAssistant?.payload_json)).toMatchObject({
          mode: "full",
          prompt_text: "second claude prompt",
        });

        const subagentImported = await store.getUsageEventByIdempotency(
          workspace?.id ?? "",
          "claude-session",
          `claude-session:agent-abc123:sa-asst-1`,
        );
        expect(subagentImported).toMatchObject({
          provider: "anthropic",
          input_tokens: 4,
          output_tokens: 12,
        });
        expect(sourceContext(subagentImported?.payload_json)?.session).toMatchObject({
          is_subagent: true,
        });
      } finally {
        await store.close();
      }

      expect(
        runCli(
          [
            "usage",
            "import-claude-sessions",
            "--workspace",
            "claude-test",
            "--task",
            "implement-claude-import",
            "--projects-dir",
            projectsDir,
            "--claude-home",
            tempDir,
            "--no-subagents",
            "--dry-run",
          ],
          env,
        ),
      ).toContain("claude import scanned_files=1 assistant_events=3 imported=0 skipped=3 errors=0");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("warns but does not refuse --task on multi-prompt-group imports, and prints preview details", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-multi-group-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      runCli(["workspace", "init", "--key", "guard-test", "--root", tempDir], env);
      runCli(
        [
          "task",
          "start",
          "implement-guard",
          "--workspace",
          "guard-test",
          "--name",
          "Implement multi-prompt-group guard",
        ],
        env,
      );

      const sessionId = "guard-session-uuid";
      const sessionFile = join(tempDir, `${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            timestamp: "2026-04-29T05:00:00.000Z",
            uuid: "guard-user-1",
            message: { role: "user", content: "first goal prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-g1",
            timestamp: "2026-04-29T05:00:05.000Z",
            uuid: "guard-asst-1",
            message: {
              id: "msg_g1",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 5, output_tokens: 20 },
            },
          }),
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            timestamp: "2026-04-29T05:01:00.000Z",
            uuid: "guard-user-2",
            message: { role: "user", content: "second unrelated prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-g2",
            timestamp: "2026-04-29T05:01:05.000Z",
            uuid: "guard-asst-2",
            message: {
              id: "msg_g2",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 4, output_tokens: 18 },
            },
          }),
        ].join("\n"),
      );

      // B1 (warn-only): --task with multi-prompt-group succeeds but emits stderr warning
      const result = runCliCaptureBoth(
        [
          "usage",
          "import-claude-sessions",
          "--workspace",
          "guard-test",
          "--task",
          "implement-guard",
          "--file",
          sessionFile,
          "--claude-home",
          tempDir,
        ],
        env,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "claude import scanned_files=1 assistant_events=2 imported=2 skipped=0 errors=0",
      );
      // Preview is always printed
      expect(result.stderr).toContain("claude import preview:");
      expect(result.stderr).toContain("prompt_groups=2");
      expect(result.stderr).toContain("first goal prompt");
      expect(result.stderr).toContain("second unrelated prompt");
      // Warning content
      expect(result.stderr).toContain("claude import warning:");
      expect(result.stderr).toContain("2 distinct prompt groups");
      expect(result.stderr).toContain("usage move");

      // No --task means inbox flow, multi-group is fine and emits no warning
      const inboxFlow = runCliCaptureBoth(
        [
          "usage",
          "import-claude-sessions",
          "--workspace",
          "guard-test",
          "--file",
          sessionFile,
          "--claude-home",
          tempDir,
          "--dry-run",
        ],
        env,
      );
      expect(inboxFlow.status).toBe(0);
      expect(inboxFlow.stderr).toContain("prompt_groups=2");
      // Without --task, no warning fires even with multiple groups
      expect(inboxFlow.stderr).not.toContain("claude import warning:");

      // Single-prompt-group import with --task: no warning
      const singleGroupFile = join(tempDir, "single-group.jsonl");
      writeFileSync(
        singleGroupFile,
        [
          JSON.stringify({
            type: "user",
            sessionId: "single-session",
            cwd: tempDir,
            version: "2.0.30",
            timestamp: "2026-04-29T06:00:00.000Z",
            uuid: "single-user-1",
            message: { role: "user", content: "single goal prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId: "single-session",
            cwd: tempDir,
            version: "2.0.30",
            requestId: "req-s1",
            timestamp: "2026-04-29T06:00:05.000Z",
            uuid: "single-asst-1",
            message: {
              id: "msg_s1",
              model: "claude-sonnet-4-6",
              usage: { input_tokens: 6, output_tokens: 22 },
            },
          }),
        ].join("\n"),
      );
      const singleGroup = runCliCaptureBoth(
        [
          "usage",
          "import-claude-sessions",
          "--workspace",
          "guard-test",
          "--task",
          "implement-guard",
          "--file",
          singleGroupFile,
          "--claude-home",
          tempDir,
        ],
        env,
      );
      expect(singleGroup.status).toBe(0);
      expect(singleGroup.stdout).toContain(
        "claude import scanned_files=1 assistant_events=1 imported=1 skipped=0 errors=0",
      );
      expect(singleGroup.stderr).toContain("prompt_groups=1");
      expect(singleGroup.stderr).not.toContain("claude import warning:");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("emits a deprecation banner when running `task active`", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      runCli(["workspace", "init", "--key", "cli-test", "--root", tempDir], env);
      runCli(["task", "start", "alpha", "--workspace", "cli-test"], env);

      const result = runCliCaptureBoth(["task", "active", "--workspace", "cli-test"], env);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("alpha");
      expect(result.stderr).toContain("[deprecation]");
      expect(result.stderr).toContain("task active");
      expect(result.stderr).toContain("$TTOKSEM_TASK");
      expect(result.stderr).toContain("MIGRATION.md");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prints a TTOKSEM_TASK export hint after `task start`", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      runCli(["workspace", "init", "--key", "cli-test", "--root", tempDir], env);

      const result = runCliCaptureBoth(
        ["task", "start", "design-feature", "--workspace", "cli-test"],
        env,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("task design-feature");
      expect(result.stderr).toContain("hint:");
      expect(result.stderr).toContain("export TTOKSEM_TASK=design-feature");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("HttpLedgerClient round-trips against a real LedgerService via in-process Hono", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");

    // Boot real backing infra: SqliteLedgerStore → LedgerService.
    const { SqliteLedgerStore } = await import("@ttoksem/storage-sqlite");
    const { LedgerService } = await import("@ttoksem/core");
    const store = new SqliteLedgerStore(dbPath);
    const service = new LedgerService({ store });
    await service.init();
    await service.createWorkspace({ key: "e2e", name: "E2E", rootPath: tempDir });

    // Spin up an in-process Hono app backed by that real service.
    const { createHttpApp } = await import("@ttoksem/http");
    const app = createHttpApp({
      service,
      defaultWorkspaceKey: "e2e",
      auth: {
        mode: "access-key",
        verifyAccessToken: async () => true,
      },
    });

    // Build the HTTP client with the in-process app.fetch as the transport.
    // Hono's app.fetch expects a Request object, not a (url, init) pair, so we
    // wrap it in a fetch-compatible adapter that constructs a Request first.
    const { HttpLedgerClient } = await import("@ttoksem/ledger-http");
    const honoFetch: typeof fetch = async (input, init?) =>
      app.fetch(new Request(input as string, init as RequestInit));
    const client = new HttpLedgerClient({
      baseUrl: "http://test.invalid",
      token: "valid",
      defaultWorkspaceKey: "e2e",
      fetch: honoFetch,
    });

    try {
      // Read-side round-trip: listTasks should return [] on a fresh workspace.
      const initial = await client.listTasks({ workspace: { key: "e2e" } });
      expect(initial).toEqual([]);

      // Write-side round-trip: startTask via the client, listTasks via the client.
      const created = await client.startTask({
        workspace: { key: "e2e" },
        key: "alpha",
        name: "Alpha",
      });
      expect(created.key).toBe("alpha");

      const after = await client.listTasks({ workspace: { key: "e2e" } });
      expect(after.map((t) => t.key)).toEqual(["alpha"]);

      // Confirm the data actually lives in the local DB (via the server-side service).
      const localTasks = await service.listTasks({ workspace: { key: "e2e" } });
      expect(localTasks.map((t) => t.key)).toEqual(["alpha"]);
    } finally {
      await store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("resolves the workspace from ttoksem.config.json without --workspace", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const runDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-run-"));
    const dbPath = join(repoDir, "ttoksem.db");
    try {
      // Register workspace "cfg-proj" rooted at repoDir.
      runCli(
        ["workspace", "init", "--key", "cfg-proj", "--root", repoDir],
        { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: repoDir },
      );
      // The config file lives in runDir — a directory that is NOT a workspace root.
      writeFileSync(join(runDir, "ttoksem.config.json"), JSON.stringify({ workspace: "cfg-proj" }));
      // Run `task start` from runDir with NO --workspace. runDir is not a workspace
      // root, so the workspace can only be resolved via ttoksem.config.json.
      const out = runCli(
        ["task", "start", "cfg-task"],
        { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: runDir },
      );
      expect(out).toContain("cfg-task");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("a previously hardcoded-default command honors ttoksem.config.json", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      runCli(["workspace", "init", "--key", "cfg-proj", "--root", tempDir], env);
      writeFileSync(join(tempDir, "ttoksem.config.json"), JSON.stringify({ workspace: "cfg-proj" }));
      // `usage codex-turn` previously had a hardcoded --workspace default of "ttoksem-dev".
      // Pre-change: it resolves "ttoksem-dev", a workspace that does not exist -> errors.
      // Post-change: with the default removed it resolves "cfg-proj" from ttoksem.config.json.
      runCli(
        [
          "usage",
          "codex-turn",
          "--started-at",
          "2026-05-21T00:00:00.000Z",
          "--ended-at",
          "2026-05-21T00:00:01.000Z",
          "--input-tokens",
          "10",
          "--output-tokens",
          "5",
        ],
        env,
      );
      // The codex-turn must be recorded under cfg-proj (the config's workspace).
      // `runCli` throwing on the codex-turn line above is the RED mechanism (non-zero exit).
      // The positive assertion below is FALSE for an empty workspace (Events: 0) and TRUE
      // only when the codex-turn was actually recorded in cfg-proj.
      const report = runCli(["report", "today", "--workspace", "cfg-proj"], env);
      expect(report).toContain("Events: 1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("hook run exits non-zero with a clear error when no workspace can be resolved", async () => {
    // Verifies the guard added to `hook run`: when no --workspace flag, no
    // TTOKSEM_WORKSPACE_KEY, and no ttoksem.config.json are present, the command
    // must fail with a message mentioning ttoksem.config.json.
    const repoDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const runDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-run-"));
    const projectsDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-projects-"));
    const dbPath = join(repoDir, "ttoksem.db");
    try {
      // Register a workspace so the DB exists; the hook must still fail because
      // neither --workspace nor config is passed.
      runCli(
        ["workspace", "init", "--key", "no-config-proj", "--root", repoDir],
        { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: repoDir },
      );
      // runDir has NO ttoksem.config.json; env has no TTOKSEM_WORKSPACE_KEY.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TTOKSEM_DB: dbPath,
        INIT_CWD: runDir,
        TTOKSEM_WORKSPACE_KEY: undefined,
      };
      const result = runCliCaptureBoth(
        ["hook", "run", "--projects-dir", projectsDir],
        env,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ttoksem.config.json");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
      rmSync(projectsDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("hook run resolves workspace from ttoksem.config.json without --workspace", async () => {
    // Verifies the critical path for the installed Claude Code Stop hook which runs
    // `ttoksem hook run` with NO --workspace flag. The workspace must come from config.
    const repoDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const runDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-run-"));
    const projectsDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-projects-"));
    const dbPath = join(repoDir, "ttoksem.db");
    try {
      // Register workspace "hook-proj" rooted at repoDir.
      runCli(
        ["workspace", "init", "--key", "hook-proj", "--root", repoDir],
        { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: repoDir },
      );
      // Place the config in runDir (simulates the project directory the hook runs from).
      writeFileSync(join(runDir, "ttoksem.config.json"), JSON.stringify({ workspace: "hook-proj" }));
      // Run `hook run` from runDir with NO --workspace. projectsDir is empty (no JSONL files)
      // so import completes with 0 events. The test would throw on non-zero exit if the
      // workspace cannot be resolved (e.g. "unknown workspace" ledger error).
      const out = runCli(
        ["hook", "run", "--projects-dir", projectsDir],
        { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: runDir },
      );
      // Verify it ran in the hook-proj workspace (imported=0 just means no JSONL files present).
      expect(out).toContain("imported=0");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
      rmSync(projectsDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("ttoksem init writes ttoksem.config.json and is idempotent", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
    try {
      runCli(["init", "--key", "cfg-proj", "--yes"], env);
      const cfgPath = join(tempDir, "ttoksem.config.json");
      const written = JSON.parse(readFileSync(cfgPath, "utf8"));
      expect(written.workspace).toBe("cfg-proj");

      // Idempotent: a hand-edited config is preserved on re-run.
      writeFileSync(cfgPath, JSON.stringify({ workspace: "cfg-proj", promptMode: "hash" }));
      runCli(["init", "--key", "cfg-proj", "--yes"], env);
      const after = JSON.parse(readFileSync(cfgPath, "utf8"));
      expect(after.workspace).toBe("cfg-proj");
      expect(after.promptMode).toBe("hash");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("tsx", [cliPath, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliCaptureBoth(
  args: string[],
  env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("tsx", [cliPath, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
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

function sourceContext(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const payloadObject = asRecord(payload?.payload);
  return asRecord(payloadObject?.source_context);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
