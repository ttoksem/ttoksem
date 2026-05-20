import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasTtoksemStopHook } from "./settings-merge.js";

const cliPath = fileURLToPath(new URL("index.ts", import.meta.url));

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): string {
  return execFileSync("tsx", [cliPath, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("ttoksem init", () => {
  it("creates the workspace and installs the Stop hook with --yes when .claude/ exists", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ttoksem-init-test-"));
    // Create .claude/ directory to simulate a Claude Code project
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    const env = { ...process.env, INIT_CWD: tmp };
    try {
      const output = runCli(["init", "--key", "ws", "--yes"], env);
      // DB and workspace created
      expect(existsSync(join(tmp, ".ttoksem", "ttoksem.db"))).toBe(true);
      // settings.json written with Stop hook
      const settingsPath = join(tmp, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      expect(
        hasTtoksemStopHook(settings as Parameters<typeof hasTtoksemStopHook>[0]),
      ).toBe(true);
      // Output should mention hook installed
      expect(output).toContain("ttoksem hook run");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it("is idempotent: running init twice does not duplicate the workspace or the hook", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ttoksem-init-reuse-"));
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    const env = { ...process.env, INIT_CWD: tmp };
    try {
      // First run
      runCli(["init", "--key", "ws-reuse", "--yes"], env);
      // Second run — must not throw
      expect(() => runCli(["init", "--key", "ws-reuse", "--yes"], env)).not.toThrow();
      // Still exactly one hook group in the Stop array
      const settingsPath = join(tmp, ".claude", "settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        hooks?: { Stop?: Array<{ hooks: unknown[] }> };
      };
      const stopGroups = settings.hooks?.Stop ?? [];
      const hookCommands = stopGroups.flatMap((g) => g.hooks);
      // Only one ttoksem hook command should be present
      const ttoksemHooks = hookCommands.filter(
        (h) =>
          typeof h === "object" &&
          h !== null &&
          "command" in h &&
          typeof (h as { command: unknown }).command === "string" &&
          ((h as { command: string }).command).includes("ttoksem hook run"),
      );
      expect(ttoksemHooks).toHaveLength(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it("creates the DB and workspace but skips settings.json when no .claude/ directory exists", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ttoksem-init-noclaude-"));
    // No .claude/ directory here
    const env = { ...process.env, INIT_CWD: tmp };
    try {
      const output = runCli(["init", "--key", "ws2", "--yes"], env);
      // DB and workspace created
      expect(existsSync(join(tmp, ".ttoksem", "ttoksem.db"))).toBe(true);
      // No settings.json written
      expect(existsSync(join(tmp, ".claude", "settings.json"))).toBe(false);
      // Output says hook setup skipped
      expect(output).toContain("No .claude/");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it("creates workspace but skips hook when consent is not given (no --yes, non-TTY stdin)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ttoksem-init-nonconsent-"));
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Non-TTY stdin is guaranteed by execFileSync "ignore"
    const env = { ...process.env, INIT_CWD: tmp };
    try {
      // No --yes flag — stdin is "ignore" (not a TTY), so confirm() returns false
      const output = runCli(["init", "--key", "ws3"], env);
      // DB and workspace created
      expect(existsSync(join(tmp, ".ttoksem", "ttoksem.db"))).toBe(true);
      // No hook written
      const settingsPath = join(tmp, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(false);
      // Output says hook skipped
      expect(output).toContain("Skipped");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it("skips hook install and leaves settings.json untouched when it contains invalid JSON", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ttoksem-init-badjson-"));
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    writeFileSync(join(tmp, ".claude", "settings.json"), "{ not valid json", "utf8");
    const env = { ...process.env, INIT_CWD: tmp };
    try {
      runCli(["init", "--key", "ws-bad", "--yes"], env);
      expect(existsSync(join(tmp, ".ttoksem", "ttoksem.db"))).toBe(true);
      expect(readFileSync(join(tmp, ".claude", "settings.json"), "utf8")).toBe("{ not valid json");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);
});
