# Importer Remote-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude/Codex session importers (`usage import-claude-sessions`, `usage import-codex-sessions`) and `ttoksem hook run` work in the CLI's remote mode, so a self-hosted Worker receives autocapture data.

**Architecture:** The importers call only `recordUsage` (and `hook run` also `getLastImportedAt`) — both on the remote-safe `Ledger` tier that `HttpLedgerClient` already implements. The remote-mode block is purely a `service: LocalLedger` parameter type plus three `requireLocalLedger()` guards. Narrow the importer signatures to `Ledger` and have the three command handlers use `handle.ledger` directly. CLI-only — no Worker, core, or storage change.

**Tech Stack:** TypeScript, pnpm workspace, commander, vitest, Hono (in-process test server).

Implements spec: `docs/specs/2026-05-20-importer-remote-write-design.md` (sub-project 3 of 3).

---

## File Structure

### Modified
- `packages/cli/src/index.ts` — narrow the `importClaudeSessions` / `importCodexSessions` signatures from `LocalLedger` to `Ledger`; change the `usage import-claude-sessions`, `usage import-codex-sessions`, and `hook run` `.action()` handlers to use `handle.ledger` instead of `requireLocalLedger(handle)`.
- `docs/REMOTE-MODE.md` — move the two importers to "What works"; note `hook run` is remote-capable.

### Created
- `packages/cli/src/remote-import.test.ts` — remote-mode tests for the importers and `hook run` (in-process Hono server).

`requireLocalLedger` stays in `index.ts` — it is still used by genuinely-local commands (`workspace init`, `doctor`, `auth key *`, pricing writes, `dashboard serve`). Only the three importer/hook handlers stop calling it.

---

## Task 1: Importers and `hook run` work in remote mode

The `importClaudeSessions` / `importCodexSessions` functions are typed `service: LocalLedger` but call only `service.recordUsage(...)`. The `usage import-claude-sessions`, `usage import-codex-sessions`, and `hook run` `.action()` handlers obtain the ledger via `makeLedgerLocal()` then `requireLocalLedger(handle)` — the guard throws in remote mode. `makeLedgerLocal()` already returns an `HttpLedgerClient`-backed handle when `TTOKSEM_HTTP_URL` is set; the only change needed is to stop narrowing to `LocalLedger`.

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/remote-import.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/remote-import.test.ts`. Model the remote-mode harness on the existing remote-mode e2e test in `packages/cli/src/index.test.ts` — the test titled "HttpLedgerClient round-trips against a real LedgerService via in-process Hono" — for how it stands up an in-process Hono app over a real `LedgerService` and points the CLI's remote mode at it. Model the Claude/Codex session JSONL fixtures on the existing Claude-import test in `index.test.ts` and on `packages/cli/src/hook.test.ts`.

The test file must cover three cases, each: (a) stand up an in-process server (`createHttpApp` over a real `LedgerService` on a temp DB) with a workspace created; (b) put the CLI in remote mode pointed at that in-process server (the same mechanism the existing e2e test uses); (c) create a fake Claude/Codex project dir with one session JSONL carrying a usage event; (d) run the command; (e) assert the usage event landed in the **server-side** ledger.

```ts
import { describe, it, expect } from "vitest";
// ...imports mirroring the remote-mode e2e harness in index.test.ts...

