# Worker Self-Host Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ttoksem Cloudflare Worker self-hostable — a committed `wrangler` config + deploy script, a Deploy-to-Cloudflare button, and `ttoksem worker key` commands that replace the raw-SQL D1 access-key ritual.

**Architecture:** Add `apps/worker/wrangler.jsonc` plus a deploy script; add a `ttoksem worker key create|list|revoke` CLI command group that wraps `wrangler d1 execute` (token helpers extracted from `auth.ts` into a shared module; a pure, escaped SQL builder); add a Deploy-to-Cloudflare button and rewrite the Worker-D1 doc. No Worker runtime code changes.

**Tech Stack:** TypeScript, pnpm workspace, commander, wrangler, Cloudflare D1, vitest.

Implements spec: `docs/specs/2026-05-20-worker-self-host-onboarding-design.md` (sub-project 2 of 3).

---

## File Structure

### Created
- `packages/cli/src/access-token.ts` — shared access-token helpers (`generateAccessToken`, `hashAccessToken`, `tokenPrefix`), extracted from `auth.ts`.
- `packages/cli/src/access-token.test.ts` — unit tests for the helpers.
- `packages/cli/src/worker-key-sql.ts` — pure builders for the `access_keys` INSERT/SELECT/UPDATE SQL, with SQLite string escaping.
- `packages/cli/src/worker-key-sql.test.ts` — unit tests for the SQL builders.
- `packages/cli/src/worker.ts` — `registerWorkerCommands(program)`: the `ttoksem worker key` command group.
- `packages/cli/src/worker.test.ts` — workflow tests for `worker key` (injected fake `wrangler` exec).
- `apps/worker/wrangler.jsonc` — the Worker deploy config.

### Modified
- `packages/cli/src/auth.ts` — import the token helpers from `access-token.ts` instead of defining them locally.
- `packages/cli/src/index.ts` — register `registerWorkerCommands(program)`.
- `apps/worker/package.json` — add `wrangler` devDependency + a `deploy` script.
- `docs/WORKER-D1.md` — rewrite the deployment + access-key sections.
- `README.md` — add the Deploy-to-Cloudflare button.

The `worker` command group is a self-contained new file (`worker.ts`) registered like `auth.ts`'s `registerAuthCommands`. It does NOT use the local ledger — it shells out to `wrangler` — so `registerWorkerCommands` takes only the commander `program` (plus an injectable exec for tests).

---

## Task 1: Extract shared access-token helpers

`auth.ts` defines three private token helpers. `worker key` (Task 3) needs the same logic. Extract them into a shared module so there is one implementation.

**Files:**
- Create: `packages/cli/src/access-token.ts`
- Create: `packages/cli/src/access-token.test.ts`
- Modify: `packages/cli/src/auth.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/access-token.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateAccessToken, hashAccessToken, tokenPrefix } from "./access-token.js";

describe("access-token helpers", () => {
  it("generateAccessToken returns a ttok_-prefixed token", () => {
    expect(generateAccessToken()).toMatch(/^ttok_[A-Za-z0-9_-]+$/);
  });
  it("generateAccessToken returns a unique token each call", () => {
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });
  it("hashAccessToken returns lowercase 64-char hex", () => {
    expect(hashAccessToken("ttok_example")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("hashAccessToken is deterministic", () => {
    expect(hashAccessToken("ttok_x")).toBe(hashAccessToken("ttok_x"));
  });
  it("tokenPrefix returns the first 16 characters", () => {
    const prefix = tokenPrefix("ttok_abcdefghijklmnop_extra");
    expect(prefix).toBe("ttok_abcdefghijk");
    expect(prefix).toHaveLength(16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem test -- access-token.test.ts`
Expected: FAIL — `./access-token.js` does not exist.

- [ ] **Step 3: Create `access-token.ts`**

Create `packages/cli/src/access-token.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";

/** A random access token, prefixed `ttok_`. Shown to the user once; never stored. */
export function generateAccessToken(): string {
  return `ttok_${randomBytes(32).toString("base64url")}`;
}

/** Lowercase-hex SHA-256 of a token — what is stored as `access_keys.token_hash`. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** First 16 chars of a token — stored as `token_prefix` for display/audit only. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 16);
}
```

- [ ] **Step 4: Update `auth.ts` to use the shared module**

