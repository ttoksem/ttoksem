# Local Install Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ttoksem installable by a non-contributor developer via `npm install -g ttoksem` then `ttoksem init`, with no native-build failures.

**Architecture:** Remove the `better-sqlite3` native dependency by switching the local storage adapter to Node's built-in `node:sqlite`; add a `ttoksem hook run` subcommand that wraps the existing Claude-session importer; add a guided `ttoksem init` command that creates the workspace and (with consent) installs a Claude Code Stop hook calling `ttoksem hook run`; bundle the CLI to a single dependency-free artifact with esbuild and publish it to npm.

**Tech Stack:** TypeScript, pnpm workspace, commander, node:sqlite, esbuild, vitest, Hono (existing).

Implements spec: `docs/specs/2026-05-20-local-install-onboarding-design.md` (sub-project 1 of 3).

---

## File Structure

### Modified
- `packages/storage-sqlite/src/index.ts` — swap `better-sqlite3` driver → `node:sqlite`.
- `packages/storage-sqlite/src/migration-0008.test.ts` — same swap (imports the driver directly).
- `packages/storage-sqlite/package.json` — drop `better-sqlite3` deps; add `engines`.
- `pnpm-workspace.yaml` — drop `better-sqlite3` from `onlyBuiltDependencies`.
- `packages/cli/src/index.ts` — register the `hook` and `init` commands.
- `packages/cli/package.json` — rename to `ttoksem`; esbuild devDep; bundle scripts; publishable fields.
- `package.json` (root) — update the `cli` script's `--filter` to the new package name.
- `README.md` — new "Quick Start" section.

### Created
- `packages/cli/src/settings-merge.ts` — pure helper to merge a Stop-hook entry into a `.claude/settings.json` object.
- `packages/cli/src/settings-merge.test.ts` — unit tests for the merge helper.
- `packages/cli/src/init.ts` — `registerInitCommand(program)`: the `ttoksem init` command.
- `packages/cli/src/init.test.ts` — workflow tests for `ttoksem init`.
- `packages/cli/src/hook.test.ts` — workflow test for `ttoksem hook run`.
- `packages/cli/esbuild.mjs` — esbuild bundle script.

The `hook` command is registered inside `index.ts` (not a separate file) because it must call the private `importClaudeSessions` function defined there. `init` is a separate file because it is self-contained and only depends on `@ttoksem/core` + `@ttoksem/storage-sqlite`.

---

## Task 1: Migrate `@ttoksem/storage-sqlite` from `better-sqlite3` to `node:sqlite`

Removes the only native dependency. The existing test suite (`index.test.ts`, 7 tests; `migration-0008.test.ts`, 1 test) is the behavioral oracle — it must stay green.

**Files:**
- Modify: `packages/storage-sqlite/src/index.ts` (1589 lines, class `SqliteLedgerStore`)
- Modify: `packages/storage-sqlite/src/migration-0008.test.ts` (imports `better-sqlite3` directly)
- Modify: `packages/storage-sqlite/package.json`
- Modify: `pnpm-workspace.yaml`
- Unchanged oracle: `packages/storage-sqlite/src/index.test.ts`

- [ ] **Step 1: Verify `node:sqlite` works on the dev Node version**

Run: `node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(':memory:'); d.exec('CREATE TABLE t(x)'); d.prepare('INSERT INTO t VALUES(?)').run(1); console.log('rows', d.prepare('SELECT count(*) c FROM t').get().c)"`
Expected: prints `rows 1` (an `ExperimentalWarning` line on stderr is acceptable; it is suppressed in Task 5). If `node:sqlite` is missing, the Node version is < 22.5 — install Node ≥ 22.5 before continuing.

- [ ] **Step 2: Run the existing storage suite to confirm the green baseline**

Run: `pnpm --filter @ttoksem/storage-sqlite test`
Expected: PASS — 8 tests green (7 in `index.test.ts`, 1 in `migration-0008.test.ts`). This is the baseline the migration must preserve.

- [ ] **Step 3: Migrate the driver in `src/index.ts`**

Apply these transformations across the whole file. They are mechanical and exhaustive — `better-sqlite3` is used only via the APIs listed.

Import (line 1):
```ts
// before
import Database from "better-sqlite3";
// after
import { DatabaseSync } from "node:sqlite";
```

