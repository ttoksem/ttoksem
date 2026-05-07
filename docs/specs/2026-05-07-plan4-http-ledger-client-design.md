# Spec — Plan 4: `HttpLedgerClient` + CLI remote-mode wiring

Date: 2026-05-07
Status: Approved (auto-mode default selections noted inline; user can revise during spec review)

## Goal

Ship `HttpLedgerClient` — a `Ledger`-implementing class that translates each business-operations call into an HTTP request against a ttoksem server — and wire it into the CLI so that `TTOKSEM_HTTP_URL=https://...` switches the CLI from local SQLite to the remote server. Achieves the multi-machine / multi-agent scenario that ADR-0010 motivates.

## Why

- Plan 1 extracted `Ledger`, Plan 2 split into `Ledger`/`AdminLedger`/`LocalLedger` and added the missing GET routes, Plan 3 fixed autocapture to use `$TTOKSEM_TASK`. The HTTP surface is now full-parity with `Ledger`. Plan 4 is the consumer: a TypeScript class that implements `Ledger` purely via fetch calls.
- Without Plan 4, the CLI is hardwired to local storage and cannot use the running server. `apps/server` and `apps/worker` exist but are unreachable from the CLI workflow.

## Scope

### In scope

1. New package `packages/ledger-http/` exporting `HttpLedgerClient` and `HttpLedgerError`.
2. `HttpLedgerClient` implements `Ledger` (the remote-safe tier from Plan 2). Each method is a thin fetch wrapper that POSTs/GETs the corresponding HTTP route, parses JSON, and returns the typed value.
3. CLI integration: replace the existing local-only service factory with a `makeLedger()` that branches on `TTOKSEM_HTTP_URL`:
   - Set → return an `HttpLedgerClient` instance (with token from `TTOKSEM_HTTP_TOKEN` or `--http-token` flag).
   - Unset → return a local `LedgerService` (current behavior).
4. Tests:
   - Type-level test: `expectTypeOf<HttpLedgerClient>().toMatchTypeOf<Ledger>()` in the new package.
   - Per-method behavioral tests that drive a real Hono app (built via `createHttpApp({ service: fakeService(...) })`) and assert the client round-trips correctly. Reuses the existing `fakeService` factory + test fixtures from `packages/http`.
5. CLI workflow test: at least one end-to-end test that boots an in-process Hono server, points `TTOKSEM_HTTP_URL` at it, and exercises a basic flow (workspace + task + listTasks).

### Out of scope (explicit)

- `AdminLedger` / `LocalLedger` methods over HTTP — Plan 2 keeps them off the wire intentionally.
- Offline buffering, outbox, retry-with-backoff. The client is one-shot fetches; failures propagate.
- Multi-profile config (`~/.ttoksem/config.json`). ADR-0010 lists this as non-goal.
- Cookie / session auth modes — only Bearer token.
- TLS pinning, mutual TLS, custom CA bundles. Defaults to whatever Node's global fetch does.
- Streaming endpoints. There aren't any in `Ledger` today.

## Architecture

```
[로컬 모드 — TTOKSEM_HTTP_URL unset]
  CLI → makeLedger() → LedgerService (implements LocalLedger)
                          ↓
                       LedgerStore → SqliteLedgerStore

[원격 모드 — TTOKSEM_HTTP_URL set]
  CLI → makeLedger() → HttpLedgerClient (implements Ledger)
                          ↓ fetch ↓
                       ttoksem-server (apps/server or apps/worker)
                          ↓
                       LedgerService → SqliteLedgerStore (or D1 on the worker)
```

### Package: `packages/ledger-http/`

```
packages/ledger-http/
├── package.json           # @ttoksem/ledger-http
├── tsconfig.json
├── vitest.config.ts (if needed)
└── src/
    ├── index.ts           # exports HttpLedgerClient, HttpLedgerError
    ├── client.ts          # HttpLedgerClient class (one method per Ledger member)
    ├── errors.ts          # HttpLedgerError, parseErrorBody
    ├── client.test.ts     # behavioral tests (real Hono fakeService)
    └── client.type.test.ts # type-level Ledger conformance
```

