# Project Config File — Implementation Plan (Plan 1: Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ttoksem CLI resolve the workspace from a committed `ttoksem.config.json` so users and agents stop passing `--workspace` on every command.

**Architecture:** A new pure module `packages/cli/src/project-config.ts` discovers `ttoksem.config.json` by walking up from cwd (mirroring the existing `findExistingDbUpwards` DB walk-up), parses + validates it with a Zod schema, and resolves the workspace key by precedence `flag > config file > env (TTOKSEM_WORKSPACE_KEY)`. The single existing chokepoint `workspaceResolver()` in `index.ts` consumes it — and since `workspaceResolver()`'s `{ key, rootPath }` object is passed to every ledger method on both `LedgerService` (local) and `HttpLedgerClient` (remote), this one change covers local and remote mode alike. The 7 hardcoded `"ttoksem-dev"` option defaults are removed so config resolution is not shadowed.

**Tech Stack:** TypeScript, commander, Zod v4 (`@ttoksem/schema`), vitest + tsx.

**Scope:** This is **Plan 1 — core**: the config module + **workspace** resolution + `init`. The spec's `promptMode` / `model` / `remote` fields are defined in the schema (forward-compatible, `.passthrough()`) but their resolution wiring is **deferred to Plan 2**. Plan 1 alone is working, testable software — `ttoksem.config.json`'s `workspace` is honored end-to-end.

**Spec:** `ai-usage-ledger-spec/docs/design/project-config-spec.md`

---

## File Structure

- **`packages/schema/src/index.ts`** (modify) — add `TtoksemConfigSchema` + `TtoksemConfig` type.
- **`packages/cli/src/project-config.ts`** (create) — config discovery, load + validate, workspace-key resolution, memoized accessor. Pure module modeled on `settings-merge.ts`.
- **`packages/cli/src/project-config.test.ts`** (create) — unit tests for the module.
- **`packages/cli/src/index.ts`** (modify) — `workspaceResolver` consults the config; remove 7 hardcoded `"ttoksem-dev"` defaults.
- **`packages/cli/src/index.test.ts`** (modify) — integration tests for config-driven workspace + `init`.
- **`packages/cli/src/init.ts`** (modify) — write `ttoksem.config.json`; simplify the Claude hook command.

**Test commands:**
- Single file: `pnpm --filter ttoksem exec vitest run src/<file>.test.ts`
- Full CLI suite: `pnpm --filter ttoksem test`
- Typecheck: `pnpm --filter ttoksem check`
- Schema build (after editing `@ttoksem/schema`): `pnpm --filter @ttoksem/schema build`

---

## Task 1: Config file discovery (`findProjectConfig`)

**Files:**
- Create: `packages/cli/src/project-config.ts`
- Test: `packages/cli/src/project-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/project-config.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { findProjectConfig } from "./project-config.js";

describe("findProjectConfig", () => {
  it("finds ttoksem.config.json by walking up from a nested directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), "{}");
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(findProjectConfig(nested)).toBe(join(root, "ttoksem.config.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no config file exists in any ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      expect(findProjectConfig(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: FAIL — cannot resolve `./project-config.js` (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/cli/src/project-config.ts`:

```ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up from startDir to find ttoksem.config.json.
 * Mirrors findExistingDbUpwards() in index.ts: same termination on filesystem root.
 */
export function findProjectConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, "ttoksem.config.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/project-config.ts packages/cli/src/project-config.test.ts
git commit -m "feat(cli): add ttoksem.config.json discovery (walk-up)"
```

---

## Task 2: Config schema + `loadProjectConfig`

**Files:**
- Modify: `packages/schema/src/index.ts` (add schema near the other exported schemas)
- Modify: `packages/cli/src/project-config.ts`
- Test: `packages/cli/src/project-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/project-config.test.ts` (add `loadProjectConfig` to the existing import from `./project-config.js`):