Field type (line ~43) and the 4 module-helper signatures (`addColumnIfMissing`, `hasColumn`, `columnNames`, and any other taking `db: Database.Database`):
```ts
// before:  private readonly db: Database.Database;   /   db: Database.Database
// after:   private readonly db: DatabaseSync;        /   db: DatabaseSync
```

Construction (line ~46):
```ts
// before
this.db = new Database(path);
// after
this.db = new DatabaseSync(path);
```

Pragmas — `node:sqlite` has no `.pragma()`. Replace every `this.db.pragma("X")` with `this.db.exec("PRAGMA X")` (all 8 sites, including the `foreign_keys = OFF`/`ON` toggles):
```ts
// before
this.db.pragma("journal_mode = WAL");
this.db.pragma("foreign_keys = ON");
// after
this.db.exec("PRAGMA journal_mode = WAL");
this.db.exec("PRAGMA foreign_keys = ON");
```

Transaction — `node:sqlite` has no `.transaction()` helper. The single call site (line ~284, `this.db.transaction(() => { ... })()`) becomes an explicit transaction:
```ts
// before
this.db.transaction(() => {
  /* ...migration body... */
})();
// after
this.db.exec("BEGIN");
try {
  /* ...migration body (unchanged)... */
  this.db.exec("COMMIT");
} catch (error) {
  this.db.exec("ROLLBACK");
  throw error;
}
```

`.changes` checks — `node:sqlite`'s `.run()` returns `changes` as `number | bigint`. The 5 sites of the form `if (result.changes === 0)` become:
```ts
// before
if (result.changes === 0) { /* throw ... */ }
// after
if (Number(result.changes) === 0) { /* throw ... */ }
```

Unchanged: `.prepare()`, `.exec()`, `.run()`, `.get()`, `.all()`, `.close()` exist on `DatabaseSync` / `StatementSync` with identical names and call shapes. Named parameters (`@name` in SQL, bare-key binding objects like `{ id, key }`) and positional `?` parameters (spread scalar args) both work unchanged — `node:sqlite` allows bare named parameters by default.

- [ ] **Step 4: Migrate the driver in `src/migration-0008.test.ts`**

This test imports `better-sqlite3` directly to pre-seed and verify an old-schema DB. Apply the same transformations: `import Database from "better-sqlite3"` → `import { DatabaseSync } from "node:sqlite"`; `new Database(path)` → `new DatabaseSync(path)`; `.pragma("X")` → `.exec("PRAGMA X")`. Its `.prepare()/.run()/.all()/.get()/.close()` calls are unchanged. `PRAGMA table_info(...)` / `PRAGMA index_list(...)` reads stay as `.prepare("PRAGMA ...").all()` (already statement-based, not `.pragma()`).

- [ ] **Step 5: Update `packages/storage-sqlite/package.json`**

Remove `better-sqlite3` from `dependencies` and `@types/better-sqlite3` from `devDependencies`. Add an `engines` field:
```json
"engines": { "node": ">=22.5.0" }
```

- [ ] **Step 6: Update `pnpm-workspace.yaml`**

Remove the `better-sqlite3` line from `onlyBuiltDependencies` (esbuild stays). Then run `pnpm install` to drop the package from the lockfile.
Run: `pnpm install`
Expected: completes; `better-sqlite3` no longer in `node_modules`.

- [ ] **Step 7: Run the storage suite — it must be green**

Run: `pnpm --filter @ttoksem/storage-sqlite test`
Expected: PASS — the same 8 tests, all green. If a parameter-binding error appears, call `.setAllowBareNamedParameters(true)` on the failing prepared statement and re-run. If any test fails, fix the migration; do not alter the tests' assertions.

- [ ] **Step 8: Typecheck and build the dependents**

Run: `pnpm -r check && pnpm -r build`
Expected: PASS — `@ttoksem/core`, `@ttoksem/cli`, `apps/server`, `apps/worker` all still typecheck and build (the `LedgerStore` interface is unchanged).

- [ ] **Step 9: Commit**

```bash
git add packages/storage-sqlite pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "refactor(storage-sqlite): swap better-sqlite3 for node:sqlite"
```

---

## Task 2: Add the `ttoksem hook run` subcommand

A CLI subcommand that replaces the bespoke `ttoksem-autocapture.sh` script: it imports the current project's Claude Code session usage into the local ledger. Scope per spec: active-task lookup, incremental `--since`, project scoping. The script's threshold / `asyncRewake` drift-warning behavior is intentionally **out of scope** for v1.

