import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { Command } from "commander";
import { generateAccessToken, hashAccessToken, tokenPrefix } from "./access-token.js";
import {
  buildInsertAccessKeySql,
  buildListAccessKeysSql,
  buildRevokeAccessKeySql,
} from "./worker-key-sql.js";

const execFileAsync = promisify(execFile);

/** Runs `wrangler` with the given args. Injectable so tests never spawn the real binary. */
export type WranglerExec = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultWranglerExec: WranglerExec = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync("wrangler", args, { encoding: "utf8" });
    return { stdout, stderr };
  } catch (error) {
    const e = error as { code?: string; stderr?: string };
    if (e.code === "ENOENT") {
      throw new Error(
        "`wrangler` not found on PATH. Install it (`npm i -g wrangler`) and run `wrangler login` first.",
      );
    }
    throw new Error(`wrangler failed: ${e.stderr?.trim() || String(error)}`);
  }
};

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

interface CreateOptions {
  d1: string;
  name?: string;
  scope: string[];
  workspaceScope: string[];
  expiresAt?: string;
}

export function registerWorkerCommands(
  program: Command,
  wranglerExec: WranglerExec = defaultWranglerExec,
): void {
  const worker = program.command("worker").description("Cloudflare Worker (D1) self-host commands");
  const key = worker.command("key").description("Manage access keys on a deployed D1");

  key
    .command("create")
    .requiredOption("--d1 <database>", "D1 database name (matches wrangler.jsonc database_name)")
    .option("--name <name>", "access key name")
    .option("--scope <scope>", "scope; repeatable (default: dashboard:read + api:write)", collect, [])
    .option("--workspace-scope <key>", "restrict to a workspace key; repeatable", collect, [])
    .option("--expires-at <iso>", "UTC ISO timestamp when the key expires")
    .description("Mint a D1 access key and print the token once")
    .action(async (options: CreateOptions) => {
      const token = generateAccessToken();
      const now = new Date().toISOString();
      const id = `key_${randomBytes(12).toString("hex")}`;
      const sql = buildInsertAccessKeySql({
        id,
        name: options.name ?? `key-${now.slice(0, 10)}`,
        tokenPrefix: tokenPrefix(token),
        tokenHash: hashAccessToken(token),
        scopes: options.scope.length > 0 ? options.scope : ["dashboard:read", "api:write"],
        workspaceKeys: options.workspaceScope.length > 0 ? options.workspaceScope : null,
        expiresAt: options.expiresAt ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await wranglerExec(["d1", "execute", options.d1, "--remote", "--command", sql]);
      console.log(`access key ${id} created on D1 "${options.d1}".`);
      console.log("token (save this — it cannot be recovered):");
      console.log(`  ${token}`);
    });

  key
    .command("list")
    .requiredOption("--d1 <database>", "D1 database name")
    .description("List access keys on a deployed D1 (no token secrets)")
    .action(async (options: { d1: string }) => {
      const { stdout } = await wranglerExec([
        "d1",
        "execute",
        options.d1,
        "--remote",
        "--json",
        "--command",
        buildListAccessKeysSql(),
      ]);
      const rows = parseD1Rows(stdout);
      if (rows.length === 0) {
        console.log("(no access keys)");
        return;
      }
      for (const row of rows) {
        console.log(
          [
            row.id,
            `name=${row.name ?? ""}`,
            `prefix=${row.token_prefix ?? ""}`,
            `scopes=${row.scopes_json ?? ""}`,
            `status=${row.revoked_at ? "revoked" : "active"}`,
          ].join("\t"),
        );
      }
    });

  key
    .command("revoke")
    .requiredOption("--d1 <database>", "D1 database name")
    .requiredOption("--id <key_id>", "access key id to revoke")
    .description("Revoke an access key on a deployed D1")
    .action(async (options: { d1: string; id: string }) => {
      const sql = buildRevokeAccessKeySql(options.id, new Date().toISOString());
      await wranglerExec(["d1", "execute", options.d1, "--remote", "--command", sql]);
      console.log(`access key ${options.id} revoked on D1 "${options.d1}".`);
    });
}

interface D1Row {
  id?: string;
  name?: string;
  token_prefix?: string;
  scopes_json?: string;
  revoked_at?: string | null;
}

/** `wrangler d1 execute --json` prints an array of result objects; pull out the rows. */
function parseD1Rows(stdout: string): D1Row[] {
  let parsed: Array<{ results?: D1Row[] }>;
  try {
    parsed = JSON.parse(stdout) as Array<{ results?: D1Row[] }>;
  } catch (err) {
    throw new Error(
      `Could not parse wrangler d1 output as JSON: ${String(err)}\n` +
        `Raw output (first 500 chars): ${stdout.slice(0, 500)}`,
    );
  }
  return parsed[0]?.results ?? [];
}