describe("importers in remote mode", () => {
  it("usage import-claude-sessions writes to the remote ledger", async () => {
    // server-side LedgerService + in-process Hono app + workspace "ttoksem-dev"
    // CLI remote mode -> that app ; fake Claude project dir with one assistant+usage JSONL
    // run: usage import-claude-sessions --workspace ttoksem-dev --projects-dir <dir>
    const events = await serverStore.listRecentUsageEvents(workspaceId, 50);
    expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(true);
  });

  it("usage import-codex-sessions writes to the remote ledger", async () => {
    // same shape, Codex session JSONL fixture, run import-codex-sessions
    const events = await serverStore.listRecentUsageEvents(workspaceId, 50);
    expect(events.length).toBeGreaterThan(0);
  });

  it("hook run writes project-scoped Claude session usage to the remote ledger", async () => {
    // same shape; run: hook run --workspace ttoksem-dev --projects-dir <dir>
    const events = await serverStore.listRecentUsageEvents(workspaceId, 50);
    expect(events.some((e) => e.provider === "anthropic" || e.model.includes("claude"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ttoksem test -- remote-import.test.ts`
Expected: FAIL — in remote mode the three commands hit `requireLocalLedger(handle)`, which throws `Error: This subcommand requires a local DB and is not available in remote mode...`.

- [ ] **Step 3: Narrow the importer signatures**

In `packages/cli/src/index.ts`:
- `importClaudeSessions` — change the parameter type `service: LocalLedger` to `service: Ledger`.
- `importCodexSessions` — change the parameter type `service: LocalLedger` to `service: Ledger`.

Both function bodies are unchanged — the only ledger method either calls is `service.recordUsage(...)`, which is on the `Ledger` tier. Ensure `Ledger` is imported from `@ttoksem/core` at the top of `index.ts` (it already imports `LocalLedger`; add `Ledger` to that import if it is not already present).

- [ ] **Step 4: Un-gate the three command handlers**

In `packages/cli/src/index.ts`, in the `.action()` handlers of `usage import-claude-sessions`, `usage import-codex-sessions`, and `hook run`: replace

```ts
const service = requireLocalLedger(handle);
```

with

```ts
const service = handle.ledger;
```

`handle.ledger` is typed `Ledger` (an `HttpLedgerClient` in remote mode, a `LedgerService` locally). The rest of each handler — JSONL parsing, `--since`, the import preview, `getLastImportedAt` in `hook run` (a `Ledger` method), the `try { ... } finally { await handle.close(); }` — is unchanged. Do NOT remove the `requireLocalLedger` import; it is still used by other commands.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter ttoksem test -- remote-import.test.ts`
Expected: PASS — all three cases green; the session usage lands in the server-side ledger.

- [ ] **Step 6: Typecheck and run the full CLI suite**

Run: `pnpm --filter ttoksem check && pnpm --filter ttoksem test`
Expected: PASS — `tsc --noEmit` clean (the importers compile against the narrower `Ledger` type), and all pre-existing CLI tests (the local-mode importer / `hook run` tests included) still green.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/remote-import.test.ts
git commit -m "feat(cli): let the session importers and hook run write to a remote ledger"
```

---

## Task 2: Update `docs/REMOTE-MODE.md`

`REMOTE-MODE.md` lists `usage import-claude-sessions` / `usage import-codex-sessions` under "What doesn't (and why)". They now work.

**Files:**
- Modify: `docs/REMOTE-MODE.md`

- [ ] **Step 1: Move the importers to "What works"**

In `docs/REMOTE-MODE.md`:
1. Delete the `| usage import-codex-sessions, usage import-claude-sessions | Read local JSONL session logs |` row from the "What doesn't (and why)" table.
2. Under "## What works", add to the **Usage** line (currently `usage add`, `usage move`, `usage last-import`) the two importers, and add a short sentence afterward:

```markdown
- **Usage:** `usage add`, `usage move`, `usage last-import`,
  `usage import-claude-sessions`, `usage import-codex-sessions`

The session importers parse local JSONL on the machine they run on and write
the resulting usage events to the remote ledger — so `ttoksem hook run`
(the Claude Code Stop-hook autocapture command) also works in remote mode,
letting several machines feed one self-hosted Worker.
```

3. Leave `usage codex-turn`, `usage claude-turn`, `usage openai-response`, `usage anthropic-response` in the "What doesn't" table — they are still local-only (out of scope for this change).

- [ ] **Step 2: Commit**

```bash
git add docs/REMOTE-MODE.md
git commit -m "docs(remote-mode): the session importers now work in remote mode"
```

---

## Done criteria

- `pnpm -r check && pnpm -r test && pnpm -r build` all pass.
- `usage import-claude-sessions`, `usage import-codex-sessions`, and `hook run` run against a remote ledger when `TTOKSEM_HTTP_URL` is set (covered by `remote-import.test.ts`) and are unchanged in local mode.
- `docs/REMOTE-MODE.md` lists the importers under "What works".