In `packages/cli/src/auth.ts`: delete the three private functions `generateAccessToken`, `hashAccessToken`, `tokenPrefix` (near the bottom of the file). Delete the now-unused `import { createHash, randomBytes } from "node:crypto";` at the top. Add this import alongside the other imports:
```ts
import { generateAccessToken, hashAccessToken, tokenPrefix } from "./access-token.js";
```
The call sites in `createAccessKeyWithToken` (`generateAccessToken()`, `tokenPrefix(token)`, `hashAccessToken(token)`) are unchanged — they now resolve to the imported functions.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter ttoksem test && pnpm --filter ttoksem check`
Expected: PASS — the new `access-token.test.ts` plus all pre-existing CLI tests green; `tsc --noEmit` clean (confirms `auth.ts` still compiles with the imported helpers).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/access-token.ts packages/cli/src/access-token.test.ts packages/cli/src/auth.ts
git commit -m "refactor(cli): extract shared access-token helpers"
```

---

## Task 2: Access-key SQL builder

Pure functions that build the `access_keys` SQL for a deployed D1, run later via `wrangler d1 execute`. The `access_keys` columns (per `docs/ACCESS-AUTH.md`): `id, name, token_prefix, token_hash, scopes_json, workspace_keys_json, expires_at, revoked_at, last_used_at, created_at, updated_at`.

**Files:**
- Create: `packages/cli/src/worker-key-sql.ts`
- Create: `packages/cli/src/worker-key-sql.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/worker-key-sql.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  buildInsertAccessKeySql,
  buildListAccessKeysSql,
  buildRevokeAccessKeySql,
} from "./worker-key-sql.js";

const row = {
  id: "key_abc",
  name: "ci",
  tokenPrefix: "ttok_abcdefghijk",
  tokenHash: "f".repeat(64),
  scopes: ["dashboard:read", "api:write"],
  workspaceKeys: null,
  expiresAt: null,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};

describe("worker-key-sql", () => {
  it("buildInsertAccessKeySql lists the access_keys columns and values", () => {
    const sql = buildInsertAccessKeySql(row);
    expect(sql).toContain("INSERT INTO access_keys (");
    expect(sql).toContain("token_hash");
    expect(sql).toContain("'key_abc'");
    expect(sql).toContain(`'${JSON.stringify(["dashboard:read", "api:write"])}'`);
  });
  it("uses NULL for absent workspace_keys and expires_at", () => {
    const sql = buildInsertAccessKeySql(row);
    expect(sql).toMatch(/NULL/);
  });
  it("escapes single quotes in user-supplied values (no SQL injection)", () => {
    const sql = buildInsertAccessKeySql({ ...row, name: "o'brien'); DROP TABLE access_keys;--" });
    expect(sql).toContain("'o''brien''); DROP TABLE access_keys;--'");
    expect(sql).not.toContain("'o'brien'");
  });
  it("buildListAccessKeysSql selects non-secret columns only", () => {
    const sql = buildListAccessKeysSql();
    expect(sql).toContain("SELECT");
    expect(sql).toContain("access_keys");
    expect(sql).not.toContain("token_hash");
  });
  it("buildRevokeAccessKeySql sets revoked_at for the given id", () => {
    const sql = buildRevokeAccessKeySql("key_abc", "2026-05-20T01:00:00.000Z");
    expect(sql).toContain("UPDATE access_keys");
    expect(sql).toContain("revoked_at");
    expect(sql).toContain("'key_abc'");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem test -- worker-key-sql.test.ts`
Expected: FAIL — `./worker-key-sql.js` does not exist.

- [ ] **Step 3: Implement `worker-key-sql.ts`**