`peerDependencies`: `@ttoksem/core` (for the `Ledger` type), `@ttoksem/schema` (for record types).
`dependencies`: none. Uses global `fetch` (Node ≥18, project uses Node 22).
`devDependencies`: vitest, typescript, plus dev deps to spin up the in-process server: `@ttoksem/http`, `@ttoksem/core`.

### `HttpLedgerClient` shape

```ts
export interface HttpLedgerClientOptions {
  baseUrl: string;                      // e.g. "https://ledger.example.com" (no trailing slash)
  token?: string;                        // Bearer token (omit if server runs in auth: { mode: "none" })
  defaultWorkspaceKey?: string;          // optional default for `?workspace=` queries
  fetch?: typeof globalThis.fetch;       // injectable for tests; default = globalThis.fetch
}

export class HttpLedgerClient implements Ledger {
  constructor(options: HttpLedgerClientOptions);
  // ... one method per Ledger member, signature-identical to LedgerService's
}
```

Each method follows a predictable shape:

```ts
async listTasks(input: { workspace: WorkspaceResolver }): Promise<TaskRecord[]> {
  const workspaceKey = resolveWorkspaceKey(input.workspace, this.defaultWorkspaceKey);
  const response = await this.request("GET", `/api/tasks?workspace=${encodeURIComponent(workspaceKey)}`);
  return (response as { tasks: TaskRecord[] }).tasks;
}
```

Where:
- `resolveWorkspaceKey(resolver, fallback)`: extracts a string key from a `WorkspaceResolver`. The local service accepts either `{ key }` or `{ rootPath }`; the remote client only accepts `{ key }` — `rootPath` is a local-filesystem concept that has no remote meaning. If a caller passes `rootPath`, throw `HttpLedgerError("rootPath not supported in remote mode; resolve to a workspace key first")`.
- `this.request(method, path, body?)` is a small private helper that adds `Authorization: Bearer <token>`, `Content-Type: application/json` for body methods, JSON-parses, and throws `HttpLedgerError` on non-2xx.

### `HttpLedgerError`

```ts
export class HttpLedgerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: { error?: string; detail?: string },
  );
}
```