```ts
describe("loadProjectConfig", () => {
  it("loads and validates a config found upward from startDir", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), JSON.stringify({ workspace: "my-proj" }));
      const loaded = loadProjectConfig(root);
      expect(loaded?.config.workspace).toBe("my-proj");
      expect(loaded?.path).toBe(join(root, "ttoksem.config.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no config file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      expect(loadProjectConfig(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error on malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), "{ not json");
      expect(() => loadProjectConfig(root)).toThrow(/not valid JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error on a schema-invalid value", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), JSON.stringify({ promptMode: "bogus" }));
      expect(() => loadProjectConfig(root)).toThrow(/invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: FAIL — `loadProjectConfig` is not exported.

- [ ] **Step 3: Add the schema to `@ttoksem/schema`**

In `packages/schema/src/index.ts`, add (alongside the other `export const XSchema` definitions; `import { z } from "zod"` is already at the top):

```ts
export const TtoksemConfigSchema = z
  .object({
    workspace: z.string().min(1).optional(),
    promptMode: z.enum(["full", "redacted", "hash", "none"]).optional(),
    model: z.record(z.string(), z.string()).optional(),
    remote: z.object({ url: z.string().url() }).optional(),
  })
  .passthrough();

export type TtoksemConfig = z.infer<typeof TtoksemConfigSchema>;
```

Then rebuild the schema package so the CLI resolves the new export:

Run: `pnpm --filter @ttoksem/schema build`

- [ ] **Step 4: Implement `loadProjectConfig`**

In `packages/cli/src/project-config.ts`, extend the `node:fs` import to `import { existsSync, readFileSync } from "node:fs";`, then add the `@ttoksem/schema` import and the function:

```ts
import { TtoksemConfigSchema, type TtoksemConfig } from "@ttoksem/schema";

export interface LoadedProjectConfig {
  config: TtoksemConfig;
  path: string;
}

/**
 * Discover, read, parse, and validate ttoksem.config.json.
 * Returns null when no file is found. Throws a clear error on malformed JSON
 * or schema-invalid content — never silently ignores a broken config.
 */
export function loadProjectConfig(startDir: string): LoadedProjectConfig | null {
  const path = findProjectConfig(startDir);
  if (!path) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`ttoksem.config.json at ${path} is not valid JSON: ${String(err)}`);
  }
  const result = TtoksemConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`ttoksem.config.json at ${path} is invalid: ${result.error.message}`);
  }
  return { config: result.data, path };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/index.ts packages/cli/src/project-config.ts packages/cli/src/project-config.test.ts