Create `packages/cli/src/worker-key-sql.ts`:
```ts
/**
 * Builders for `access_keys` SQL run against a deployed D1 via `wrangler d1 execute`.
 * `wrangler d1 execute` takes a raw SQL string with no bound parameters, so every
 * value is inlined — `sqlString` escapes it as a SQLite string literal.
 */

export interface AccessKeyRow {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: string[];
  workspaceKeys: string[] | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A SQLite string literal: wrap in single quotes, double any internal quote. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringOrNull(value: string | null): string {
  return value === null ? "NULL" : sqlString(value);
}

export function buildInsertAccessKeySql(row: AccessKeyRow): string {
  const columns = [
    "id",
    "name",
    "token_prefix",
    "token_hash",
    "scopes_json",
    "workspace_keys_json",
    "expires_at",
    "created_at",
    "updated_at",
  ].join(", ");
  const values = [
    sqlString(row.id),
    sqlString(row.name),
    sqlString(row.tokenPrefix),
    sqlString(row.tokenHash),
    sqlString(JSON.stringify(row.scopes)),
    row.workspaceKeys && row.workspaceKeys.length > 0
      ? sqlString(JSON.stringify(row.workspaceKeys))
      : "NULL",
    sqlStringOrNull(row.expiresAt),
    sqlString(row.createdAt),
    sqlString(row.updatedAt),
  ].join(", ");
  return `INSERT INTO access_keys (${columns}) VALUES (${values});`;
}

export function buildListAccessKeysSql(): string {
  return (
    "SELECT id, name, token_prefix, scopes_json, workspace_keys_json, " +
    "expires_at, revoked_at, last_used_at, created_at " +
    "FROM access_keys ORDER BY created_at DESC;"
  );
}

export function buildRevokeAccessKeySql(id: string, revokedAt: string): string {
  return (
    `UPDATE access_keys SET revoked_at = ${sqlString(revokedAt)}, ` +
    `updated_at = ${sqlString(revokedAt)} WHERE id = ${sqlString(id)};`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ttoksem test -- worker-key-sql.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/worker-key-sql.ts packages/cli/src/worker-key-sql.test.ts
git commit -m "feat(cli): add escaped access_keys SQL builder for D1"
```

---

## Task 3: `ttoksem worker key` commands

A `worker` command group with `key create | list | revoke`, operating on a deployed D1 by shelling out to `wrangler d1 execute --remote`. The `wrangler` invocation is injected so tests never call the real binary.

**Files:**
- Create: `packages/cli/src/worker.ts`
- Create: `packages/cli/src/worker.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/worker.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem test -- worker.test.ts`
Expected: FAIL — `./worker.js` does not exist.

- [ ] **Step 3: Implement `worker.ts`**

Create `packages/cli/src/worker.ts`:
```ts
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
  try {
    const parsed = JSON.parse(stdout) as Array<{ results?: D1Row[] }>;
    return parsed[0]?.results ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Register the command in `index.ts`**

In `packages/cli/src/index.ts`, import and call `registerWorkerCommands` next to the existing `registerInitCommand(program)` / `registerAuthCommands(...)` calls:
```ts
import { registerWorkerCommands } from "./worker.js";
// ...alongside the other command registrations...
registerWorkerCommands(program);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter ttoksem test -- worker.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 6: Typecheck, run the full CLI suite, commit**

Run: `pnpm --filter ttoksem check && pnpm --filter ttoksem test`
Expected: PASS — new tests plus all pre-existing CLI tests green.
```bash
git add packages/cli/src/worker.ts packages/cli/src/worker.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): add \`ttoksem worker key\` commands for deployed-D1 access keys"
```

---

## Task 4: `apps/worker` wrangler config + deploy wiring

Add the `wrangler` config so `apps/worker` is deployable, plus the `wrangler` devDependency and a `deploy` script.

**Files:**
- Create: `apps/worker/wrangler.jsonc`
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Create `apps/worker/wrangler.jsonc`**

Create `apps/worker/wrangler.jsonc`:
```jsonc
{
  // ttoksem Cloudflare Worker deploy config. See docs/WORKER-D1.md.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ttoksem",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "vars": {
    "TTOKSEM_WORKSPACE_KEY": "ttoksem-dev",
    "TTOKSEM_AUTH_MODE": "access-key"
  },
  "d1_databases": [
    {
      "binding": "TTOKSEM_DB",
      "database_name": "ttoksem",
      // Run `wrangler d1 create ttoksem` and paste the returned database id here.
      "database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
    }
  ]
}
```

- [ ] **Step 2: Add the `wrangler` devDependency**

Run: `pnpm --filter @ttoksem/worker add -D wrangler`
Expected: `wrangler` appears in `apps/worker/package.json` `devDependencies`.

- [ ] **Step 3: Add the `deploy` script to `apps/worker/package.json`**

