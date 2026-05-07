# Spec — Plan 2: HTTP API parity for the `Ledger` interface

Date: 2026-05-07
Status: Approved (brainstorming complete; ready for implementation plan)

## Goal

Bring the HTTP surface to full parity with the `Ledger` interface so a future `HttpLedgerClient` (Plan 3) can implement `Ledger` purely by calling HTTP endpoints — without any storage-layer access. Refactor the `Ledger` interface into a three-tier hierarchy that cleanly separates remote-safe, admin-privileged, and locally-bound operations.

## Why

Plan 1 extracted a single `Ledger` interface that mirrors `LedgerService`'s entire public surface. Two problems with that:

1. Some methods are inherently filesystem- or local-store-bound (`init`, `currentWorkspace(rootPath)`, `resolveWorkspace`) and have no honest HTTP semantics.
2. Some methods are privilege-sensitive (`createAccessKey`, `revokeAccessKey`, `listAccessKeys`, `countActiveAccessKeys`, `upsertPricingRule`, `upsertPricingSourceSnapshot`, `migrateUsageEventPricing`, `repriceUnpricedUsage`). Exposing them on HTTP under the same `api:write` scope as everyday operations would let any write-token holder elevate privilege.

A flat interface forces `HttpLedgerClient` to either fake those methods or throw at runtime. Splitting the interface lets the type system enforce what's safe to call remotely.

## Scope

### In scope

1. Refactor `packages/core/src/ledger.ts` into three interfaces (see Architecture).
2. Add 6 new HTTP routes for the methods that belong on `Ledger` but currently lack routes.
3. Update `packages/core/src/ledger.test.ts` with three type-level assertions covering the hierarchy.
4. Update HTTP tests with happy-path + auth-gate coverage for each new route.

### Out of scope

- HTTP routes for `AdminLedger` methods (key management, pricing upserts, pricing migrations, reprice). Those stay CLI-only.
- HTTP routes for `LocalLedger` methods (init, currentWorkspace, resolveWorkspace). Those are inherently local.
- `HttpLedgerClient` itself — that's Plan 3.
- `TTOKSEM_TASK` env var plumbing — Plan 3.
- Refactoring of any existing route shape, naming, or response schema.

## Architecture

Three-tier interface hierarchy, linear inheritance:

```
Ledger              ← HttpLedgerClient implements this (remote-safe ops only)
  ↑ extends
AdminLedger         ← privileged ops layered on top
  ↑ extends
LocalLedger         ← filesystem-bound ops layered on top

class LedgerService implements LocalLedger
class HttpLedgerClient implements Ledger      // Plan 3
```

### Membership

**`Ledger`** (remote-safe, what HTTP exposes):