git commit -m "feat(cli): parse and validate ttoksem.config.json against a Zod schema"
```

---

## Task 3: Workspace-key resolution (`resolveWorkspaceKey`)

**Files:**
- Modify: `packages/cli/src/project-config.ts`
- Test: `packages/cli/src/project-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/project-config.test.ts` (add `resolveWorkspaceKey` to the import):

```ts
describe("resolveWorkspaceKey", () => {
  it("prefers the CLI flag over config and env", () => {
    expect(
      resolveWorkspaceKey({ flag: "from-flag", config: { workspace: "from-config" }, env: "from-env" }),
    ).toBe("from-flag");
  });

  it("prefers the config file over env when no flag", () => {
    expect(resolveWorkspaceKey({ config: { workspace: "from-config" }, env: "from-env" })).toBe(
      "from-config",
    );
  });

  it("falls back to env when neither flag nor config supply a key", () => {
    expect(resolveWorkspaceKey({ env: "from-env" })).toBe("from-env");
  });

  it("returns undefined when nothing supplies a key", () => {
    expect(resolveWorkspaceKey({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: FAIL — `resolveWorkspaceKey` is not exported.

- [ ] **Step 3: Implement `resolveWorkspaceKey`**

In `packages/cli/src/project-config.ts`, add:

```ts
/**
 * Resolve the workspace key by precedence: CLI flag > config file > env var.
 * Returns undefined when none supply a key — the ledger then resolves by
 * cwd/root_path (see workspace-spec.md), and errors if that also fails.
 * Note: there is intentionally no "ttoksem-dev" built-in default — that
 * hardcoded value is removed in Task 5.
 */
export function resolveWorkspaceKey(input: {
  flag?: string;
  config?: TtoksemConfig;
  env?: string;
}): string | undefined {
  return input.flag ?? input.config?.workspace ?? input.env;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ttoksem exec vitest run src/project-config.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/project-config.ts packages/cli/src/project-config.test.ts
git commit -m "feat(cli): resolve workspace key by flag > config > env precedence"
```

---

## Task 4: Wire config resolution into `workspaceResolver`

**Files:**
- Modify: `packages/cli/src/project-config.ts` (add memoized accessor)
- Modify: `packages/cli/src/index.ts` (import + `workspaceResolver`, lines ~1429-1434)
- Test: `packages/cli/src/index.test.ts`

`workspaceResolver()` is the single chokepoint (24 call sites) and its `{ key, rootPath }` object is passed to ledger methods on both the local `LedgerService` and the remote `HttpLedgerClient` — so this one change covers both modes.

- [ ] **Step 1: Write the failing integration test**

Append a new `it(...)` inside the `describe("ttoksem CLI workflows", ...)` block in `packages/cli/src/index.test.ts`:

```ts
it("resolves the workspace from ttoksem.config.json without --workspace", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
  try {
    runCli(["workspace", "init", "--key", "cfg-proj", "--root", tempDir], env);
    writeFileSync(join(tempDir, "ttoksem.config.json"), JSON.stringify({ workspace: "cfg-proj" }));
    // task start with NO --workspace: must resolve "cfg-proj" from the config file.
    const out = runCli(["task", "start", "cfg-task"], env);
    expect(out).toContain("cfg-task");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 30_000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "resolves the workspace from ttoksem.config.json"`
Expected: FAIL — without `--workspace` and without config wiring, `task start` cannot resolve the workspace.

- [ ] **Step 3: Add the memoized accessor**

In `packages/cli/src/project-config.ts`, add:

```ts
let cached: LoadedProjectConfig | null | undefined;

/** Memoized project-config load from the CLI's effective cwd (INIT_CWD ?? cwd). */
export function getProjectConfig(): LoadedProjectConfig | null {
  if (cached === undefined) {
    cached = loadProjectConfig(process.env.INIT_CWD ?? process.cwd());
  }
  return cached;
}
```

- [ ] **Step 4: Wire `workspaceResolver` in `index.ts`**

Add to the imports near the top of `packages/cli/src/index.ts`:

```ts
import { getProjectConfig, resolveWorkspaceKey } from "./project-config.js";
```

Replace `workspaceResolver` (currently `index.ts:1429-1434`):

```ts
function workspaceResolver(options: { workspace?: string; root?: string }) {
  return {
    key: options.workspace,
    rootPath: resolveFromCommandCwd(options.root ?? "."),
  };
}
```

with:

```ts
function workspaceResolver(options: { workspace?: string; root?: string }) {
  return {
    key: resolveWorkspaceKey({
      flag: options.workspace,
      config: getProjectConfig()?.config,
      env: process.env.TTOKSEM_WORKSPACE_KEY,
    }),
    rootPath: resolveFromCommandCwd(options.root ?? "."),
  };
}
```

(The return type is unchanged — `key` was already `string | undefined`; the ledger resolves by `rootPath`/cwd when `key` is undefined.)

- [ ] **Step 5: Run the test + typecheck to verify they pass**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "resolves the workspace from ttoksem.config.json"`
Expected: PASS.
Run: `pnpm --filter ttoksem check`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/project-config.ts packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): resolve workspace from ttoksem.config.json in workspaceResolver"
```

---

## Task 5: Remove the 7 hardcoded `"ttoksem-dev"` option defaults

**Files:**
- Modify: `packages/cli/src/index.ts` (lines 430, 462, 489, 521, 748, 771, 1079)
- Test: `packages/cli/src/index.test.ts`

**Why:** commander applies the `"ttoksem-dev"` third-argument default *before* the action runs, so `options.workspace` is never `undefined` on those 7 commands — config resolution is shadowed. Removing the default makes "flag absent" observable as `undefined`, letting Task 4's precedence chain run.

- [ ] **Step 1: Write the failing integration test**

Append inside `describe("ttoksem CLI workflows", ...)` in `index.test.ts`. `usage codex-turn` (line 430) is one of the 7 hardcoded commands:

```ts
it("a previously hardcoded-default command honors ttoksem.config.json", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
  try {
    runCli(["workspace", "init", "--key", "cfg-proj", "--root", tempDir], env);
    writeFileSync(join(tempDir, "ttoksem.config.json"), JSON.stringify({ workspace: "cfg-proj" }));
    // usage codex-turn had a hardcoded --workspace default of "ttoksem-dev".
    // With it removed, the event must land in workspace "cfg-proj" (from config).
    runCli(
      ["usage", "codex-turn", "--started-at", "2026-05-21T00:00:00.000Z", "--ended-at", "2026-05-21T00:00:01.000Z"],
      env,
    );
    const report = runCli(["report", "today", "--workspace", "cfg-proj"], env);
    expect(report).not.toContain("ttoksem-dev");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 30_000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "previously hardcoded-default command"`
Expected: FAIL — the hardcoded `"ttoksem-dev"` default still wins, so the event lands in the wrong workspace.

- [ ] **Step 3: Remove the hardcoded defaults**

At each of `index.ts` lines 430, 462, 489, 521, 748, 771, 1079, change:

```ts
  .option("--workspace <key>", "workspace key", "ttoksem-dev")
```

to:

```ts
  .option("--workspace <key>", "workspace key")
```

(7 occurrences. After the edit, `grep -n '"ttoksem-dev"' packages/cli/src/index.ts` should return nothing.)

- [ ] **Step 4: Run the test + full suite to verify**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "previously hardcoded-default command"`
Expected: PASS.
Run: `pnpm --filter ttoksem test`
Expected: all tests pass — confirms no other test relied on the `"ttoksem-dev"` default.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "fix(cli): drop hardcoded ttoksem-dev workspace default so config resolves"
```

---

## Task 6: `ttoksem init` writes `ttoksem.config.json`

**Files:**
- Modify: `packages/cli/src/init.ts`
- Test: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe("ttoksem CLI workflows", ...)` in `index.test.ts`. Ensure `readFileSync` is in the `node:fs` import of `index.test.ts` (add it if absent):

```ts
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
    expect(after.promptMode).toBe("hash");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 30_000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "ttoksem init writes ttoksem.config.json"`
Expected: FAIL — no `ttoksem.config.json` is written.

- [ ] **Step 3: Implement config-file writing in `init.ts`**

In `packages/cli/src/init.ts`, inside the `init` action, after the workspace is created/reused (after the workspace `console.log`, before the `.claude/` detection block — i.e. after `init.ts:62`), add:

```ts
// Write the project config file (idempotent — never clobber a hand-edited one).
const configPath = join(cwd, "ttoksem.config.json");
if (existsSync(configPath)) {
  console.log("Reusing existing ttoksem.config.json.");
} else {
  writeFileSync(configPath, `${JSON.stringify({ workspace: key }, null, 2)}\n`, "utf8");
  console.log(`Wrote ttoksem.config.json (workspace "${key}").`);
}
```

(`existsSync`, `writeFileSync`, `join` are already imported in `init.ts`; `cwd` and `key` are already in scope.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "ttoksem init writes ttoksem.config.json"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): write ttoksem.config.json on init (idempotent)"
```

---

## Task 7: Simplify the Claude hook command

**Files:**
- Modify: `packages/cli/src/init.ts`
- Test: `packages/cli/src/index.test.ts`

**Why:** `init` currently bakes `ttoksem hook run --workspace <key>` into `.claude/settings.json`. With the config file authoritative, the hook command becomes just `ttoksem hook run` — the workspace is read from `ttoksem.config.json`. The marker `"ttoksem hook run"` (in `settings-merge.ts`) is a substring of both forms, so hook detection still works and re-running `init` upgrades an old hook command.

- [ ] **Step 1: Write the failing test**

Append inside `describe("ttoksem CLI workflows", ...)` in `index.test.ts`. Ensure `mkdirSync` is in the `node:fs` import of `index.test.ts` (add it if absent):

```ts
it("init installs a hook command without a baked-in --workspace", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ttoksem-cli-test-"));
  const dbPath = join(tempDir, "ttoksem.db");
  const env = { ...process.env, TTOKSEM_DB: dbPath, INIT_CWD: tempDir };
  try {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    runCli(["init", "--key", "cfg-proj", "--yes"], env);
    const settings = JSON.parse(readFileSync(join(tempDir, ".claude", "settings.json"), "utf8"));
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    expect(cmd).toContain("ttoksem hook run");
    expect(cmd).not.toContain("--workspace");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 30_000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "without a baked-in --workspace"`
Expected: FAIL — the command still contains `--workspace cfg-proj`.

- [ ] **Step 3: Change the hook command in `init.ts`**

In `packages/cli/src/init.ts`, change the `mergeTtoksemStopHook` call and the following log lines (`init.ts:100-106`):

```ts
const merged = mergeTtoksemStopHook(
  settings,
  `ttoksem hook run --workspace ${key}`,
);
writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Installed autocapture hook into ${settingsPath}.`);
console.log(`Hook command: ttoksem hook run --workspace ${key}`);
```

to:

```ts
const merged = mergeTtoksemStopHook(settings, "ttoksem hook run");
writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Installed autocapture hook into ${settingsPath}.`);
console.log("Hook command: ttoksem hook run (workspace read from ttoksem.config.json)");
```

- [ ] **Step 4: Run the test + full suite**

Run: `pnpm --filter ttoksem exec vitest run src/index.test.ts -t "without a baked-in --workspace"`
Expected: PASS.
Run: `pnpm --filter ttoksem test` and `pnpm --filter ttoksem check`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): simplify Claude hook command to read workspace from config"
```

---

## Verification (whole plan)

After all tasks:

- [ ] `pnpm --filter ttoksem test` — full CLI suite green.
- [ ] `pnpm --filter ttoksem check` — no type errors.
- [ ] `pnpm --filter @ttoksem/schema build && pnpm --filter @ttoksem/schema test` — schema package green.
- [ ] Manual smoke: in a temp dir, `ttoksem init --key demo --yes`, confirm `ttoksem.config.json` exists, then run a command without `--workspace` and confirm it resolves `demo`.

## Out of scope (Plan 2)

- Resolving `promptMode`, `model`, and `remote.url` from the config file (the schema already accepts them; only the resolution wiring is deferred).
- A warning when the config has unknown top-level keys (`.passthrough()` accepts them silently for now — the spec asks for a warning).
- Migrating the ~11 direct `options.workspace` readers in `index.ts` to go through `workspaceResolver` (they still accept an explicit `--workspace`; they just do not yet read the config). List them in Plan 2.
- Downgrading the 2 `.requiredOption("--workspace")` commands (`index.ts:550, 587`) to optional — decide in Plan 2 whether those commands should resolve from config.
- `MakeLedgerOptions.defaultWorkspaceKey` (`ledger-factory.ts`) stays unused — `workspaceResolver` already feeds the resolved key to local and remote ledger calls, so no separate remote wiring is needed.