**Files:**
- Modify: `packages/cli/src/index.ts` (register the `hook` command; add the stdin helper)
- Create: `packages/cli/src/hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/hook.test.ts`. Follow the CLI-invocation pattern already used in `packages/cli/src/index.test.ts` (read that file for how it builds the program and runs a command in-process against a temp DB). The test must:
1. Create a temp dir; set the working dir / `INIT_CWD` so the ledger DB lands at `<temp>/.ttoksem/ttoksem.db`.
2. Create a workspace (`ttoksem-dev`) in that DB.
3. Create a fake Claude Code project dir `<temp>/projects/<encoded>` containing one `*.jsonl` session file with at least one `assistant` event carrying `message.usage` (reuse a fixture shape from the existing Claude-import tests in `index.test.ts`).
4. Run the CLI with `hook run --workspace ttoksem-dev --projects-dir <temp>/projects/<encoded>`.
5. Assert: the run exits without throwing, and the workspace now has ≥ 1 imported `claude-session` usage event (query via the store/service).

```ts
import { describe, it, expect } from "vitest";
// ...imports mirroring index.test.ts harness...

describe("ttoksem hook run", () => {
  it("imports project-scoped Claude session usage into the local ledger", async () => {
    // 1-3: temp DB + workspace + fake project jsonl  (see index.test.ts patterns)
    // 4: run `hook run --workspace ttoksem-dev --projects-dir <fakeProjectDir>`
    // 5:
    const events = await store.listRecentUsageEvents(workspaceId, 50);
    expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ttoksem/cli test -- hook.test.ts`
Expected: FAIL — the `hook` command does not exist (`commander` reports unknown command, or the assertion fails).

- [ ] **Step 3: Add the stdin helper to `index.ts`**

Claude Code Stop hooks deliver a JSON payload on stdin containing `transcript_path`. Add this helper near the other module-level helpers in `index.ts` (ensure `dirname` is imported from `node:path`):

```ts
async function projectsDirFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as { transcript_path?: string };
    return payload.transcript_path ? dirname(payload.transcript_path) : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Register the `hook run` command in `index.ts`**

Add near the other top-level command registrations. It reuses the existing private `importClaudeSessions(service, options)` function and the `ClaudeSessionImportOptions` interface:

```ts
const hook = program.command("hook").description("Claude Code hook integration");
hook
  .command("run")
  .description("Autocapture: import this project's Claude Code session usage")
  .option("--workspace <key>", "workspace key", "ttoksem-dev")
  .option("--projects-dir <path>", "Claude Code project dir (overrides stdin; for manual runs)")
  .action(async (options: { workspace: string; projectsDir?: string }) => {
    const projectsDir = options.projectsDir ?? (await projectsDirFromStdin());
    if (!projectsDir) {
      console.error("ttoksem hook run: no project dir (no --projects-dir and no hook stdin payload)");
      return;
    }
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const since = await service.getLastImportedAt({
        workspace: { key: options.workspace },
        source: "claude-session",
      });
      const importOptions: ClaudeSessionImportOptions = {
        workspace: options.workspace,
        task: process.env.TTOKSEM_TASK || undefined,
        projectsDir,
        claudeHome: process.env.CLAUDE_HOME ?? "~/.claude",
        model: "claude-app",
        promptMode: "full",
        subagents: true,
        since: since ?? undefined,
      };
      const result = await importClaudeSessions(service, importOptions);
      console.log(`ttoksem hook run imported=${result.imported} skipped=${result.skipped} errors=${result.errors}`);
    } finally {
      await handle.close();
    }
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ttoksem/cli test -- hook.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ttoksem/cli check`
Expected: PASS.
```bash
git add packages/cli/src/index.ts packages/cli/src/hook.test.ts
git commit -m "feat(cli): add `ttoksem hook run` autocapture subcommand"
```

---

## Task 3: Add the settings-merge helper

A pure, unit-tested helper that merges a ttoksem Stop-hook entry into a parsed `.claude/settings.json` object, preserving other hooks and staying idempotent.

**Files:**
- Create: `packages/cli/src/settings-merge.ts`
- Create: `packages/cli/src/settings-merge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/settings-merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeTtoksemStopHook, hasTtoksemStopHook } from "./settings-merge.js";