Maps standard error responses:
- 401 → `HttpLedgerError("Unauthorized", 401, body)`
- 403 → `HttpLedgerError("Forbidden", 403, body)`
- 404 → `HttpLedgerError("Not Found", 404, body)`
- 410 → `HttpLedgerError("Endpoint removed", 410, body)` (for the `task active` endpoint that's already 410 Gone)
- 5xx → `HttpLedgerError("Server error", status, body)`
- Network / non-JSON → `HttpLedgerError("Network error: <reason>", 0, undefined)`

### CLI integration

Add a `makeLedger()` factory in `packages/cli/src/index.ts` (or a new `packages/cli/src/ledger-factory.ts` if `index.ts` is too large):

```ts
async function makeLedger(): Promise<{ ledger: Ledger; close: () => Promise<void> }> {
  const httpUrl = process.env.TTOKSEM_HTTP_URL;
  if (httpUrl) {
    const token = process.env.TTOKSEM_HTTP_TOKEN;
    return {
      ledger: new HttpLedgerClient({ baseUrl: httpUrl, token, defaultWorkspaceKey: "ttoksem-dev" }),
      close: async () => {},
    };
  }
  // existing local path
  const { service, close } = await makeService();
  await service.init();
  return { ledger: service, close };
}
```

⚠️ The CLI's existing call sites use `LocalLedger` capabilities (e.g., `service.init()`, `service.currentWorkspace(...)`, admin operations). In remote mode, `HttpLedgerClient` only implements `Ledger`. Two options:

- **A. Narrow CLI surface:** the CLI only calls `Ledger` methods on the returned ledger. Admin / local-bound operations remain CLI-local-only and are gated behind a `requireLocalLedger(ledger)` type guard that throws if remote mode. Cleanest. Subcommands that can't run in remote mode (like `auth key create`, `pricing rule upsert`, etc.) emit an error: `"This command requires a local DB. Unset TTOKSEM_HTTP_URL or run on the server."`
- **B. Bifurcate every CLI command:** each subcommand reimplements its logic against the narrower `Ledger` if remote, or `LocalLedger` if local. Massive surface. No.

**Choose A.** It mirrors the type-level split in Plan 2 and gives clear UX boundaries.

### CLI subcommand triage

Every existing CLI subcommand falls into one of three categories:

| Category | Behavior under remote mode |
|---|---|
| Pure `Ledger` (e.g., `task start`, `task list`, `usage record`, `inbox accept`, `dashboard`, `report today`) | Works the same; routes through HTTP. |
| `AdminLedger` only (e.g., `auth key create`, `auth key revoke`, `pricing rule upsert`, `usage reprice`) | Errors out cleanly with the "requires local DB" message. |
| `LocalLedger` only (e.g., `workspace init`, `workspace current`) | Same as above. |

The exact list is enumerated in the implementation plan.

## Tests

### Per-method behavioral

For each method on `Ledger`, one round-trip test:

```ts
it("listTasks fetches /api/tasks?workspace= and returns tasks[]", async () => {
  const tasks = [taskRecord({ key: "alpha" }), taskRecord({ key: "beta" })];
  const app = createHttpApp({
    service: fakeService({ listTasks: async () => tasks }),
    defaultWorkspaceKey: "test",
    auth: { mode: "access-key", verifyAccessToken: async ({ requiredScopes }) => requiredScopes.includes("dashboard:read") },
  });
  const client = new HttpLedgerClient({
    baseUrl: "http://test.invalid",
    token: "anything",
    fetch: app.fetch as typeof fetch,    // hono's app.fetch is fetch-compatible
  });
  const got = await client.listTasks({ workspace: { key: "test" } });
  expect(got).toEqual(tasks);
});
```

The `fetch` injection sidesteps the network entirely — `app.fetch(request)` is a standard Web Fetch handler. Total ~30 tests (one per `Ledger` method), each ≤10 lines.

### Type-level conformance

```ts
import { expectTypeOf, test } from "vitest";
import type { Ledger } from "@ttoksem/core";
import { HttpLedgerClient } from "./client.js";

test("HttpLedgerClient satisfies Ledger", () => {
  expectTypeOf<HttpLedgerClient>().toMatchTypeOf<Ledger>();
});
```

If a future `Ledger` method addition forgets to wire HttpLedgerClient, this test breaks at build time.

### Error mapping

```ts
it("maps 401 to HttpLedgerError with status 401", async () => {
  // build app with auth that always rejects
  // call any method
  // expect rejection: instanceof HttpLedgerError, status === 401
});
```

Also test 403, 404, 5xx, network failure (use a fetch that throws).

### CLI integration

One end-to-end CLI test that:
1. Spins up an in-process Hono app via `createHttpApp({ service: realLedgerService(tmpDb) })`.
2. Sets `TTOKSEM_HTTP_URL` to a stub URL plus injects the `app.fetch` adapter via env (or a small CLI flag for test purposes).
3. Runs `task start <key>` and `task list`.
4. Asserts the task lands in the (server-side) DB.

This proves the wiring without depending on a real network port.

## Backward compatibility

- Local-mode CLI behavior unchanged: every existing test keeps passing.
- New env vars (`TTOKSEM_HTTP_URL`, `TTOKSEM_HTTP_TOKEN`) are opt-in; unset → no behavior change.
- `Ledger` interface unchanged from Plan 2.
- HTTP routes unchanged from Plan 2.

## Documentation

- `MIGRATION.md`: short note that remote mode is now available; link to a new `docs/REMOTE-MODE.md` (created in this plan) covering env vars and admin-command limitations.
- `docs/REMOTE-MODE.md`: minimal guide — env vars, supported subcommands list, troubleshooting (401/403/404/410 banners).

## Open questions

None blocking. Auto-mode defaults applied:

- Scope: option B (class + CLI integration). Multi-profile config (option C) explicitly out per ADR-0010.
- Auth: Bearer token from env or constructor; no cookie/session.
- HTTP runtime: global fetch (Node ≥22).
- Test approach: in-process Hono `app.fetch` injection (no real network).
- Admin/local CLI commands in remote mode: hard error with clear message.
- Workspace resolver in remote mode: `{ key }` only; `{ rootPath }` rejected with explanatory error.
