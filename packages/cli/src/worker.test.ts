import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { registerWorkerCommands, type WranglerExec } from "./worker.js";

function harness(stdout = "[]") {
  const calls: string[][] = [];
  const exec: WranglerExec = async (args) => {
    calls.push(args);
    return { stdout, stderr: "" };
  };
  const program = new Command();
  program.exitOverride();
  registerWorkerCommands(program, exec);
  return { program, calls };
}

async function run(program: Command, args: string[]): Promise<string[]> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
    logs.push(String(m));
  });
  try {
    await program.parseAsync(args, { from: "user" });
  } finally {
    spy.mockRestore();
  }
  return logs;
}

describe("ttoksem worker key", () => {
  it("create runs an INSERT via wrangler d1 execute --remote and prints a ttok_ token", async () => {
    const { program, calls } = harness();
    const logs = await run(program, ["worker", "key", "create", "--d1", "ttoksem", "--name", "ci"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.arrayContaining(["d1", "execute", "ttoksem", "--remote", "--command"]),
    );
    const sql = calls[0][calls[0].indexOf("--command") + 1];
    expect(sql).toContain("INSERT INTO access_keys");
    expect(logs.join("\n")).toMatch(/ttok_[A-Za-z0-9_-]+/);
  });

  it("list runs a SELECT and prints rows from wrangler --json output", async () => {
    const json = JSON.stringify([
      { results: [{ id: "key_a", name: "ci", token_prefix: "ttok_x", revoked_at: null }], success: true },
    ]);
    const { program, calls } = harness(json);
    const logs = await run(program, ["worker", "key", "list", "--d1", "ttoksem"]);
    expect(calls[0]).toEqual(expect.arrayContaining(["d1", "execute", "ttoksem", "--remote", "--json"]));
    expect(logs.join("\n")).toContain("key_a");
  });

  it("revoke runs an UPDATE for the given key id", async () => {
    const { program, calls } = harness();
    await run(program, ["worker", "key", "revoke", "--d1", "ttoksem", "--id", "key_a"]);
    const sql = calls[0][calls[0].indexOf("--command") + 1];
    expect(sql).toContain("UPDATE access_keys");
    expect(sql).toContain("'key_a'");
  });

  it("create surfaces a clear error when wrangler is missing", async () => {
    const failing: WranglerExec = async () => {
      throw new Error("`wrangler` not found on PATH. Install it (`npm i -g wrangler`) and run `wrangler login` first.");
    };
    const program = new Command();
    program.exitOverride();
    registerWorkerCommands(program, failing);
    await expect(
      program.parseAsync(["worker", "key", "create", "--d1", "ttoksem"], { from: "user" }),
    ).rejects.toThrow(/wrangler/);
  });

  it("list prints (no access keys) when the D1 returns an empty result set", async () => {
    const json = JSON.stringify([{ results: [], success: true }]);
    const { program } = harness(json);
    const logs = await run(program, ["worker", "key", "list", "--d1", "ttoksem"]);
    expect(logs.join("\n")).toContain("(no access keys)");
  });

  it("list fails loudly when wrangler output is not valid JSON", async () => {
    const { program } = harness("not json — some wrangler error text");
    await expect(
      program.parseAsync(["worker", "key", "list", "--d1", "ttoksem"], { from: "user" }),
    ).rejects.toThrow(/parse wrangler/i);
  });
});
