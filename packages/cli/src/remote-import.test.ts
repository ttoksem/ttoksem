/**
 * remote-import.test.ts
 *
 * Verifies that `usage import-claude-sessions`, `usage import-codex-sessions`,
 * and `hook run` can write usage events to a remote ledger when
 * TTOKSEM_HTTP_URL is set.
 *
 * Architecture (macOS sandbox-compatible):
 *   The test spawns two sibling subprocesses:
 *     1. remote-import-server.ts — LedgerService HTTP server on a random port.
 *        Prints "READY:<port>" to stdout when ready.
 *     2. CLI subprocess (via execFileSync) — the command under test.
 *
 *   Sibling subprocesses can communicate over 127.0.0.1 even in environments
 *   where parent→child TCP connections are blocked (e.g. macOS sandboxing).
 *
 *   After the CLI subprocess exits, the test opens a fresh SqliteLedgerStore
 *   on the same DB path to read back the recorded events.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import { describe, it, expect } from "vitest";

const cliPath = fileURLToPath(new URL("index.ts", import.meta.url));
const serverFixturePath = fileURLToPath(new URL("remote-import-server.ts", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  try {
    return execFileSync("tsx", [cliPath, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "stdout" in e && "stderr" in e) {
      const err = e as { stdout: string; stderr: string; message: string };
      throw new Error(`${err.message}\nstdout: ${err.stdout}\nstderr: ${err.stderr}`);
    }
    throw e;
  }
}

/**
 * Spawn the server fixture as a sibling subprocess.
 * Returns the base URL and a stop function.
 * The server prints "READY:<port>" to stdout when ready.
 */