describe("settings-merge", () => {
  it("adds a Stop hook to empty settings", () => {
    const merged = mergeTtoksemStopHook({}, "ttoksem hook run --workspace ws");
    expect(merged.hooks?.Stop?.[0]?.hooks[0]?.command).toBe("ttoksem hook run --workspace ws");
    expect(hasTtoksemStopHook(merged)).toBe(true);
  });

  it("preserves a pre-existing non-ttoksem Stop hook", () => {
    const existing = {
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command" as const, command: "other.sh" }] }] },
    };
    const merged = mergeTtoksemStopHook(existing, "ttoksem hook run --workspace ws");
    const cmds = merged.hooks!.Stop![0].hooks.map((h) => h.command);
    expect(cmds).toContain("other.sh");
    expect(cmds).toContain("ttoksem hook run --workspace ws");
  });

  it("is idempotent — re-merging does not duplicate the ttoksem hook", () => {
    let s = mergeTtoksemStopHook({}, "ttoksem hook run --workspace ws");
    s = mergeTtoksemStopHook(s, "ttoksem hook run --workspace ws");
    const ttoksemHooks = s.hooks!.Stop![0].hooks.filter((h) => h.command.includes("ttoksem hook run"));
    expect(ttoksemHooks).toHaveLength(1);
  });

  it("preserves unrelated top-level keys", () => {
    const merged = mergeTtoksemStopHook({ $schema: "x" }, "ttoksem hook run --workspace ws");
    expect(merged.$schema).toBe("x");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ttoksem/cli test -- settings-merge.test.ts`
Expected: FAIL — `./settings-merge.js` does not exist.

- [ ] **Step 3: Implement `settings-merge.ts`**

Create `packages/cli/src/settings-merge.ts`:

```ts
export interface HookEntry {
  type: "command";
  command: string;
  asyncRewake?: boolean;
  timeout?: number;
}

export interface MatcherGroup {
  matcher: string;
  hooks: HookEntry[];
}

export interface ClaudeSettings {
  $schema?: string;
  hooks?: { Stop?: MatcherGroup[] } & Record<string, MatcherGroup[] | undefined>;
  [key: string]: unknown;
}

const TTOKSEM_HOOK_MARKER = "ttoksem hook run";

export function hasTtoksemStopHook(settings: ClaudeSettings): boolean {
  return (settings.hooks?.Stop ?? []).some((group) =>
    group.hooks.some((h) => h.type === "command" && h.command.includes(TTOKSEM_HOOK_MARKER)),
  );
}

export function mergeTtoksemStopHook(settings: ClaudeSettings, command: string): ClaudeSettings {
  const entry: HookEntry = { type: "command", command, asyncRewake: true, timeout: 60 };
  const next: ClaudeSettings = { ...settings };
  const hooks = { ...(next.hooks ?? {}) };
  const stop: MatcherGroup[] = [...(hooks.Stop ?? [])];

  const groupIndex = stop.findIndex((g) => g.matcher === "");
  if (groupIndex === -1) {
    stop.push({ matcher: "", hooks: [entry] });
  } else {
    const group = { ...stop[groupIndex] };
    const kept = group.hooks.filter(
      (h) => !(h.type === "command" && h.command.includes(TTOKSEM_HOOK_MARKER)),
    );
    group.hooks = [...kept, entry];
    stop[groupIndex] = group;
  }

  hooks.Stop = stop;
  next.hooks = hooks;
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ttoksem/cli test -- settings-merge.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/settings-merge.ts packages/cli/src/settings-merge.test.ts
git commit -m "feat(cli): add idempotent .claude/settings.json hook-merge helper"
```

---

## Task 4: Add the `ttoksem init` command

A guided onboarding command: create or reuse the local workspace + DB, detect a Claude Code project, and — with consent — install the autocapture Stop hook.

**Files:**
- Create: `packages/cli/src/init.ts`
- Create: `packages/cli/src/init.test.ts`
- Modify: `packages/cli/src/index.ts` (call `registerInitCommand(program)`)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/init.test.ts`. Use temp dirs; drive the command in-process following the `index.test.ts` harness pattern. Cover:
1. **Fresh workspace** — run `init --key ws --yes` in a temp dir with a `.claude/` directory present; assert `<temp>/.ttoksem/ttoksem.db` exists, the workspace `ws` exists, and `<temp>/.claude/settings.json` now contains a `Stop` hook whose command includes `ttoksem hook run`.
2. **Reuse** — run `init` again; assert it does not throw and does not create a second workspace or duplicate the hook.
3. **No `.claude/`** — run `init --key ws2 --yes` in a temp dir with no `.claude/`; assert the DB + workspace are created and no `settings.json` is written.
4. **Consent declined** — run `init --key ws3` non-interactively (no `--yes`, no TTY); assert the workspace is created but no hook is installed (`hasTtoksemStopHook` is false / no `settings.json`).

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
// ...harness imports mirroring index.test.ts...
import { hasTtoksemStopHook } from "./settings-merge.js";

describe("ttoksem init", () => {
  it("creates the workspace and installs the hook with --yes", async () => {
    // temp dir with .claude/ ; run `init --key ws --yes`
    expect(existsSync(`${tmp}/.ttoksem/ttoksem.db`)).toBe(true);
    const settings = JSON.parse(readFileSync(`${tmp}/.claude/settings.json`, "utf8"));
    expect(hasTtoksemStopHook(settings)).toBe(true);
  });
  // ...reuse, no-.claude, consent-declined cases...
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ttoksem/cli test -- init.test.ts`
Expected: FAIL — `./init.js` does not exist / `init` is an unknown command.

- [ ] **Step 3: Implement `init.ts`**

Create `packages/cli/src/init.ts`:

```ts
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { LedgerService } from "@ttoksem/core";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import { hasTtoksemStopHook, mergeTtoksemStopHook, type ClaudeSettings } from "./settings-merge.js";

function startDir(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Set up ttoksem in the current project")
    .option("--key <key>", "workspace key (default: current directory name)")
    .option("--name <name>", "workspace display name")
    .option("--yes", "install the autocapture hook without prompting")
    .action(async (options: { key?: string; name?: string; yes?: boolean }) => {
      const cwd = startDir();
      const dbPath = join(cwd, ".ttoksem", "ttoksem.db");
      const key = options.key ?? slugify(cwd.split("/").filter(Boolean).at(-1) ?? "workspace");

      // 1. Workspace + DB (reuse if present).
      mkdirSync(dirname(dbPath), { recursive: true });
      const store = new SqliteLedgerStore(dbPath);
      const service = new LedgerService({ store });
      await service.init();
      const existing = await store.getWorkspaceByKey(key);
      if (existing) {
        console.log(`Reusing workspace "${key}".`);
      } else {
        await service.createWorkspace({ key, name: options.name ?? key, rootPath: cwd });
        console.log(`Created workspace "${key}" at ${dbPath}.`);
      }

      // 2. Claude Code project detection.
      const claudeDir = join(cwd, ".claude");
      if (!existsSync(claudeDir)) {
        console.log("No .claude/ directory here — skipping autocapture hook setup.");
        console.log("Re-run `ttoksem init` after you start using Claude Code in this project.");
        return;
      }

      // 3. Hook install (consent-gated, idempotent).
      const settingsPath = join(claudeDir, "settings.json");
      let settings: ClaudeSettings = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, "utf8")) as ClaudeSettings;
        } catch {
          console.error(`Could not parse ${settingsPath}; leaving it untouched.`);
          return;
        }
      }
      if (hasTtoksemStopHook(settings)) {
        console.log("Autocapture hook already installed.");
        return;
      }
      const consent = options.yes === true || (await confirm("Install the ttoksem autocapture hook into .claude/settings.json?"));
      if (!consent) {
        console.log("Skipped. Re-run `ttoksem init` to install it later.");
        return;
      }
      const merged = mergeTtoksemStopHook(settings, `ttoksem hook run --workspace ${key}`);
      writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      console.log(`Installed autocapture hook into ${settingsPath}.`);
    });
}
```

- [ ] **Step 4: Wire `registerInitCommand` into `index.ts`**

In `packages/cli/src/index.ts`, import and call it alongside the existing `registerAuthCommands(program)` call:
```ts
import { registerInitCommand } from "./init.js";
// ...after the program is created and other commands registered...
registerInitCommand(program);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ttoksem/cli test -- init.test.ts`
Expected: PASS — all 4 cases green.

- [ ] **Step 6: Typecheck, run the full CLI suite, commit**

Run: `pnpm --filter @ttoksem/cli check && pnpm --filter @ttoksem/cli test`
Expected: PASS — new tests plus the pre-existing `index.test.ts` suite all green.
```bash
git add packages/cli/src/init.ts packages/cli/src/init.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): add guided `ttoksem init` onboarding command"
```

---

## Task 5: Bundle the CLI with esbuild and make the package publishable

Produce a single dependency-free `dist/cli.mjs` and turn `@ttoksem/cli` into a publishable `ttoksem` package.

**Files:**
- Create: `packages/cli/esbuild.mjs`
- Modify: `packages/cli/package.json`
- Modify: `package.json` (root) — the `cli` script's filter

- [ ] **Step 1: Add `esbuild` as a devDependency**

Run: `pnpm --filter @ttoksem/cli add -D esbuild`
Expected: `esbuild` appears in `packages/cli/package.json` `devDependencies`.

- [ ] **Step 2: Create the esbuild bundle script**

Create `packages/cli/esbuild.mjs`:

```js
import { build } from "esbuild";

await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.5",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env -S node --disable-warning=ExperimentalWarning" },
  // node: builtins (incl. node:sqlite) stay external automatically on platform:node.
});