In `apps/worker/package.json`, add to `scripts`:
```json
"deploy": "pnpm --filter @ttoksem/worker... build && wrangler deploy"
```
The `--filter @ttoksem/worker... build` builds the Worker's workspace dependencies (`@ttoksem/core`, `@ttoksem/http`, `@ttoksem/storage-d1`) so wrangler can bundle the entry; `wrangler deploy` then bundles `src/index.ts` and uploads.

- [ ] **Step 4: Verify the config with a dry-run**

Run: `pnpm --filter @ttoksem/worker... build && pnpm --filter @ttoksem/worker exec wrangler deploy --dry-run`
Expected: wrangler bundles the Worker and reports success WITHOUT uploading (a dry-run needs no Cloudflare auth). If it reports a missing `nodejs_compat` flag or an unresolved Node builtin, add `"compatibility_flags": ["nodejs_compat"]` to `wrangler.jsonc` and re-run. Report the actual dry-run output.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/wrangler.jsonc apps/worker/package.json pnpm-lock.yaml
git commit -m "build(worker): add wrangler.jsonc deploy config and deploy script"
```

---

## Task 5: Deploy-to-Cloudflare button + WORKER-D1.md rewrite

**Files:**
- Modify: `README.md`
- Modify: `docs/WORKER-D1.md`

- [ ] **Step 1: Add the Deploy-to-Cloudflare button to the README**

In `README.md`, add a short "Self-hosting (multi-environment)" subsection after the `## Quick Start` section, before `## MVP Checkpoint`:
```markdown
## Self-hosting (multi-environment)

To share one ledger across machines, self-host the Worker on Cloudflare (D1-backed):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ttoksem/ttoksem)

Or deploy from the CLI — see [docs/WORKER-D1.md](docs/WORKER-D1.md).
```

- [ ] **Step 2: Rewrite the deployment section of `docs/WORKER-D1.md`**

In `docs/WORKER-D1.md`, replace the "Example `wrangler.toml` shape" block (the fenced `toml` block and its surrounding sentence) with:
```markdown
The deploy config is committed at [`apps/worker/wrangler.jsonc`](../apps/worker/wrangler.jsonc). To deploy:

1. `wrangler d1 create ttoksem` — creates the D1 database and prints its id.
2. Paste that id into `apps/worker/wrangler.jsonc` (`d1_databases[0].database_id`).
3. `pnpm --filter @ttoksem/worker deploy` — builds and uploads the Worker.

Or use the one-click **Deploy to Cloudflare** button in the README, which provisions the Worker and D1 in a guided browser flow.
```

- [ ] **Step 3: Rewrite the "Issuing access keys against D1" section of `docs/WORKER-D1.md`**

Replace the entire "## Issuing access keys against D1" section (the prose, the "One-shot helper" Node snippet, the "Listing keys" and "Revoking a key" raw-SQL blocks) with:
```markdown
## Access keys on the deployed D1

The `ttoksem worker key` commands manage `access_keys` on a deployed D1 by
running SQL through `wrangler d1 execute --remote`. They need `wrangler`
installed and authenticated (`wrangler login`).

Create a key (the token is printed once — save it):

    ttoksem worker key create --d1 ttoksem --name dashboard \
      --scope dashboard:read --scope api:write

List keys (no token secrets are shown):

    ttoksem worker key list --d1 ttoksem

Revoke a key:

    ttoksem worker key revoke --d1 ttoksem --id key_xxxxxxxxxxxx

`--d1 <database>` is the D1 `database_name` from `wrangler.jsonc`. There is no
token-issuance HTTP route on the Worker on purpose — a credential-minting
endpoint would be an attack target — so keys are issued operator-side via
`wrangler`.
```
Keep the existing "### Scopes worth knowing" subsection that follows — it is still accurate.

- [ ] **Step 4: Verify the docs render and commit**

Run: `git diff --stat`
Expected: only `README.md` and `docs/WORKER-D1.md` changed.
```bash
git add README.md docs/WORKER-D1.md
git commit -m "docs: add Deploy-to-Cloudflare button and rewrite WORKER-D1 onboarding"
```

---

## Done criteria

- `pnpm -r check && pnpm -r test && pnpm -r build` all pass.
- `wrangler deploy --dry-run` bundles `apps/worker` successfully.
- `ttoksem worker key create|list|revoke` exist and are covered by tests that never invoke the real `wrangler`.
- `docs/WORKER-D1.md` no longer contains the raw-SQL access-key ritual; the README has a Deploy-to-Cloudflare button.