- Workspaces: `createWorkspace`, `listWorkspaces`
- Tasks: `startTask`, `archiveTask`, `closeTask` (deprecated alias), `listTasks`, `updateTask`, `getTaskStats`
- Usage: `recordUsage`, `listUnpricedUsage`, `moveUsage`, `getLastImportedAt`
- Inbox: `listInbox`, `listInboxGroups`, `showInboxGroup`, `assignInboxEvent`, `assignInboxGroup`, `acceptInboxGroup`
- Runs: `runActions`, `runMeta`
- Pricing reads: `listPricingRules`, `listPricingSourceSnapshots`, `getPricingSourceSnapshot`
- Reports: `reportToday`, `reportTask`, `dashboard`, `dashboardTask`
- Auth read: `verifyAccessKey` (used internally by HTTP middleware on the server side; HttpLedgerClient does not call it itself but it's a remote-safe operation)

**`AdminLedger extends Ledger`** (privileged, CLI-only in practice):

- Access keys: `createAccessKey`, `listAccessKeys`, `revokeAccessKey`, `countActiveAccessKeys`
- Pricing writes: `upsertPricingRule`, `upsertPricingSourceSnapshot`
- Maintenance: `repriceUnpricedUsage`, `migrateUsageEventPricing`

**`LocalLedger extends AdminLedger`** (filesystem/local-store-bound):

- `init()`
- `currentWorkspace(rootPath)`
- `resolveWorkspace(resolver)`

Note: `verifyAccessKey` is on `Ledger` rather than `AdminLedger` because the HTTP server uses it during request authorization; treating it as remote-safe simplifies the server's call graph. Calls to `verifyAccessKey` are not exposed as a route; the server invokes it internally per request.

### Why this exact tiering

- `LocalLedger extends AdminLedger`: a process that has filesystem access (i.e., the local CLI process) inevitably has all admin powers too — there's no meaningful security boundary between them in a local context.
- `AdminLedger extends Ledger`: an admin client can do everything a regular client can.
- `HttpLedgerClient` only needs to implement `Ledger`. Any attempt to call admin or local ops through it is a compile-time error, not a runtime surprise.

## New HTTP routes

All six are GET (read-only) and require `dashboard:read` scope (matches the existing read-route convention in `packages/http/src/index.ts` — every GET that reads ledger data uses `dashboard:read`). Path conventions match existing routes in `packages/http/src/index.ts`.

| # | Method | Path | Handler | Workspace param |
|---|---|---|---|---|
| 1 | GET | `/api/workspaces` | `listWorkspaces` | none (lists all) |
| 2 | GET | `/api/inbox` | `listInbox` | `?workspace=<key>` (optional, defaults to default workspace) |
| 3 | GET | `/api/inbox/groups/{groupId}` | `showInboxGroup` | none (global ID) |
| 4 | GET | `/api/pricing/snapshots/{id}` | `getPricingSourceSnapshot` | none (global ID) |
| 5 | GET | `/api/reports/today` | `reportToday` | `?workspace=<key>` |
| 6 | GET | `/api/reports/tasks/{taskKey}` | `reportTask` | `?workspace=<key>` |

### Response schemas

Each route returns the same shape as the corresponding service method. Schemas are reused from `@ttoksem/schema` where they exist; new Zod schemas are added at the top of `packages/http/src/index.ts` for any response shape not already declared (e.g. `DailyReport`, `InboxGroup`, `PricingSourceSnapshot`).

### Error semantics

- 401 on missing/invalid token (matches existing pattern via `authorizeRequest`).
- 403 on insufficient scope.
- 404 on `getPricingSourceSnapshot` and `showInboxGroup` when the ID is not found. Other GETs return empty arrays / null where appropriate; they don't 404.
- 500 on unexpected service errors (no special handling needed; existing global handler covers it).

## Test plan

For each of the 6 new routes:

1. **Happy path** — fixture-backed `fakeService` returns a representative shape; assert HTTP 200 + body matches.
2. **Auth gate** — request with no `Authorization` header → 401; request with `api:write`-only token → 403.

Plus three new type-level assertions in `packages/core/src/ledger.test.ts`:

```ts
expectTypeOf<LedgerService>().toMatchTypeOf<LocalLedger>();
expectTypeOf<LocalLedger>().toMatchTypeOf<AdminLedger>();
expectTypeOf<AdminLedger>().toMatchTypeOf<Ledger>();
```

Total new tests: ~12 HTTP + 3 type-level = 15.

## Backward compatibility

- All 26 existing routes unchanged.
- `Ledger` interface is *narrower* after the split — anything that imported `Ledger` for type purposes and used admin or local methods on the type will fail at compile time. The only such consumer is `LedgerService` itself, which now declares `implements LocalLedger` instead of `implements Ledger`. The HTTP server uses `LedgerService` directly (not via the `Ledger` type), so no runtime impact.
- No DB migration required.
- No CLI surface change.

## File touch list

| File | Change |
|---|---|
| `packages/core/src/ledger.ts` | Split into three interfaces; export all three |
| `packages/core/src/index.ts` | Re-export `AdminLedger`, `LocalLedger` |
| `packages/core/src/ledger-service.ts` | `implements Ledger` → `implements LocalLedger` |
| `packages/core/src/ledger.test.ts` | Add three type-level assertions |
| `packages/http/src/index.ts` | Add 6 routes + handlers; no edits to existing routes |
| `packages/http/src/index.test.ts` | Add 12 tests for new routes; extend `fakeService` defaults |

## Open questions

None blocking. Notable decisions captured above:

- `verifyAccessKey` placement → on `Ledger` (server-internal use, remote-safe).
- `repriceUnpricedUsage` classification → `AdminLedger` (treated as pricing-data maintenance).
- Tiering shape → linear `Local extends Admin extends Ledger`, not sibling.