async function startRemoteServer(dbPath: string, workspaceKey: string): Promise<{
  baseUrl: string;
  /** Send SIGTERM and wait for the process to fully exit (DB lock released). */
  stop: () => Promise<void>;
}> {
  const proc: ChildProcess = spawn("tsx", [serverFixturePath, "--db-path", dbPath, "--workspace", workspaceKey], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Promise that resolves when the process exits (used by stop()).
  const exitPromise = new Promise<void>((resolve) => {
    proc.on("exit", () => resolve());
  });

  let stopped = false;
  const stopProc = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
    }
    await exitPromise;
  };

  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      // Fix 2: save the timer handle so we can clear it on success.
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for server fixture READY signal")),
        15_000,
      );
      proc.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const match = buf.match(/READY:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${parseInt(match[1], 10)}`);
        }
      });
      proc.on("error", (err) => { clearTimeout(timer); reject(err); });
      proc.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timer);
          reject(new Error(`Server fixture exited prematurely with code ${code}`));
        }
      });
    });
    return { baseUrl, stop: stopProc };
  } catch (e) {
    // Fix 3: kill the spawned process if READY-signal promise rejects.
    await stopProc();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("importers in remote mode", () => {
  it("usage import-claude-sessions writes to the remote ledger", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-remote-claude-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const workspaceKey = "ttoksem-dev";
    const { baseUrl, stop } = await startRemoteServer(dbPath, workspaceKey);

    try {
      // Build a fake Claude Code project dir with one session JSONL
      const sessionId = "remote-claude-session-0001";
      const projectsDir = join(tempDir, "projects", "-Users-remote-claude-test");
      mkdirSync(projectsDir, { recursive: true });
      const sessionFile = join(projectsDir, `${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: "user",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            promptId: "p1",
            timestamp: "2026-05-20T00:01:00.000Z",
            uuid: "rc-user-1",
            message: { role: "user", content: "remote mode test prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "rc-req-1",
            timestamp: "2026-05-20T00:01:05.000Z",
            uuid: "rc-asst-1",
            message: {
              id: "msg_rc1",
              model: "claude-sonnet-4-6",
              usage: {
                input_tokens: 20,
                output_tokens: 55,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
        ].join("\n"),
      );

      // Run the CLI with TTOKSEM_HTTP_URL set → remote mode
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TTOKSEM_HTTP_URL: baseUrl,
        // Fix 4: setting a key to `undefined` makes execFileSync omit it from the
        // child environment, preventing the CLI from falling back to a local DB.
        TTOKSEM_DB: undefined as unknown as string,
        INIT_CWD: tempDir,
      };
      const output = runCli(
        [
          "usage",
          "import-claude-sessions",
          "--workspace",
          workspaceKey,
          "--projects-dir",
          projectsDir,
        ],
        env,
      );
      expect(output).toContain("imported=1");

      // Verify: the event landed in the server-side store.
      // Stop the server first so SQLite releases its locks before we read.
      await stop();

      // Fix 5: wrap verifyStore usage in try/finally so close() runs even on assertion failure.
      const verifyStore = new SqliteLedgerStore(dbPath);
      try {
        // Fix 1: hard throw instead of expect+?? so a null workspace surfaces immediately.
        const workspace = await verifyStore.getWorkspaceByKey(workspaceKey);
        if (!workspace) throw new Error(`workspace '${workspaceKey}' not found in verify store`);
        const events = await verifyStore.listRecentUsageEvents(workspace.id, 50);
        expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(true);
      } finally {
        await verifyStore.close();
      }
    } finally {
      await stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("usage import-codex-sessions writes to the remote ledger", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-remote-codex-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const workspaceKey = "ttoksem-dev";
    const { baseUrl, stop } = await startRemoteServer(dbPath, workspaceKey);

    try {
      // Build a fake Codex session JSONL file
      const codexSessionFile = join(tempDir, "codex-session.jsonl");
      writeFileSync(
        codexSessionFile,
        [
          JSON.stringify({
            timestamp: "2026-05-20T00:02:00.000Z",
            type: "session_meta",
            payload: {
              id: "remote-codex-session-0001",
              cwd: tempDir,
              originator: "Codex Desktop",
              cli_version: "0.125.0-alpha.3",
              source: "vscode",
              model_provider: "openai",
            },
          }),
          JSON.stringify({
            timestamp: "2026-05-20T00:02:01.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "remote codex test prompt",
              images: [],
              local_images: [],
              text_elements: [],
            },
          }),
          JSON.stringify({
            timestamp: "2026-05-20T00:02:05.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 500,
                  cached_input_tokens: 0,
                  output_tokens: 30,
                  reasoning_output_tokens: 0,
                  total_tokens: 530,
                },
              },
            },
          }),
        ].join("\n"),
      );

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TTOKSEM_HTTP_URL: baseUrl,
        // Fix 4: setting a key to `undefined` makes execFileSync omit it from the
        // child environment, preventing the CLI from falling back to a local DB.
        TTOKSEM_DB: undefined as unknown as string,
        INIT_CWD: tempDir,
      };
      const output = runCli(
        [
          "usage",
          "import-codex-sessions",
          "--workspace",
          workspaceKey,
          "--file",
          codexSessionFile,
          "--model",
          "codex-app",
        ],
        env,
      );
      expect(output).toContain("imported=1");

      // Verify: the event landed in the server-side store.
      await stop();

      // Fix 5: wrap verifyStore usage in try/finally so close() runs even on assertion failure.
      const verifyStore = new SqliteLedgerStore(dbPath);
      try {
        // Fix 1: hard throw instead of expect+?? so a null workspace surfaces immediately.
        const workspace = await verifyStore.getWorkspaceByKey(workspaceKey);
        if (!workspace) throw new Error(`workspace '${workspaceKey}' not found in verify store`);
        const events = await verifyStore.listRecentUsageEvents(workspace.id, 50);
        expect(events.length).toBeGreaterThan(0);
      } finally {
        await verifyStore.close();
      }
    } finally {
      await stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("hook run writes project-scoped Claude session usage to the remote ledger", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-remote-hook-"));
    const dbPath = join(tempDir, "ttoksem.db");
    const workspaceKey = "ttoksem-dev";
    const { baseUrl, stop } = await startRemoteServer(dbPath, workspaceKey);

    try {
      // Build a fake Claude Code project dir
      const sessionId = "remote-hook-session-0001";
      const fakeProjectDir = join(tempDir, "projects", "-Users-remote-hook-test");
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
            timestamp: "2026-05-20T00:03:00.000Z",
            uuid: "rh-user-1",
            message: { role: "user", content: "hook remote test prompt" },
          }),
          JSON.stringify({
            type: "assistant",
            sessionId,
            cwd: tempDir,
            version: "2.0.30",
            requestId: "rh-req-1",
            timestamp: "2026-05-20T00:03:05.000Z",
            uuid: "rh-asst-1",
            message: {
              id: "msg_rh1",
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

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TTOKSEM_HTTP_URL: baseUrl,
        // Fix 4: setting a key to `undefined` makes execFileSync omit it from the
        // child environment, preventing the CLI from falling back to a local DB.
        TTOKSEM_DB: undefined as unknown as string,
        INIT_CWD: tempDir,
      };
      const output = runCli(
        [
          "hook",
          "run",
          "--workspace",
          workspaceKey,
          "--projects-dir",
          fakeProjectDir,
        ],
        env,
      );
      expect(output).toContain("imported=1");

      // Verify: the event landed in the server-side store.
      await stop();

      // Fix 5: wrap verifyStore usage in try/finally so close() runs even on assertion failure.
      const verifyStore = new SqliteLedgerStore(dbPath);
      try {
        // Fix 1: hard throw instead of expect+?? so a null workspace surfaces immediately.
        const workspace = await verifyStore.getWorkspaceByKey(workspaceKey);
        if (!workspace) throw new Error(`workspace '${workspaceKey}' not found in verify store`);
        const events = await verifyStore.listRecentUsageEvents(workspace.id, 50);
        expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(true);
      } finally {
        await verifyStore.close();
      }
    } finally {
      await stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