console.log("bundled -> dist/cli.mjs");
```

The entry is the tsc-built `dist/index.js`; esbuild follows the `@ttoksem/*` workspace deps (via their `exports`) and `commander`, inlining everything into one ESM file. The `--disable-warning` shebang suppresses the `node:sqlite` experimental warning.

- [ ] **Step 3: Update `packages/cli/package.json`**

```json
{
  "name": "ttoksem",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ttoksem": "./dist/cli.mjs" },
  "files": ["dist/cli.mjs"],
  "engines": { "node": ">=22.5.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:bundle": "pnpm --filter ttoksem... build && node esbuild.mjs",
    "prepublishOnly": "pnpm build:bundle",
    "check": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```
Keep `devDependencies` (including `esbuild`, `tsx`). Move every `@ttoksem/*` entry and `commander` out of `dependencies` — delete the `dependencies` block entirely; everything is bundled. The package `name` changes from `@ttoksem/cli` to `ttoksem`; `build:bundle`'s `--filter ttoksem...` builds the renamed package and its workspace deps before bundling.

- [ ] **Step 4: Update the root `package.json` `cli` script**

Change `"cli": "pnpm --filter @ttoksem/cli dev"` to `"cli": "pnpm --filter ttoksem dev"`.

- [ ] **Step 5: Build the bundle**

Run: `pnpm --filter ttoksem build:bundle`
Expected: builds the workspace, prints `bundled -> dist/cli.mjs`, and `packages/cli/dist/cli.mjs` exists with the shebang as line 1.

- [ ] **Step 6: Smoke-test the bundle (manual verification, not a unit test)**

Run: `node packages/cli/dist/cli.mjs --help`
Expected: prints the ttoksem CLI help including `init` and `hook`. No `Cannot find module '@ttoksem/...'` error, no native-module load. Then:
Run: `node --input-type=module -e "import('./packages/cli/dist/cli.mjs')"` from a scratch directory copy to confirm it runs with no `node_modules` present (dependency-free).
Expected: runs (help/usage output), proving the bundle is self-contained.

- [ ] **Step 7: Verify the publish contents**

Run: `cd packages/cli && npm pack --dry-run`
Expected: the tarball lists only `dist/cli.mjs` and `package.json` — no `src/`, no `node_modules`, no `@ttoksem/*`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/esbuild.mjs packages/cli/package.json package.json pnpm-lock.yaml
git commit -m "build(cli): bundle with esbuild and make the ttoksem package publishable"
```

Note: actually running `npm publish` is a release step performed by the maintainer (it requires npm auth and confirming the `ttoksem` name is free — see the spec's Open Questions). It is not part of this plan's automated steps.

---

## Task 6: Add a Quick Start to the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Prepend the Quick Start section**

Insert immediately after the opening description paragraph, before `## MVP Checkpoint`:

```markdown
## Quick Start

Install the CLI (requires Node 22.5 or newer):

    npm install -g ttoksem

In a project where you use Claude Code, set it up:

    ttoksem init

`ttoksem init` creates a local ledger at `.ttoksem/ttoksem.db` and, with your
consent, installs a Claude Code Stop hook that captures token usage
automatically after every turn.

See your usage:

    ttoksem dashboard serve     # local web dashboard
    ttoksem report today        # today's cost in the terminal
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): add Quick Start install section"
```

---

## Done criteria

- `pnpm -r check && pnpm -r test && pnpm -r build` all pass.
- `packages/cli/dist/cli.mjs` runs `--help` with no `node_modules` present.
- `npm pack --dry-run` for the `ttoksem` package lists only the bundle + `package.json`.
- No `better-sqlite3` reference remains in `packages/storage-sqlite` or the lockfile.
